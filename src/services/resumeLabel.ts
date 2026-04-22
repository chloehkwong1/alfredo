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
  const { updateTab, setTabSummary } = useTabStore.getState();
  updateTab(worktreeId, tabId, { resumeSessionId: sessionId });

  if (!sessionId) {
    setTabSummary(worktreeId, tabId, null);
    return;
  }

  getSessionSummary(sessionId, worktreePath)
    .then((summary) => {
      // Check that the tab is still pointing at the same session by the time
      // the fetch resolves — user may have rotated sessions in between.
      const current = useTabStore
        .getState()
        .tabs[worktreeId]?.find((t) => t.id === tabId)?.resumeSessionId;
      if (current !== sessionId) return;
      useTabStore.getState().setTabSummary(worktreeId, tabId, summary);
    })
    .catch((e) => {
      console.warn(
        `[resumeLabel] Failed to fetch session summary for ${sessionId}:`,
        e,
      );
    });
}
