import { useEffect } from "react";
import { useLayoutStore } from "../stores/layoutStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { lifecycleManager } from "../services/lifecycleManager";
import type { WorkspaceTab } from "../types";

/**
 * Global keyboard shortcuts for the workspace:
 * - Cmd+N: open Create Worktree dialog
 * - Cmd+T: new tab of same type as active pane's current tab
 * - Cmd+W: close active tab (unless last tab in pane)
 * - Cmd+R: open Add Repository modal
 * - Cmd+B: toggle sidebar
 * - Cmd+\: split pane right (horizontal)
 * - Cmd+Shift+\: split pane down (vertical)
 * - Cmd+Shift+C: switch to Changes tab in active pane
 * - Cmd+Shift+T: switch to first terminal/claude tab in active pane
 */
export function useKeyboardShortcuts(
  activeWorktreeId: string | null,
  activeTab: WorkspaceTab | undefined,
  tabs: WorkspaceTab[],
  onCreateDialog: () => void,
  onShortcutsOverlay?: () => void,
  onAddRepo?: () => void,
) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Cmd+? (Cmd+Shift+/): show keyboard shortcuts overlay — works even from inputs
      if (event.metaKey && event.shiftKey && event.key === "?") {
        event.preventDefault();
        onShortcutsOverlay?.();
        return;
      }

      // Allow meta-key shortcuts (Cmd+T, Cmd+W, etc.) through even when
      // focus is in a terminal (xterm uses a hidden textarea for input)
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (
        !event.metaKey &&
        (tag === "INPUT" ||
          tag === "TEXTAREA" ||
          (document.activeElement as HTMLElement)?.isContentEditable)
      )
        return;

      // Cmd+R: open Add Repository modal
      if (event.metaKey && !event.shiftKey && event.key === "r") {
        event.preventDefault();
        onAddRepo?.();
        return;
      }

      // Cmd+N: open Create Worktree dialog
      if (event.metaKey && !event.shiftKey && event.key === "n") {
        event.preventDefault();
        onCreateDialog();
        return;
      }

      // Cmd+T: new tab of same type as active pane's current tab
      if (event.metaKey && !event.shiftKey && event.key === "t") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          const pane = activePaneId ? layoutState.panes[activeWorktreeId]?.[activePaneId] : null;
          const paneActiveTab = pane ? tabs.find((t) => t.id === pane.activeTabId) : activeTab;
          const type = (!paneActiveTab || paneActiveTab.type === "changes") ? "claude" : paneActiveTab.type;
          lifecycleManager.addTab(activeWorktreeId, type, activePaneId ?? undefined);
        }
        return;
      }

      // Cmd+Shift+C: switch to Changes tab in active pane
      if (event.metaKey && event.shiftKey && event.key === "C") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          if (activePaneId) {
            const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
            const changesTabId = pane?.tabIds.find((id) => tabs.find((t) => t.id === id && t.type === "changes"));
            if (changesTabId) {
              layoutState.setPaneActiveTab(activeWorktreeId, activePaneId, changesTabId);
            }
          }
        }
        return;
      }

      // Cmd+Shift+T: switch to first terminal/claude tab in active pane
      if (event.metaKey && event.shiftKey && event.key === "T") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          if (activePaneId) {
            const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
            const termTabId = pane?.tabIds.find((id) => tabs.find((t) => t.id === id && t.type !== "changes"));
            if (termTabId) {
              layoutState.setPaneActiveTab(activeWorktreeId, activePaneId, termTabId);
            }
          }
        }
        return;
      }

      // Cmd+W: close active tab (unless it's the last tab in the pane)
      if (event.metaKey && !event.shiftKey && event.key === "w") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          if (activePaneId) {
            const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
            if (pane && pane.tabIds.length > 1 && pane.activeTabId) {
              lifecycleManager.removeTab(activeWorktreeId, pane.activeTabId);
            }
          }
        }
        return;
      }

      // Cmd+B: toggle sidebar
      if (event.metaKey && !event.shiftKey && event.key === "b") {
        event.preventDefault();
        useWorkspaceStore.getState().toggleSidebar();
        return;
      }

      // Cmd+\: split pane right (horizontal)
      if (event.metaKey && !event.shiftKey && event.key === "\\") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          if (activePaneId) {
            const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
            if (pane && pane.tabIds.length >= 2 && pane.activeTabId) {
              layoutState.splitPane(activeWorktreeId, activePaneId, pane.activeTabId, "horizontal");
            }
          }
        }
        return;
      }

      // Cmd+Shift+\: split pane down (vertical)
      if (event.metaKey && event.shiftKey && event.key === "|") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          if (activePaneId) {
            const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
            if (pane && pane.tabIds.length >= 2 && pane.activeTabId) {
              layoutState.splitPane(activeWorktreeId, activePaneId, pane.activeTabId, "vertical");
            }
          }
        }
        return;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorktreeId, activeTab, tabs, onCreateDialog, onShortcutsOverlay, onAddRepo]);
}
