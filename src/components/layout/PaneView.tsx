import { PaneTabBar } from "./PaneTabBar";
import { TerminalView } from "../terminal";
import { ChangesView } from "../changes/ChangesView";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import type { WorkspaceTab } from "../../types";

interface PaneViewProps {
  paneId: string;
  worktreeId: string;
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
  runScriptUrl?: string;
}

function PaneView({
  paneId,
  worktreeId,
  onToggleServer,
  isServerRunning,
  runScriptName,
  runScriptUrl,
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

  const repoPath = worktree?.path ?? ".";

  return (
    <div className="flex flex-col h-full min-h-0">
      <PaneTabBar
        paneId={paneId}
        worktreeId={worktreeId}
        isActivePane={isActivePane}
        onToggleServer={onToggleServer}
        isServerRunning={isServerRunning}
        runScriptName={runScriptName}
        runScriptUrl={runScriptUrl}
      />
      <div className="flex-1 min-h-0 min-w-0 relative">
        {(activeTab?.type === "claude" || activeTab?.type === "shell" || activeTab?.type === "server") && (
          <TerminalView key={activeTab.id} tabId={activeTab.id} tabType={activeTab.type} />
        )}
        {activeTab?.type === "changes" && (
          <ChangesView worktreeId={worktreeId} repoPath={repoPath} />
        )}
      </div>
    </div>
  );
}

export { PaneView };
