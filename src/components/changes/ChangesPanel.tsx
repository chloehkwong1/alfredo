import { useCallback, useEffect, useState } from "react";
import { GitBranch, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { FileSidebar } from "./FileSidebar";
import { PrPanelContent, PrRailIcons, usePrBadgeCounts } from "./PrPanel";
import { MergeStatusBanner } from "./MergeStatusBanner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePrStore } from "../../stores/prStore";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useChangesData } from "../../hooks/useChangesData";
import { discardFile, getCommitsBehindMain, rebaseWorktree } from "../../api";
import type { ViewMode } from "./FileSidebar";
import type { PrComment } from "../../types";

const EMPTY_COMMENTS: PrComment[] = [];


function RebaseBanner({ worktreePath, stackParent }: { worktreePath: string; stackParent?: string | null }) {
  const [behindCount, setBehindCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetch = () => {
      getCommitsBehindMain(worktreePath, stackParent).then((n) => {
        if (!cancelled) setBehindCount(n);
      }).catch(() => {
        if (!cancelled) setBehindCount(null);
      });
    };
    fetch();
    const id = setInterval(fetch, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [worktreePath]);

  const handleRebase = async () => {
    setLoading(true);
    try {
      await rebaseWorktree(worktreePath, stackParent);
      setBehindCount(0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Rebase failed:", msg);
      new Notification("Alfredo", { body: `Rebase failed: ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  if (behindCount == null || behindCount === 0) return null;

  return (
    <div className="px-2.5 py-1.5 bg-accent-primary/[0.08] border-t border-accent-primary/20 text-xs font-semibold shrink-0 flex items-center gap-2 text-text-secondary">
      <GitBranch size={13} className="shrink-0" />
      <span className="flex-1 text-[11px]">
        {behindCount} commit{behindCount !== 1 ? "s" : ""} behind main
      </span>
      <Button
        size="sm"
        variant="ghost"
        onClick={handleRebase}
        disabled={loading}
        className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
      >
        {loading ? "Rebasing…" : "Rebase"}
      </Button>
    </div>
  );
}

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
  const prComments = usePrStore((s) => s.prDetail[worktreeId]?.comments ?? EMPTY_COMMENTS);
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

  const handleSelectCommit = useCallback((index: number) => {
    setSelectedCommitIndex(index);
    setActiveFilePath(null);
    // Switch the active tab to the changes tab first so ChangesView mounts
    const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
    const changesTab = tabs.find((t) => t.type === "changes");
    if (changesTab) {
      const layoutState = useLayoutStore.getState();
      const activePaneId = layoutState.activePaneId[worktreeId];
      if (activePaneId) {
        layoutState.setPaneActiveTab(worktreeId, activePaneId, changesTab.id);
      }
      useTabStore.getState().setActiveTabId(worktreeId, changesTab.id);
    }
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("alfredo:changes-panel-select-commit", { detail: { index } }),
      );
    });
  }, [worktreeId]);

  const handleSelectFile = useCallback(
    (path: string) => {
      setActiveFilePath(path);
      // Switch the active tab to the changes tab first so ChangesView mounts
      const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
      const changesTab = tabs.find((t) => t.type === "changes");
      if (changesTab) {
        const layoutState = useLayoutStore.getState();
        const activePaneId = layoutState.activePaneId[worktreeId];
        if (activePaneId) {
          layoutState.setPaneActiveTab(worktreeId, activePaneId, changesTab.id);
        }
        useTabStore.getState().setActiveTabId(worktreeId, changesTab.id);
      }
      // Dispatch after a frame so ChangesView has time to mount and attach its listener
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent("alfredo:changes-panel-select-file", { detail: { path } }),
        );
      });
    },
    [worktreeId],
  );

  const handleJumpToComment = useCallback(
    (filePath: string, line: number) => {
      // Switch back to files tab
      setChangesViewMode(worktreeId, "changes");
      // Switch the active tab to the changes tab first
      const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
      const changesTab = tabs.find((t) => t.type === "changes");
      if (changesTab) {
        const layoutState = useLayoutStore.getState();
        const activePaneId = layoutState.activePaneId[worktreeId];
        if (activePaneId) {
          layoutState.setPaneActiveTab(worktreeId, activePaneId, changesTab.id);
        }
        useTabStore.getState().setActiveTabId(worktreeId, changesTab.id);
      }
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent("alfredo:changes-panel-select-file", { detail: { path: filePath } }),
        );
        window.dispatchEvent(
          new CustomEvent("alfredo:changes-panel-jump-to-comment", { detail: { path: filePath, line } }),
        );
      });
    },
    [setChangesViewMode, worktreeId],
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
        <span className="text-xs uppercase tracking-wider text-text-tertiary font-medium">
          Changes
        </span>
        <IconButton
          size="sm"
          label="Collapse panel"
          className="h-auto w-auto p-0.5"
          onClick={onCollapse}
        >
          <PanelLeftClose size={14} />
        </IconButton>
      </div>

      {/* Unified tab bar: Files | Commits | PR */}
      <div className="flex px-2.5 py-1.5 gap-0 flex-shrink-0">
        <button
          onClick={() => handleTabChange("changes")}
          className={[
            "flex-1 px-2 py-1 text-[11px] border border-border-default rounded-l-md",
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
            "flex-1 px-2 py-1 text-[11px] border border-l-0 border-border-default",
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
              "flex-1 px-2 py-1 text-[11px] border border-l-0 border-border-default rounded-r-md",
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
            onSelectFile={handleSelectFile}
            onDiscardFile={handleDiscardFile}
            prComments={prComments}
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

      {/* Rebase banner — hidden when merge conflict already shown (conflict implies behind main) */}
      {worktree && mergeable !== false && <RebaseBanner worktreePath={worktree.path} stackParent={worktree.stackParent} />}

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
