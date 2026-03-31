import { useCallback, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { FileSidebar } from "./FileSidebar";
import { PrPanelContent, PrRailIcons, MergeStatusBanner, usePrBadgeCounts } from "./PrPanel";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useTabStore } from "../../stores/tabStore";
import { useChangesData } from "../../hooks/useChangesData";
import { discardFile } from "../../api";
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
  const { checkRuns, mergeable, reviewDecision } = usePrBadgeCounts(worktreeId);

  // Map panel tab to data-fetching view mode
  const dataViewMode: ViewMode = panelTab === "commits" ? "commits" : "changes";

  const [selectedCommitIndex, setSelectedCommitIndex] = useState<number | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  const { uncommittedFiles, committedFiles, commits, refetchUncommitted } = useChangesData(
    repoPath,
    dataViewMode,
    selectedCommitIndex,
    pr?.baseBranch,
    pr?.number,
  );

  // ── Discard state ──────────────────────────────────────────
  const [discardTarget, setDiscardTarget] = useState<{ path: string; status: string } | null>(null);

  const handleDiscardFile = useCallback((path: string, status: string) => {
    setDiscardTarget({ path, status });
  }, []);

  const handleConfirmDiscard = useCallback(async () => {
    if (!discardTarget) return;
    try {
      await discardFile(repoPath, discardTarget.path, discardTarget.status);
      refetchUncommitted();
    } catch (err) {
      console.error("Discard failed:", err);
    } finally {
      setDiscardTarget(null);
    }
  }, [discardTarget, repoPath, refetchUncommitted]);

  const activateChangesTab = useCallback(
    () => {
      const changesTabId = `${worktreeId}:changes`;
      const tabState = useTabStore.getState();
      const existingTabs = tabState.tabs[worktreeId] ?? [];

      // Ensure the changes tab exists in the tab store
      if (!existingTabs.some((t) => t.id === changesTabId)) {
        const updatedTabs = [...existingTabs, { id: changesTabId, type: "changes" as const, label: "Changes" }];
        tabState.restoreTabs(
          worktreeId,
          updatedTabs,
          tabState.activeTabId[worktreeId] ?? existingTabs[0]?.id ?? changesTabId,
        );
      }

      const layoutState = useLayoutStore.getState();
      const activePaneId = layoutState.activePaneId[worktreeId];
      if (!activePaneId) return;

      // Ensure the changes tab is in the pane's tab list
      const pane = layoutState.panes[worktreeId]?.[activePaneId];
      if (pane && !pane.tabIds.includes(changesTabId)) {
        layoutState.addTabToPane(worktreeId, activePaneId, changesTabId);
      } else {
        layoutState.setPaneActiveTab(worktreeId, activePaneId, changesTabId);
      }
    },
    [worktreeId],
  );

  const handleSelectCommit = useCallback((index: number) => {
    setSelectedCommitIndex(index);
    setActiveFilePath(null);
    activateChangesTab();

    // Dispatch after a frame so ChangesView has time to mount if the tab was just created
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("alfredo:changes-panel-select-commit", { detail: { index } }),
      );
    });
  }, [activateChangesTab]);

  const handleSelectFile = useCallback(
    (path: string) => {
      setActiveFilePath(path);
      activateChangesTab();

      // Dispatch after a frame so ChangesView has time to mount if the tab was just created
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent("alfredo:changes-panel-select-file", { detail: { path } }),
        );
      });
    },
    [activateChangesTab],
  );

  const handleJumpToComment = useCallback(
    (filePath: string, line: number) => {
      activateChangesTab();

      // Dispatch after a frame so ChangesView has time to mount if the tab was just created
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent("alfredo:changes-panel-select-file", { detail: { path: filePath } }),
        );
        window.dispatchEvent(
          new CustomEvent("alfredo:changes-panel-jump-to-comment", { detail: { path: filePath, line } }),
        );
      });

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
      // Always dispatch clear-focus when clicking Files or Commits tab header
      // This exits focused mode even if already on the same tab
      if (tab === "changes" || tab === "commits") {
        window.dispatchEvent(new CustomEvent("alfredo:changes-panel-clear-focus"));
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
            onDiscardFile={handleDiscardFile}
          />
        </div>
      )}

      {/* Merge status banner — visible across all tabs */}
      {pr && (
        <MergeStatusBanner
          worktreeId={worktreeId}
          pr={pr}
          checkRuns={checkRuns}
          mergeable={mergeable}
          reviewDecision={reviewDecision}
          repoPath={repoPath}
        />
      )}

      {/* Discard confirmation dialog */}
      <Dialog open={discardTarget !== null} onOpenChange={(open) => { if (!open) setDiscardTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard changes?</DialogTitle>
            <DialogDescription>
              {discardTarget?.status === "added"
                ? `This will delete "${discardTarget.path}". This action cannot be undone.`
                : `This will revert all changes to "${discardTarget?.path ?? ""}". This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDiscardTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleConfirmDiscard}>Discard</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
        Changes
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
