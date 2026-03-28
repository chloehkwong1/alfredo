import { useEffect } from "react";
import { useLayoutStore } from "../stores/layoutStore";
import { lifecycleManager } from "../services/lifecycleManager";
import type { WorkspaceTab } from "../types";

/**
 * Global keyboard shortcuts for the workspace:
 * - Cmd+N: open Create Worktree dialog
 * - Cmd+T: new tab of same type as active pane's current tab
 * - Cmd+Shift+C: switch to Changes tab in active pane
 * - Cmd+Shift+T: switch to first terminal/claude tab in active pane
 */
export function useKeyboardShortcuts(
  activeWorktreeId: string | null,
  activeTab: WorkspaceTab | undefined,
  tabs: WorkspaceTab[],
  onCreateDialog: () => void,
) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      )
        return;

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
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeWorktreeId, activeTab, tabs, onCreateDialog]);
}
