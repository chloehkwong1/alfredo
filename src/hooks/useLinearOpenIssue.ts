import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { takePendingOpenIssue, type OpenIssueRequest } from "../services/linearOpenIssue";
import { stageOverlayPrompt, defaultBaseBranch } from "../services/linearWorktree";
import { createWorktreeFrom } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useToastStore } from "../stores/toastStore";
import { ensureAgentSession, writeToSession, getAgentSessionInfo, focusAgentTab } from "../services/agentMessenger";
import { sessionManager } from "../services/sessionManager";
import type { Worktree } from "../types";
import { lifecycleManager } from "../services/lifecycleManager";

export function useLinearOpenIssue() {
  const inFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    const handle = async (req: OpenIssueRequest) => {
      const key = `${req.matchedRepoPath ?? req.workdir}::${req.branch}`;
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      try {
        await routeOpenIssue(req);
      } finally {
        inFlight.current.delete(key);
      }
    };

    listen<OpenIssueRequest>("linear://open-issue", (e) => {
      void handle(e.payload);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    takePendingOpenIssue().then((req) => {
      if (req && !cancelled) void handle(req);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

async function routeOpenIssue(req: OpenIssueRequest): Promise<void> {
  const repoPath = req.matchedRepoPath;

  // Case 1: repo isn't managed by Alfredo
  if (!repoPath) {
    useToastStore.getState().show({
      message: `Open in Alfredo: "${req.workdir}" isn't a repo Alfredo manages. Add it first, then retry from Linear.`,
    });
    return;
  }

  const worktreeId = `${repoPath}::${req.branch}`;
  const { worktrees, setActiveWorktree } = useWorkspaceStore.getState();
  const existing = worktrees.find((wt) => wt.id === worktreeId);

  if (existing) {
    // Case 2: worktree already exists
    setActiveWorktree(worktreeId);

    const { sessionKey } = getAgentSessionInfo(worktreeId);
    const liveSession = sessionManager.getSession(sessionKey);

    if (liveSession) {
      // 2a: live agent session — inject the prompt
      const session = await ensureAgentSession(worktreeId, repoPath, req.branch);
      if (session?.sessionId) {
        await writeToSession(session.sessionId, req.prompt);
      }
    } else {
      // 2b: idle — stage prompt and activate the agent tab so overlay shows
      stageOverlayPrompt(worktreeId, req.prompt);
      focusAgentTab(worktreeId);
    }
  } else {
    // Case 3: new worktree — mirror CreateWorktreeDialog's create→register→focus flow
    const tempId = `${repoPath}::${req.branch}`;
    const placeholder: Worktree = {
      id: tempId,
      name: req.branch,
      path: "",
      branch: req.branch,
      prStatus: null,
      agentStatus: "notRunning",
      column: "inProgress",
      isBranchMode: false,
      additions: null,
      deletions: null,
      repoPath,
      creating: true,
    };

    const { addWorktree, replaceWorktree, failWorktree, setActiveWorktree: activate } =
      useWorkspaceStore.getState();

    addWorktree(placeholder);
    activate(tempId);

    try {
      const realWorktree = await createWorktreeFrom(repoPath, {
        kind: "newBranch",
        name: req.branch,
        base: defaultBaseBranch(repoPath),
      });

      replaceWorktree(tempId, realWorktree);

      // Set the pending prompt before creating the tab so TerminalView picks it up
      useWorkspaceStore.getState().setPendingPrompt(realWorktree.id, req.prompt);

      // Add a pendingLaunch agent tab — this makes the launch overlay appear
      lifecycleManager.addCustomLaunchTab(realWorktree.id);

      // Ensure shell + notes tabs are also present
      useTabStore.getState().ensureDefaultTabs(realWorktree.id);

      // Focus the new worktree and make its agent tab active
      useWorkspaceStore.getState().setActiveWorktree(realWorktree.id);
      focusAgentTab(realWorktree.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const marked = failWorktree(tempId, message);
      if (!marked) {
        useToastStore.getState().show({
          message: `Worktree creation failed: ${message}`,
        });
      }
    }
  }
}
