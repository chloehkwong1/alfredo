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
function collectAndSaveAllSessions() {
  const state = useWorkspaceStore.getState();
  const tabState = useTabStore.getState();
  const prState = usePrStore.getState();

  // Group worktrees by their actual repo path so each session is saved
  // under the correct repo — otherwise cross-repo worktrees lose their
  // session data (including columnOverrides) on restore.
  const byRepo = new Map<string, string[]>();
  for (const wt of state.worktrees) {
    if (wt.creating || wt.createError) continue;
    const repo = wt.repoPath;
    let ids = byRepo.get(repo);
    if (!ids) {
      ids = [];
      byRepo.set(repo, ids);
    }
    ids.push(wt.id);
  }

  const getters = {
    getTabs: (wtId: string) => tabState.tabs[wtId] ?? [],
    getActiveTabId: (wtId: string) => tabState.activeTabId[wtId] ?? "",
    getScrollback: (tabId: string) => sessionManager.getBufferedOutputBase64(tabId),
    getLayout: (wtId: string) => useLayoutStore.getState().layout[wtId],
    getPanes: (wtId: string) => useLayoutStore.getState().panes[wtId],
    getActivePaneId: (wtId: string) => useLayoutStore.getState().activePaneId[wtId],
    getColumn: (wtId: string) => state.worktrees.find((wt) => wt.id === wtId)?.column,
    getDiffViewMode: (wtId: string) => state.diffViewMode[wtId],
    getColumnOverride: (wtId: string) => {
      const o = prState.columnOverrides[wtId];
      if (!o) return null;
      // Strip needsMigration flag — only used in-memory during legacy migration
      const { needsMigration: _, ...rest } = o;
      return rest;
    },
    getPrPanelState: (wtId: string) => prState.prPanelState[wtId],
    getChangesViewMode: (wtId: string) => state.changesViewMode[wtId],
    getChangesPanelCollapsed: (wtId: string) => state.changesPanelCollapsed[wtId],
    getSeenWorktree: (wtId: string) => state.seenWorktrees.has(wtId) || undefined,
    getUnreadWorktree: (wtId: string) => state.unreadWorktrees.has(wtId) || undefined,
    getClaudeSessionId: (wtId: string) => state.worktrees.find((wt) => wt.id === wtId)?.claudeSessionId,
    getArchived: (wtId: string) => state.worktrees.find((wt) => wt.id === wtId)?.archived || undefined,
    getArchivedAt: (wtId: string) => state.worktrees.find((wt) => wt.id === wtId)?.archivedAt,
    getAnnotations: (wtId: string) => state.annotations[wtId]?.length ? state.annotations[wtId] : undefined,
  };

  const saves = [...byRepo.entries()].map(([repo, worktreeIds]) =>
    saveAllSessions(
      repo,
      worktreeIds,
      getters.getTabs,
      getters.getActiveTabId,
      getters.getScrollback,
      getters.getLayout,
      getters.getPanes,
      getters.getActivePaneId,
      getters.getColumn,
      getters.getDiffViewMode,
      getters.getColumnOverride,
      getters.getPrPanelState,
      getters.getChangesViewMode,
      getters.getChangesPanelCollapsed,
      getters.getSeenWorktree,
      getters.getUnreadWorktree,
      getters.getClaudeSessionId,
      getters.getArchived,
      getters.getArchivedAt,
      getters.getAnnotations,
    ),
  );
  return Promise.allSettled(saves);
}

export function useSessionAutoSave(repoPath: string | null, hasWorktrees: boolean): void {
  // Save sessions on app quit (only when worktrees exist — not during onboarding)
  useEffect(() => {
    if (!repoPath || !hasWorktrees) return;

    const currentWindow = getCurrentWindow();
    const unlisten = currentWindow.onCloseRequested(async (event) => {
      event.preventDefault();
      await collectAndSaveAllSessions();
      await currentWindow.destroy();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [repoPath, hasWorktrees]);

  // Save on page refresh — beforeunload fires on Cmd+R but onCloseRequested
  // does not, so without this handler session data can be up to 30s stale.
  // Best-effort: the browser may not wait for async IPC to complete.
  useEffect(() => {
    if (!repoPath || !hasWorktrees) return;

    const handleBeforeUnload = () => {
      collectAndSaveAllSessions().catch(() => {});
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [repoPath, hasWorktrees]);

  // Debounced auto-save every 30s (only when worktrees exist)
  useEffect(() => {
    if (!repoPath || !hasWorktrees) return;

    const interval = setInterval(() => {
      collectAndSaveAllSessions()
        .catch((err) => console.error("Auto-save failed:", err));
    }, AUTO_SAVE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [repoPath, hasWorktrees]);
}
