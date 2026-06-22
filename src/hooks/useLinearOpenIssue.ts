import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { takePendingOpenIssue, type OpenIssueRequest } from "../services/linearOpenIssue";
import { createWorktreeFrom } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useToastStore } from "../stores/toastStore";
import { ensureAgentSession, writeToSession, focusAgentTab } from "../services/agentMessenger";
import type { Worktree } from "../types";

/**
 * Listens for Linear "open issue in Alfredo" requests (warm start via event,
 * cold start via the drained buffer) and routes them: toast on an unmanaged
 * repo, else create-or-focus the worktree, launch Claude, and paste the issue
 * prompt into its input for the user to edit and submit.
 */
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

    // Cold-start drain.
    takePendingOpenIssue().then((req) => {
      if (req && !cancelled) void handle(req);
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}

/**
 * Wait until a freshly-spawned agent's boot output has settled, so a pasted
 * prompt lands in the input box instead of colliding with the still-rendering
 * boot banner. Resolves once output has been quiet for `quietMs`, or after
 * `timeoutMs` (paste anyway rather than hang). Reads the live, mutable session
 * object returned by ensureAgentSession.
 */
async function waitForAgentReady(
  session: { lastOutputAt: number; agentState: string },
  { quietMs = 1200, timeoutMs = 20000 }: { quietMs?: number; timeoutMs?: number } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const booted = session.lastOutputAt > 0;
    const settled = Date.now() - session.lastOutputAt > quietMs;
    const notBusy = session.agentState !== "busy" && session.agentState !== "notRunning";
    if (booted && settled && notBusy) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function routeOpenIssue(req: OpenIssueRequest): Promise<void> {
  const repoPath = req.matchedRepoPath;
  if (!repoPath) {
    useToastStore.getState().show({
      message: `Open in Alfredo: "${req.workdir}" isn't a repo Alfredo manages. Add it first, then retry from Linear.`,
    });
    return;
  }

  const worktreeId = `${repoPath}::${req.branch}`;

  // Create the worktree if it doesn't exist yet. Mirror CreateWorktreeDialog's
  // proven flow EXACTLY (placeholder → create → replace → ensureDefaultTabs) —
  // in particular, do NOT activate the placeholder (a creating:true, path:""
  // worktree); activating it wedges the layout.
  if (!useWorkspaceStore.getState().worktrees.some((wt) => wt.id === worktreeId)) {
    const placeholder: Worktree = {
      id: worktreeId,
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
    useWorkspaceStore.getState().addWorktree(placeholder);
    try {
      const real = await createWorktreeFrom(repoPath, {
        kind: "newBranch",
        name: req.branch,
        base: "main", // TODO: resolve the repo's real default branch instead of assuming main
      });
      useWorkspaceStore.getState().replaceWorktree(worktreeId, real);
      try {
        useTabStore.getState().ensureDefaultTabs(real.id);
      } catch (e) {
        console.error("[linear] ensureDefaultTabs failed:", e);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const marked = useWorkspaceStore.getState().failWorktree(worktreeId, message);
      if (!marked) {
        useToastStore.getState().show({ message: `Worktree creation failed: ${message}` });
      }
      return;
    }
  }

  // Navigate to the worktree, ensure a Claude session is running, wait until it
  // has finished booting, then paste the issue prompt into its input — the same
  // primitive as "send PR comment to Claude" (sendPrCommentToClaude.ts), plus a
  // readiness wait so a fresh-spawn prompt doesn't collide with the boot banner.
  // The user edits and submits.
  useWorkspaceStore.getState().setActiveWorktree(worktreeId);
  let session;
  try {
    session = await ensureAgentSession(worktreeId, repoPath, req.branch);
  } catch {
    return;
  }
  if (session?.sessionId) {
    await waitForAgentReady(session);
    await writeToSession(session.sessionId, req.prompt);
  }
  focusAgentTab(worktreeId);
}
