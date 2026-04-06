import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { usePrStore } from "../../stores/prStore";
import { saveAllSessions } from "../../services/SessionPersistence";
import { sessionManager } from "../../services/sessionManager";

const AUTO_SAVE_INTERVAL_MS = 30_000;

/** Snapshot current workspace + layout state and persist all sessions to disk. */
function collectAndSaveAllSessions(repoPath: string) {
  const state = useWorkspaceStore.getState();
  const tabState = useTabStore.getState();
  const prState = usePrStore.getState();
  const worktreeIds = state.worktrees
    .filter((wt) => !wt.creating && !wt.createError)
    .map((wt) => wt.id);
  return saveAllSessions(
    repoPath,
    worktreeIds,
    (wtId) => tabState.tabs[wtId] ?? [],
    (wtId) => tabState.activeTabId[wtId] ?? "",
    (tabId) => sessionManager.getBufferedOutputBase64(tabId),
    (wtId) => useLayoutStore.getState().layout[wtId],
    (wtId) => useLayoutStore.getState().panes[wtId],
    (wtId) => useLayoutStore.getState().activePaneId[wtId],
    (wtId) => state.worktrees.find((wt) => wt.id === wtId)?.column,
    (wtId) => state.diffViewMode[wtId],
    (wtId) => prState.columnOverrides[wtId] ?? null,
    (wtId) => prState.prPanelState[wtId],
    (wtId) => state.changesViewMode[wtId],
    (wtId) => state.changesPanelCollapsed[wtId],
    (wtId) => state.seenWorktrees.has(wtId) || undefined,
    (wtId) => state.unreadWorktrees.has(wtId) || undefined,
    (wtId) => state.worktrees.find((wt) => wt.id === wtId)?.claudeSessionId,
    (wtId) => state.worktrees.find((wt) => wt.id === wtId)?.archived || undefined,
    (wtId) => state.worktrees.find((wt) => wt.id === wtId)?.archivedAt,
    (wtId) => state.annotations[wtId]?.length ? state.annotations[wtId] : undefined,
  );
}

export function useSessionAutoSave(repoPath: string | null, hasWorktrees: boolean): void {
  // Save sessions on app quit (only when worktrees exist — not during onboarding)
  useEffect(() => {
    if (!repoPath || !hasWorktrees) return;

    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await collectAndSaveAllSessions(repoPath);
      await currentWindow.destroy();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [repoPath, hasWorktrees]);

  // Debounced auto-save every 30s (only when worktrees exist)
  useEffect(() => {
    if (!repoPath || !hasWorktrees) return;

    const interval = setInterval(() => {
      collectAndSaveAllSessions(repoPath)
        .catch((err) => console.error("Auto-save failed:", err));
    }, AUTO_SAVE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [repoPath, hasWorktrees]);
}
