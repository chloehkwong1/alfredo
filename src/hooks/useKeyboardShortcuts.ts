import { useEffect } from "react";
import { useLayoutStore } from "../stores/layoutStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useAppConfigStore } from "../stores/appConfigStore";
import { lifecycleManager } from "../services/lifecycleManager";
import { sessionManager } from "../services/sessionManager";
import { zoomIn, zoomOut, zoomReset } from "../services/uiZoom";
import { loadTerminalPreferences, saveTerminalPreferences, TERMINAL_DEFAULTS } from "../services/terminalPreferences";
import { getGroupForTab } from "../lib/tabGroups";
import type { WorkspaceTab } from "../types";

/**
 * Global keyboard shortcuts for the workspace:
 * - Cmd+N: open Create Worktree dialog
 * - Cmd+T: new tab of same type as active pane's current tab
 * - Cmd+W: close active tab (unless last tab in pane)
 * - Cmd+R: reload/refresh the app
 * - Cmd+Shift+R: open Add Repository modal
 * - Cmd+B: toggle sidebar
 * - Cmd+\: split pane right (horizontal)
 * - Cmd+Shift+\: split pane down (vertical)
 * - Cmd+Shift+C: toggle changes side panel
 * - Cmd+Shift+T: switch to first terminal/claude tab in active pane
 * - Cmd+Option+Left/Right: previous/next tab in active pane (wraps)
 * - Cmd+K: clear active terminal
 * - Cmd+Plus / Cmd+Minus / Cmd+0: zoom — affects only the focused terminal's
 *   font size when an xterm has focus, otherwise zooms the whole UI
 */
