import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { usePrStore } from "../../stores/prStore";
import { saveAllSessions } from "../../services/SessionPersistence";
import { sessionManager } from "../../services/sessionManager";
import { flushAllPendingNotes } from "../../services/notesAutosave";

const AUTO_SAVE_INTERVAL_MS = 30_000;
const LOG_PREFIX = "[useSessionAutoSave]";

/**
 * Module-level guard so the 30s interval, beforeunload, and the close handler
 * cannot run overlapping saves against the same session files. If a save is
 * already in flight, new callers await the existing promise instead of
 * starting a second pass.
 */
let inFlightSave: Promise<unknown> | null = null;

function collectAndSaveAllSessionsOnce(): Promise<unknown> {
  if (inFlightSave) return inFlightSave;
  const p = collectAndSaveAllSessions().finally(() => {
    if (inFlightSave === p) inFlightSave = null;
  });
  inFlightSave = p;
  return p;
}

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
    getPinnedWorktree: (wtId: string) => state.pinnedWorktrees.has(wtId) || undefined,
    getClaudeSessionId: (wtId: string) => state.worktrees.find((wt) => wt.id === wtId)?.claudeSessionId,
    getLastCustomCommand: (wtId: string) => state.lastCustomCommand[wtId],
    getArchived: (wtId: string) => state.worktrees.find((wt) => wt.id === wtId)?.archived || undefined,
    getArchivedAt: (wtId: string) => state.worktrees.find((wt) => wt.id === wtId)?.archivedAt,
    getUnarchivedAt: (wtId: string) => state.worktrees.find((wt) => wt.id === wtId)?.unarchivedAt,
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
      getters.getPinnedWorktree,
      getters.getClaudeSessionId,
      getters.getLastCustomCommand,
      getters.getArchived,
      getters.getArchivedAt,
      getters.getUnarchivedAt,
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
      try {
        await collectAndSaveAllSessionsOnce();
      } catch (err) {
        console.error(`${LOG_PREFIX} session save on close failed:`, err);
      }
      try {
        await flushAllPendingNotes();
      } catch (err) {
        console.error(`${LOG_PREFIX} notes flush on close failed:`, err);
      }
      try {
        await currentWindow.destroy();
      } catch (err) {
        // If destroy throws, the window stays open — log loudly and tell the
        // user via a dialog so they don't hit a silent dead button again.
        // (close() is not a valid fallback: it re-fires onCloseRequested and
        // would loop into this same handler.)
        console.error(
          `${LOG_PREFIX} window destroy failed — close button will appear dead:`,
          err,
        );
        try {
          await message(
            "Alfredo couldn't close its window. Please use Cmd+Q to quit, then report this bug.",
            { title: "Close failed", kind: "error" },
          );
        } catch {
          // If even the dialog fails, there's nothing left to do.
        }
      }
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
      collectAndSaveAllSessionsOnce().catch((e) => console.error("Failed to save sessions on unload:", e));
      flushAllPendingNotes().catch((e) => console.error("Failed to flush notes on unload:", e));
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [repoPath, hasWorktrees]);

  // Debounced auto-save every 30s (only when worktrees exist)
  useEffect(() => {
    if (!repoPath || !hasWorktrees) return;

    const interval = setInterval(() => {
      collectAndSaveAllSessionsOnce()
        .catch((err) => console.error(`${LOG_PREFIX} auto-save failed:`, err));
    }, AUTO_SAVE_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [repoPath, hasWorktrees]);
}
