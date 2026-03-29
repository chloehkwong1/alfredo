import { useCallback, useEffect } from "react";
import { PaneTabBar } from "./PaneTabBar";
import { TerminalView } from "../terminal";
import { ChangesView } from "../changes/ChangesView";
import { PrPanel } from "../changes/PrPanel";
import { useWorkspaceStore } from "../../stores/workspaceStore";
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
  const allTabs = useWorkspaceStore((s) => s.tabs);
  const tabs = allTabs[worktreeId] ?? [];
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const activePaneId = useLayoutStore((s) => s.activePaneId[worktreeId]);
  const isActivePane = activePaneId === paneId;

  const activeTabId = pane?.activeTabId;
  const activeTab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabId);

  const pr = worktree?.prStatus ?? null;
  const prPanelState = useWorkspaceStore((s) => s.prPanelState[worktreeId]);
  const setPrPanelState = useWorkspaceStore((s) => s.setPrPanelState);
  const jumpToComment = useWorkspaceStore((s) => s.jumpToComment[worktreeId]);
  const repoPath = worktree?.path ?? ".";

  const effectivePrPanelState: PrPanelState = prPanelState ?? (pr ? "open" : "collapsed");

  const handleTogglePrPanel = useCallback(() => {
    setPrPanelState(
      worktreeId,
      effectivePrPanelState === "open" ? "collapsed" : "open",
    );
  }, [worktreeId, effectivePrPanelState, setPrPanelState]);

  const handleJumpToComment = useCallback(
    (filePath: string, line: number) => {
      if (jumpToComment) {
        jumpToComment(filePath, line);
      }
    },
    [jumpToComment],
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
