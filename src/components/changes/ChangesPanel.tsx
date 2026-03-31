import { useCallback, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { FileSidebar } from "./FileSidebar";
import { PrPanelContent, PrRailIcons } from "./PrPanel";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useChangesData } from "../../hooks/useChangesData";
import type { ViewMode } from "./FileSidebar";

const EMPTY_COLLAPSED = new Set<string>();

function WorkspacePanel({
  worktreeId,
  repoPath,
  onCollapse,
}: {
  worktreeId: string;
  repoPath: string;
  onCollapse: () => void;
}) {
  const panelTab = useWorkspaceStore((s) => s.changesViewMode[worktreeId]) ?? "changes";
  const setChangesViewMode = useWorkspaceStore((s) => s.setChangesViewMode);
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId));
  const pr = worktree?.prStatus ?? null;

  // Map panel tab to data-fetching view mode
  const dataViewMode: ViewMode = panelTab === "commits" ? "commits" : "changes";

  const [selectedCommitIndex, setSelectedCommitIndex] = useState<number | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  const { uncommittedFiles, committedFiles, commits } = useChangesData(
    repoPath,
    dataViewMode,
    selectedCommitIndex,
    pr?.baseBranch,
    pr?.number,
  );

  const handleSelectCommit = useCallback((index: number) => {
    setSelectedCommitIndex(index);
    setActiveFilePath(null);
    // Dispatch event so ChangesView can update its commit selection
    window.dispatchEvent(
      new CustomEvent("alfredo:changes-panel-select-commit", { detail: { index } }),
    );
  }, []);

  const activateChangesTab = useCallback(
    () => {
      const layoutState = useLayoutStore.getState();
      const activePaneId = layoutState.activePaneId[worktreeId];
      const changesTabId = `${worktreeId}:changes`;

      if (activePaneId) {
        layoutState.setPaneActiveTab(worktreeId, activePaneId, changesTabId);
      }
    },
    [worktreeId],
  );

  const handleSelectFile = useCallback(
    (path: string) => {
      setActiveFilePath(path);
      activateChangesTab();

      // Dispatch event so ChangesView can scroll/highlight the file
      window.dispatchEvent(
        new CustomEvent("alfredo:changes-panel-select-file", { detail: { path } }),
      );
    },
    [activateChangesTab],
  );

  const handleJumpToComment = useCallback(
    (filePath: string, line: number) => {
      activateChangesTab();

      // Select the file in the changes view
      window.dispatchEvent(
        new CustomEvent("alfredo:changes-panel-select-file", { detail: { path: filePath } }),
      );

      // Jump to the specific comment line
      window.dispatchEvent(
        new CustomEvent("alfredo:changes-panel-jump-to-comment", { detail: { path: filePath, line } }),
      );

      // Switch back to files tab
      setChangesViewMode(worktreeId, "changes");
    },
    [activateChangesTab, setChangesViewMode, worktreeId],
  );

  const handleTabChange = useCallback(
    (tab: "changes" | "commits" | "pr") => {
      setChangesViewMode(worktreeId, tab);
      if (tab !== "pr") {
        setSelectedCommitIndex(null);
        setActiveFilePath(null);
      }
    },
    [worktreeId, setChangesViewMode],
  );

  const hasPr = pr !== null;
  const fileCount = uncommittedFiles.length + committedFiles.length;

  return (
    <div className="flex flex-col h-full bg-bg-primary border-l border-border-default overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border-subtle flex-shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">
          {hasPr ? "Workspace" : "Changes"}
        </span>
        <button
          onClick={onCollapse}
          className="p-0.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
          title="Collapse panel"
        >
          <PanelLeftClose size={14} />
        </button>
      </div>

      {/* Unified tab bar: Files | Commits | PR */}
      <div className="flex p-1.5 gap-0 flex-shrink-0">
        <button
          onClick={() => handleTabChange("changes")}
          className={[
            "flex-1 px-2 py-1 text-[10px] border border-border-default rounded-l-md",
            panelTab === "changes"
              ? "bg-accent-muted text-accent-primary border-accent-primary/40"
              : "text-text-tertiary",
          ].join(" ")}
        >
          Files{fileCount > 0 ? ` (${fileCount})` : ""}
        </button>
        <button
          onClick={() => handleTabChange("commits")}
          className={[
            "flex-1 px-2 py-1 text-[10px] border border-l-0 border-border-default",
            hasPr ? "" : "rounded-r-md",
            panelTab === "commits"
              ? "bg-accent-muted text-accent-primary border-accent-primary/40"
              : "text-text-tertiary",
          ].join(" ")}
        >
          Commits{commits.length > 0 ? ` (${commits.length})` : ""}
        </button>
        {hasPr && (
          <button
            onClick={() => handleTabChange("pr")}
            className={[
              "flex-1 px-2 py-1 text-[10px] border border-l-0 border-border-default rounded-r-md",
              panelTab === "pr"
                ? "bg-accent-muted text-accent-primary border-accent-primary/40"
                : "text-text-tertiary",
            ].join(" ")}
          >
            PR
          </button>
        )}
      </div>

      {/* Tab content */}
      {panelTab === "pr" && hasPr ? (
        <PrPanelContent
          worktreeId={worktreeId}
          repoPath={repoPath}
          onJumpToComment={handleJumpToComment}
        />
      ) : (
        <div className="flex-1 overflow-hidden">
          <FileSidebar
            viewMode={dataViewMode}
            uncommittedFiles={uncommittedFiles}
            committedFiles={committedFiles}
            commits={commits}
            selectedCommitIndex={selectedCommitIndex}
            onSelectCommit={handleSelectCommit}
            activeFilePath={activeFilePath}
            collapsedFiles={EMPTY_COLLAPSED}
            onSelectFile={handleSelectFile}
          />
        </div>
      )}
    </div>
  );
}

function WorkspacePanelMinimized({
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
  const hasPr = pr !== null;

  return (
    <button
      onClick={onExpand}
      className="flex flex-col items-center gap-2 w-8 h-full bg-bg-primary border-l border-border-default hover:bg-bg-hover transition-colors py-3 flex-shrink-0"
      title="Expand panel"
    >
      <PanelLeftOpen size={14} className="text-text-tertiary flex-shrink-0" />
      <span
        className="text-[10px] text-text-tertiary"
        style={{ writingMode: "vertical-lr" }}
      >
        {hasPr ? "Workspace" : "Changes"}
      </span>
      {fileCount > 0 && (
        <span className="text-[9px] font-semibold px-1 py-px rounded-sm bg-accent-primary/15 text-accent-primary flex-shrink-0">
          {fileCount}
        </span>
      )}
      {hasPr && <PrRailIcons worktreeId={worktreeId} />}
    </button>
  );
}

export { WorkspacePanel, WorkspacePanelMinimized };
