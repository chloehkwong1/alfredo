import { PaneTabBar } from "./PaneTabBar";
import { TerminalView } from "../terminal";
import { ChangesView } from "../changes/ChangesView";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import type { WorkspaceTab } from "../../types";

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
      <div className="flex-1 min-h-0 relative">
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
            repoPath={worktree?.path ?? "."}
          />
        )}
      </div>
    </div>
  );
}

export { PaneView };
