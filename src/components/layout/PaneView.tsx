import { useCallback, useEffect } from "react";
import { PaneTabBar } from "./PaneTabBar";
import { TerminalView } from "../terminal";
import { ChangesView } from "../changes/ChangesView";
import { PrPanel } from "../changes/PrPanel";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { usePrStore } from "../../stores/prStore";
import { useLayoutStore } from "../../stores/layoutStore";
import type { PrPanelState, WorkspaceTab } from "../../types";

interface PaneViewProps {
  paneId: string;
  worktreeId: string;
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
}

function PaneView({
  paneId,
  worktreeId,
  onToggleServer,
  isServerRunning,
  runScriptName,
}: PaneViewProps) {
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === worktreeId),
  );
  const allTabs = useTabStore((s) => s.tabs);
  const tabs = allTabs[worktreeId] ?? [];
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const activePaneId = useLayoutStore((s) => s.activePaneId[worktreeId]);
  const isActivePane = activePaneId === paneId;

  const activeTabId = pane?.activeTabId;
  const activeTab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabId);

  const pr = worktree?.prStatus ?? null;
  const prPanelState = usePrStore((s) => s.prPanelState[worktreeId]);
  const setPrPanelState = usePrStore((s) => s.setPrPanelState);
  const repoPath = worktree?.repoPath ?? worktree?.path ?? ".";

  const effectivePrPanelState: PrPanelState = prPanelState ?? (pr ? "open" : "collapsed");

  const handleTogglePrPanel = useCallback(() => {
    setPrPanelState(
      worktreeId,
      effectivePrPanelState === "open" ? "collapsed" : "open",
    );
  }, [worktreeId, effectivePrPanelState, setPrPanelState]);

  const setPaneActiveTab = useLayoutStore((s) => s.setPaneActiveTab);

  const handleJumpToComment = useCallback(
    (filePath: string, line: number) => {
      // If Changes tab isn't active, switch to it first
      const changesTab = tabs.find((t) => t.type === "changes");
      if (changesTab && activeTab?.type !== "changes") {
        setPaneActiveTab(worktreeId, paneId, changesTab.id);
        // Poll for the jumpToComment callback to appear (registered by ChangesView on mount)
        let attempts = 0;
        const poll = setInterval(() => {
          attempts++;
          const fn = usePrStore.getState().jumpToComment[worktreeId];
          if (fn) {
            clearInterval(poll);
            fn(filePath, line);
          } else if (attempts >= 20) {
            clearInterval(poll);
            console.warn("[PaneView] jumpToComment callback not registered after 2s");
          }
        }, 100);
      } else {
        // Read fresh from store — not from the stale closure
        const fn = usePrStore.getState().jumpToComment[worktreeId];
        if (fn) {
          fn(filePath, line);
        }
      }
    },
    [tabs, activeTab, worktreeId, paneId, setPaneActiveTab],
  );

  useEffect(() => {
    if (!pr) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "i" && e.metaKey) {
        e.preventDefault();
        setPrPanelState(
          worktreeId,
          effectivePrPanelState === "open" ? "collapsed" : "open",
        );
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [pr, worktreeId, effectivePrPanelState, setPrPanelState]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PaneTabBar
        paneId={paneId}
        worktreeId={worktreeId}
        isActivePane={isActivePane}
        onToggleServer={onToggleServer}
        isServerRunning={isServerRunning}
        runScriptName={runScriptName}
      />
      <div className="flex flex-1 min-h-0">
        <div className="flex-1 min-h-0 min-w-0 relative">
          {(activeTab?.type === "claude" || activeTab?.type === "shell" || activeTab?.type === "server") && (
            <TerminalView
              key={activeTab.id}
              tabId={activeTab.id}
              tabType={activeTab.type}
            />
          )}
          {activeTab?.type === "changes" && (
            <ChangesView
              worktreeId={worktreeId}
              repoPath={repoPath}
            />
          )}
        </div>
        {pr && (
          <PrPanel
            worktreeId={worktreeId}
            repoPath={repoPath}
            pr={pr}
            panelState={effectivePrPanelState}
            onTogglePanel={handleTogglePrPanel}
            onJumpToComment={handleJumpToComment}
          />
        )}
      </div>
    </div>
  );
}

export { PaneView };