export function useKeyboardShortcuts(
  activeWorktreeId: string | null,
  activeTab: WorkspaceTab | undefined,
  tabs: WorkspaceTab[],
  onCreateDialog: () => void,
  onShortcutsOverlay?: () => void,
  onAddRepo?: () => void,
  onCommandPalette?: () => void,
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

      // Cmd+Shift+P: open command palette
      if (event.metaKey && event.shiftKey && event.key === "p") {
        event.preventDefault();
        onCommandPalette?.();
        return;
      }

      // Cmd+R: reload/refresh the app
      if (event.metaKey && !event.shiftKey && event.key === "r") {
        event.preventDefault();
        window.location.reload();
        return;
      }

      // Cmd+Shift+R: open Add Repository modal
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "r") {
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
          const type = !paneActiveTab ? "claude" : paneActiveTab.type;
          lifecycleManager.addTab(activeWorktreeId, type, activePaneId);
        }
        return;
      }

      // Cmd+Shift+C: toggle changes side panel
      if (event.metaKey && event.shiftKey && event.key === "C") {
        event.preventDefault();
        if (activeWorktreeId) {
          const wsState = useWorkspaceStore.getState();
          const current = wsState.changesPanelCollapsed[activeWorktreeId] ?? false;
          wsState.setChangesPanelCollapsed(activeWorktreeId, !current);
        }
        return;
      }

      // Cmd+Shift+T: switch to first terminal (shell) tab in active pane
      if (event.metaKey && event.shiftKey && event.key === "T") {
        event.preventDefault();
        if (activeWorktreeId) {
          const allTabs = useTabStore.getState().tabs[activeWorktreeId] ?? [];
          const shellTab = allTabs.find((t) => t.type === "shell");
          if (shellTab) {
            useTabStore.getState().setActiveTabId(activeWorktreeId, shellTab.id);
          }
        }
        return;
      }

      // Cmd+Option+Left / Cmd+Option+Right: cycle tabs in active pane (wraps).
      // When `groupedTabs` is on, cycling is scoped to the active group so we
      // don't silently flip the switcher to a different category mid-cycle.
      if (
        event.metaKey &&
        event.altKey &&
        !event.shiftKey &&
        (event.key === "ArrowLeft" || event.key === "ArrowRight")
      ) {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          const pane = activePaneId ? layoutState.panes[activeWorktreeId]?.[activePaneId] : null;
          if (pane && pane.tabIds.length > 1 && pane.activeTabId) {
            const grouped = useAppConfigStore.getState().config?.groupedTabs ?? true;
            const allTabs = useTabStore.getState().tabs[activeWorktreeId] ?? [];
            const activeTabObj = allTabs.find((t) => t.id === pane.activeTabId);
            let cycleIds: string[];
            if (grouped && activeTabObj) {
              const activeGroup = getGroupForTab(activeTabObj);
              cycleIds = activeGroup
                ? pane.tabIds.filter((id) => {
                    const t = allTabs.find((x) => x.id === id);
                    return t && getGroupForTab(t) === activeGroup;
                  })
                : pane.tabIds;
            } else {
              cycleIds = pane.tabIds;
            }
            if (cycleIds.length > 1) {
              const idx = cycleIds.indexOf(pane.activeTabId);
              if (idx !== -1) {
                const delta = event.key === "ArrowRight" ? 1 : -1;
                const nextId = cycleIds[(idx + delta + cycleIds.length) % cycleIds.length];
                layoutState.setPaneActiveTab(activeWorktreeId, activePaneId, nextId);
                useTabStore.getState().setActiveTabId(activeWorktreeId, nextId);
              }
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

      // Cmd+K: clear active terminal
      if (event.metaKey && !event.shiftKey && event.key === "k") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          const pane = activePaneId ? layoutState.panes[activeWorktreeId]?.[activePaneId] : null;
          const tabId = pane?.activeTabId;
          const sessionKey = tabId ?? activeWorktreeId;
          const session = sessionManager.getSession(sessionKey);
          if (session) {
            session.terminal.clear();
          }
        }
        return;
      }

      // Cmd+Shift+K: rebuild WebGL glyph atlas for the active terminal.
      // Recovery path for rare xterm WebGL atlas/cell-buffer desyncs that
      // produce floating chars and missing letters and that survive scroll
      // and refresh — only an atlas rebuild fixes them.
      if (event.metaKey && event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (activeWorktreeId) {
          const layoutState = useLayoutStore.getState();
          const activePaneId = layoutState.activePaneId[activeWorktreeId];
          const pane = activePaneId ? layoutState.panes[activeWorktreeId]?.[activePaneId] : null;
          const tabId = pane?.activeTabId;
          const sessionKey = tabId ?? activeWorktreeId;
          const session = sessionManager.getSession(sessionKey);
          if (session) {
            if (session.webglAddon) {
              session.webglAddon.clearTextureAtlas();
            } else {
              session.terminal.refresh(0, session.terminal.rows - 1);
            }
          }
        }
        return;
      }

      // Cmd+= / Cmd++ / Cmd+- / Cmd+0: terminal-only when an xterm has focus,
      // whole-UI zoom otherwise.
      if (
        event.metaKey &&
        !event.shiftKey &&
        (event.key === "=" || event.key === "+" || event.key === "-" || event.key === "0")
      ) {
        event.preventDefault();
        const inTerminal = !!(document.activeElement as HTMLElement | null)
          ?.closest?.('.xterm');
        if (inTerminal) {
          const prefs = loadTerminalPreferences();
          if (event.key === "0") {
            saveTerminalPreferences({ ...prefs, fontSize: TERMINAL_DEFAULTS.fontSize });
          } else if (event.key === "-") {
            if (prefs.fontSize > 8) {
              saveTerminalPreferences({ ...prefs, fontSize: prefs.fontSize - 1 });
            }
          } else if (prefs.fontSize < 24) {
            saveTerminalPreferences({ ...prefs, fontSize: prefs.fontSize + 1 });
          }
        } else if (event.key === "0") {
          void zoomReset();
        } else if (event.key === "-") {
          void zoomOut();
        } else {
          void zoomIn();
        }
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
  }, [activeWorktreeId, activeTab, tabs, onCreateDialog, onShortcutsOverlay, onAddRepo, onCommandPalette]);
}
