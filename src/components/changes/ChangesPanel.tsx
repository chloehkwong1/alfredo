import { useCallback } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { FileSidebar } from "./FileSidebar";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { usePrStore } from "../../stores/prStore";
import { useChangesData } from "../../hooks/useChangesData";
import type { ViewMode } from "./FileSidebar";

function ChangesPanel({
  worktreeId,
  repoPath,
  onCollapse,
}: {
  worktreeId: string;
  repoPath: string;
  onCollapse: () => void;
}) {
  const viewMode = (useWorkspaceStore((s) => s.changesViewMode[worktreeId]) ?? "changes") as ViewMode;
  const setChangesViewMode = useWorkspaceStore((s) => s.setChangesViewMode);
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId));
  const pr = worktree?.prStatus ?? null;

  const reviewedFiles = usePrStore((s) => s.reviewedFiles[worktreeId]) ?? new Set<string>();
  const toggleReviewedFile = usePrStore((s) => s.toggleReviewedFile);

  const { uncommittedFiles, committedFiles, commits } = useChangesData(
    repoPath,
    viewMode,
    null,
    pr?.baseBranch,
    pr?.number,
  );

  const handleSelectFile = useCallback(
    (path: string) => {
      // Activate the Changes tab in the active pane
      const layoutState = useLayoutStore.getState();
      const activePaneId = layoutState.activePaneId[worktreeId];
      const changesTabId = `${worktreeId}:changes`;

      if (activePaneId) {
        layoutState.setPaneActiveTab(worktreeId, activePaneId, changesTabId);
      }

      // Dispatch event so ChangesView can scroll/highlight the file
      window.dispatchEvent(
        new CustomEvent("alfredo:changes-panel-select-file", { detail: { path } }),
      );
    },
    [worktreeId],
  );

  const handleToggleReviewed = useCallback(
    (path: string) => {
      toggleReviewedFile(worktreeId, path);
    },
    [worktreeId, toggleReviewedFile],
  );

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      setChangesViewMode(worktreeId, mode);
    },
    [worktreeId, setChangesViewMode],
  );

  return (
    <div className="flex flex-col h-full bg-bg-primary border-l border-border-default overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border-subtle flex-shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">
          Changes
        </span>
        <button
          onClick={onCollapse}
          className="p-0.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
          title="Collapse panel"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      {/* File sidebar */}
      <div className="flex-1 overflow-hidden">
        <FileSidebar
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          uncommittedFiles={uncommittedFiles}
          committedFiles={committedFiles}
          hasPr={pr !== null}
          commits={commits}
          selectedCommitIndex={null}
          onSelectCommit={() => {}}
          activeFilePath={null}
          collapsedFiles={new Set()}
          onSelectFile={handleSelectFile}
          reviewedFiles={reviewedFiles}
          onToggleReviewed={handleToggleReviewed}
        />
      </div>
    </div>
  );
}

function ChangesPanelMinimized({
  worktreeId,
  repoPath,
  onExpand,
}: {
  worktreeId: string;
  repoPath: string;
  onExpand: () => void;
}) {
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId));
  const pr = worktree?.prStatus ?? null;

  const { uncommittedFiles, committedFiles } = useChangesData(
    repoPath,
    "changes",
    null,
    pr?.baseBranch,
    pr?.number,
  );

  const fileCount = uncommittedFiles.length + committedFiles.length;

  return (
    <button
      onClick={onExpand}
      className="flex flex-col items-center gap-2 w-8 h-full bg-bg-primary border-l border-border-default hover:bg-bg-hover transition-colors py-3 flex-shrink-0"
      title="Expand Changes panel"
    >
      <PanelLeftOpen size={14} className="text-text-tertiary flex-shrink-0" />
      <span
        className="text-[10px] text-text-tertiary"
        style={{ writingMode: "vertical-lr" }}
      >
        Changes
      </span>
      {fileCount > 0 && (
        <span className="text-[9px] font-semibold px-1 py-px rounded-sm bg-accent-primary/15 text-accent-primary flex-shrink-0">
          {fileCount}
        </span>
      )}
    </button>
  );
}

export { ChangesPanel, ChangesPanelMinimized };
