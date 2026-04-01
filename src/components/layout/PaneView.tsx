import { PaneTabBar, useCrossPaneDrag } from "./PaneTabBar";
import { TerminalView } from "../terminal";
import { ChangesView } from "../changes/ChangesView";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { AnimatePresence, motion } from "framer-motion";
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
  const allTabs = useTabStore((s) => s.tabs);
  const tabs = allTabs[worktreeId] ?? [];
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const activePaneId = useLayoutStore((s) => s.activePaneId[worktreeId]);
  const isActivePane = activePaneId === paneId;
  const worktree = useWorkspaceStore((s) => s.worktrees.find((wt) => wt.id === worktreeId));

  const activeTabId = pane?.activeTabId;
  const activeTab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabId);
  const layout = useLayoutStore((s) => s.layout[worktreeId]);
  const crossDrag = useCrossPaneDrag();
  const isSplit = layout?.type === "split";
  const showDropZone = isSplit && crossDrag != null && crossDrag.paneId !== paneId && crossDrag.worktreeId === worktreeId;

  const showChanges = activeTab?.type === "diff";

  return (
    <div
      data-pane-drop-target={paneId}
      className="flex flex-col h-full min-h-0 relative"
    >
      <AnimatePresence>
        {showDropZone && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-50 pointer-events-none rounded-lg border-2 border-dashed border-accent-primary/60 bg-accent-primary/8 flex items-center justify-center"
          >
            <span className="text-sm font-medium text-accent-primary/70 select-none">
              Drop to move here
            </span>
          </motion.div>
        )}
      </AnimatePresence>
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
        {(activeTab?.type === "claude" || activeTab?.type === "shell" || activeTab?.type === "server") ? (
          <TerminalView key={activeTab.id} tabId={activeTab.id} tabType={activeTab.type} />
        ) : null}
        {showChanges && (
          <div className="absolute inset-0 z-10 bg-bg-primary">
            <ChangesView
              key={activeTab.id}
              worktreeId={worktreeId}
              repoPath={worktree?.path ?? "."}
              diffTarget={activeTab.diffTarget}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export { PaneView };
