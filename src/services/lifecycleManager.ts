import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { usePrStore } from "../stores/prStore";
import { useLayoutStore } from "../stores/layoutStore";
import { sessionManager } from "./sessionManager";
import { deleteWorktree as deleteWorktreeApi } from "../api";
import { deleteSession as deleteSessionFile } from "./SessionPersistence";
import type { TabType, DiffTarget, WorkspaceTab } from "../types";

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
   * Open a diff preview tab in the active pane for the given worktree.
   * If a preview tab already exists, updates its diffTarget in place.
   * Returns the tab ID, or null if no active pane exists.
   */
  openDiffPreview(worktreeId: string, diffTarget: DiffTarget): string | null {
    const layoutState = useLayoutStore.getState();
    const activePaneId = layoutState.activePaneId[worktreeId];
    if (!activePaneId) return null;

    const pane = layoutState.getPane(worktreeId, activePaneId);

    // Check if a pinned tab already exists for this target in the same pane
    const allTabs = useTabStore.getState().tabs[worktreeId] ?? [];
    const existingPinned = pane?.tabIds
      .filter((id) => id !== pane.previewTabId)
      .map((id) => allTabs.find((t) => t.id === id))
      .find((t) => {
        if (!t || t.type !== "diff" || !t.diffTarget) return false;
        if (diffTarget.type === "file") return t.diffTarget.type === "file" && t.diffTarget.filePath === diffTarget.filePath;
        if (diffTarget.type === "commit") return t.diffTarget.type === "commit" && t.diffTarget.commitHash === diffTarget.commitHash;
        return false;
      });

    if (existingPinned) {
      // Focus the existing pinned tab instead of creating a duplicate
      layoutState.setPaneActiveTab(worktreeId, activePaneId, existingPinned.id);

      // Clean up the orphaned preview tab — the user navigated away from it
      const previewTabId = pane?.previewTabId;
      if (previewTabId) {
        layoutState.removeTabFromPane(worktreeId, previewTabId);
        useTabStore.getState().removeTab(worktreeId, previewTabId);
      }

      return existingPinned.id;
    }

    const existingPreviewId = pane?.previewTabId;

    // If there's an existing preview tab, update its diffTarget instead of creating a new one
    if (existingPreviewId) {
      const label = diffTarget.type === "file"
        ? (diffTarget.filePath?.split("/").pop() ?? "Diff")
        : (diffTarget.commitHash?.slice(0, 7) ?? "Commit");
      useTabStore.getState().updateTab(worktreeId, existingPreviewId, {
        diffTarget,
        label,
      });
      layoutState.setPaneActiveTab(worktreeId, activePaneId, existingPreviewId);
      return existingPreviewId;
    }

    // Create a new diff tab
    const label = diffTarget.type === "file"
      ? (diffTarget.filePath?.split("/").pop() ?? "Diff")
      : (diffTarget.commitHash?.slice(0, 7) ?? "Commit");

    const tabId = `${worktreeId}:diff:${crypto.randomUUID().slice(0, 8)}`;
    const tab: WorkspaceTab = {
      id: tabId,
      type: "diff",
      label,
      diffTarget,
    };

    // Add to tab store directly (append to existing tabs)
    const existingTabs = useTabStore.getState().tabs[worktreeId] ?? [];
    useTabStore.getState().restoreTabs(worktreeId, [...existingTabs, tab], tabId);

    // Open as preview in active pane
    layoutState.openPreviewTab(worktreeId, activePaneId, tabId);

    return tabId;
  }

  /**
   * Pin the current preview tab in the active pane (implicit pinning when
   * the user interacts with diff content).
   */
  pinCurrentPreview(worktreeId: string): void {
    const layoutState = useLayoutStore.getState();
    const activePaneId = layoutState.activePaneId[worktreeId];
    if (!activePaneId) return;
    layoutState.pinPreviewTab(worktreeId, activePaneId);
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
    const wtTabIds = new Set(wtTabs.map((t) => t.id));
    const allPaneTabIds = new Set(
      Object.values(layoutState.panes[worktreeId] ?? {}).flatMap((p) => p.tabIds),
    );
    const activePaneId = layoutState.activePaneId[worktreeId];

    // Add orphaned tabs (in tabStore but not in any pane) to the active pane
    for (const tab of wtTabs) {
      if (!allPaneTabIds.has(tab.id) && activePaneId) {
        layoutState.addTabToPane(worktreeId, activePaneId, tab.id);
      }
    }

    // Prune stale tabIds from panes and collapse any that become empty
    const panes = layoutState.panes[worktreeId] ?? {};
    for (const [, pane] of Object.entries(panes)) {
      const staleIds = pane.tabIds.filter((id) => !wtTabIds.has(id));
      if (staleIds.length > 0) {
        for (const staleId of staleIds) {
          layoutState.removeTabFromPane(worktreeId, staleId);
        }
      }
    }
  }
}

export const lifecycleManager = new LifecycleManager();
