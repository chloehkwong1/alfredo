import { useTabStore } from "../stores/tabStore";
import { getSessionSummary } from "../api";

/**
 * Set (or clear) a tab's `resumeSessionId` and fetch its JSONL-derived
 * conversation summary from Claude's session file. Fire-and-forget on the
 * summary fetch — the UI updates when it resolves.
 *
 * Clearing (`sessionId === undefined`) also clears any existing summary.
 *
 * This is the single entry point for mutating `resumeSessionId` across the
 * app so the JSONL label stays in sync with which session the tab points at.
 */
export function setResumeSessionId(
  worktreeId: string,
  tabId: string,
  sessionId: string | undefined,
  worktreePath: string,
): void {
  const store = useTabStore.getState();
  const prevSessionId = store.tabs[worktreeId]?.find((t) => t.id === tabId)
    ?.resumeSessionId;
  const sessionChanged = prevSessionId !== sessionId;

  store.updateTab(worktreeId, tabId, { resumeSessionId: sessionId });

  if (!sessionId) {
    store.setTabSummary(worktreeId, tabId, null);
    return;
  }

  // On session rotation, eagerly clear the stale summary so the old label
  // doesn't linger while we fetch. Same-session polls keep the existing
  // summary until a non-null fetch replaces it.
  if (sessionChanged) {
    store.setTabSummary(worktreeId, tabId, null);
  }

  getSessionSummary(sessionId, worktreePath)
    .then((summary) => {
      // Check that the tab is still pointing at the same session by the time
      // the fetch resolves — user may have rotated sessions in between.
      const current = useTabStore
        .getState()
        .tabs[worktreeId]?.find((t) => t.id === tabId)?.resumeSessionId;
      if (current !== sessionId) return;
      // Avoid clobbering a good summary with a transient null — e.g. the
      // next poll after /clear where Claude hasn't written last-prompt yet.
      // The eager clear above already handled the session-rotation case.
      if (summary === null && !sessionChanged) return;
      useTabStore.getState().setTabSummary(worktreeId, tabId, summary);
    })
    .catch((e) => {
      console.warn(
        `[resumeLabel] Failed to fetch session summary for ${sessionId}:`,
        e,
      );
    });
}
