import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { usePrStore } from "../stores/prStore";
import { useLayoutStore } from "../stores/layoutStore";
import { sessionManager } from "./sessionManager";
import { deleteWorktree as deleteWorktreeApi } from "../api";
import { deleteSession as deleteSessionFile } from "./SessionPersistence";
import type { TabType } from "../types";

/**
 * Coordinates lifecycle operations across workspaceStore, layoutStore,
 * and SessionManager. Every method here is a single atomic operation
 * that keeps all three stores consistent.
 *
 * Rule: components should call lifecycleManager for any operation that
 * touches more than one store. Direct store access is fine for reads
 * and single-store mutations (e.g. setActiveTabId).
 */
class LifecycleManager {
  /**
   * Add a tab to a worktree, placing it in the specified pane (or active pane).
   * Returns the new tab's ID, or null if creation failed.
   */
  addTab(worktreeId: string, type: TabType, paneId?: string): string | null {
    const prevTabs = useTabStore.getState().tabs[worktreeId] ?? [];
    useTabStore.getState().addTab(worktreeId, type);
    const newTabs = useTabStore.getState().tabs[worktreeId] ?? [];
    const newTab = newTabs.find((t) => !prevTabs.some((p) => p.id === t.id));
    if (!newTab) return null;

    const layoutState = useLayoutStore.getState();
    const targetPaneId = paneId ?? layoutState.activePaneId[worktreeId];
    if (targetPaneId) {
      layoutState.addTabToPane(worktreeId, targetPaneId, newTab.id);
    }
    return newTab.id;
  }

  /**
   * Remove a tab: close its PTY session, remove from workspace store,
   * and remove from layout pane.
   */
  async removeTab(worktreeId: string, tabId: string): Promise<void> {
    await sessionManager.closeSession(tabId);
    useTabStore.getState().removeTab(worktreeId, tabId);
    useLayoutStore.getState().removeTabFromPane(worktreeId, tabId);
  }

  /**
   * Remove a worktree: clean up all stores, close sessions, delete git
   * worktree, and delete session file. Best-effort — failures in git/fs
   * cleanup don't leave store state inconsistent.
   */
  async removeWorktree(
    worktreeId: string,
    repoPath: string,
    worktreeName: string,
  ): Promise<void> {
    // Snapshot tabs before removing from store
    const tabs = useTabStore.getState().tabs[worktreeId] ?? [];

    // 1. Remove from all stores atomically (synchronous)
    useWorkspaceStore.getState().removeWorktree(worktreeId);
    useTabStore.getState().removeWorktreeTabs(worktreeId);
    usePrStore.getState().removeWorktreeState(worktreeId);
    useLayoutStore.getState().removeLayout(worktreeId);

    // 2. Close PTY sessions (async, best-effort)
    for (const tab of tabs) {
      await sessionManager.closeSession(tab.id).catch((e) => console.warn('[lifecycle] Failed to close session:', tab.id, e));
    }

    // 3. Delete git worktree (async, log failure)
    try {
      await deleteWorktreeApi(repoPath, worktreeName, true);
    } catch (e) {
      console.error("Failed to delete worktree:", e);
    }

    // 4. Delete session file (async, non-critical)
    try {
      await deleteSessionFile(repoPath, worktreeId);
    } catch {
      // Session file may not exist
    }
  }

  /**
   * Initialize a worktree with default tabs and layout.
   * Called after creating a new worktree or when one is missing defaults.
   */
  initWorktreeDefaults(worktreeId: string): void {
    useTabStore.getState().ensureDefaultTabs(worktreeId);
    const layoutState = useLayoutStore.getState();
    if (!layoutState.layout[worktreeId]) {
      const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
      const activeTabId = useTabStore.getState().activeTabId[worktreeId] ?? "";
      if (tabs.length > 0) {
        layoutState.initLayout(worktreeId, tabs.map((t) => t.id), activeTabId);
      }
    }
  }

  /**
   * Sync layout after workspace tabs change (e.g. ensureDefaultTabs added
   * new tabs). Adds any tabs not yet in a pane to the active pane.
   */
  syncTabsToLayout(worktreeId: string): void {
    const layoutState = useLayoutStore.getState();
    const wtLayout = layoutState.layout[worktreeId];
    if (!wtLayout) {
      this.initWorktreeDefaults(worktreeId);
      return;
    }

    const wtTabs = useTabStore.getState().tabs[worktreeId] ?? [];
    const allPaneTabIds = new Set(
      Object.values(layoutState.panes[worktreeId] ?? {}).flatMap((p) => p.tabIds),
    );
    const activePaneId = layoutState.activePaneId[worktreeId];
    for (const tab of wtTabs) {
      if (!allPaneTabIds.has(tab.id) && activePaneId) {
        layoutState.addTabToPane(worktreeId, activePaneId, tab.id);
      }
    }
  }
}

export const lifecycleManager = new LifecycleManager();
