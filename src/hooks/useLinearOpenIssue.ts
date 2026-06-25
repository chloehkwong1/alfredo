import { useEffect, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { takePendingOpenIssue, type OpenIssueRequest } from "../services/linearOpenIssue";
import { useToastStore } from "../stores/toastStore";
import {
  prepareOpenIssue,
  openIssueInRepo,
  OPEN_ISSUE_PICK_REPO_EVENT,
  type OpenIssuePayload,
} from "../services/openIssueFlow";

/**
 * Listens for Linear "open issue in Alfredo" requests (warm start via event,
 * cold start via the drained buffer) and routes them: when the backend resolved
 * a managed repo (legacy argv / `--workdir` path) it opens the worktree and
 * pastes the prompt directly; otherwise (Linear "Custom link" mode sends no
 * workdir) it asks the user to pick a repo via OpenIssueRepoPicker.
 */
export function useLinearOpenIssue() {
  const inFlight = useRef<Set<string>>(new Set());

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    let cancelled = false;

    const handle = async (req: OpenIssueRequest) => {
      const issue = prepareOpenIssue(req);
      const key = `${req.matchedRepoPath ?? ""}::${issue.branch || issue.issueId || req.prompt.slice(0, 40)}`;
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      try {
        await routeOpenIssue(req, issue);
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

async function routeOpenIssue(req: OpenIssueRequest, issue: OpenIssuePayload): Promise<void> {
  if (!issue.branch) {
    useToastStore.getState().show({
      message: "Open in Alfredo: couldn't determine a branch for this Linear issue.",
    });
    return;
  }

  // Backend matched a managed repo (argv / `--workdir`): open it directly.
  if (req.matchedRepoPath) {
    await openIssueInRepo(req.matchedRepoPath, issue);
    return;
  }

  // No repo to match on (Custom link sends no workdir) — let the user pick one.
  // OpenIssueRepoPicker (AppShell) has the repo list and runs openIssueInRepo.
  window.dispatchEvent(new CustomEvent(OPEN_ISSUE_PICK_REPO_EVENT, { detail: issue }));
}
