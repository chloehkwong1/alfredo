import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitBranch, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { FileSidebar } from "./FileSidebar";
import { RecentCommitsSection } from "./RecentCommitsSection";
import { PrPanelContent, PrRailIcons, usePrBadgeCounts } from "./PrPanel";
import { MergeStatusBanner } from "./MergeStatusBanner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePrStore } from "../../stores/prStore";
import { lifecycleManager } from "../../services/lifecycleManager";
import { useChangesData } from "../../hooks/useChangesData";
import { useGitUser } from "../../hooks/useGitUser";
import { discardFile, discardAllUncommitted, getCommitsBehindMain, rebaseWorktree } from "../../api";
import { useDefaultBranch } from "../../hooks/useDefaultBranch";
import { shouldShowSimplifiedMainView } from "../../lib/cardViewMode";
import type { ViewMode } from "./FileSidebar";
import type { PrComment } from "../../types";

const EMPTY_COMMENTS: PrComment[] = [];


function RebaseBanner({ repoPath, worktreePath, stackParent }: { repoPath: string; worktreePath: string; stackParent?: string | null }) {
  const [behindCount, setBehindCount] = useState<number | null>(null);
  const baseBranchName = useDefaultBranch(repoPath, stackParent);
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
  }, [worktreePath, stackParent]);

  const [error, setError] = useState<string | null>(null);

  const handleRebase = async () => {
    setLoading(true);
    setError(null);
    try {
      await rebaseWorktree(worktreePath, stackParent);
      setBehindCount(0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Rebase failed:", msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  if (behindCount == null || behindCount === 0 || baseBranchName == null) return null;

  return (
    <div className="px-2.5 py-1.5 bg-accent-primary/15 border-t border-accent-primary/30 border-l-2 border-l-accent-primary text-xs font-semibold shrink-0 flex items-center gap-2 text-text-secondary">
      <GitBranch size={13} className="shrink-0" />
      <span className="flex-1 text-[11px]">
        <span className="text-accent-primary">{behindCount} commit{behindCount !== 1 ? "s" : ""}</span> behind {baseBranchName ?? "base"}
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
      {error && (
        <span className="text-red-400 text-[10px] truncate max-w-[200px]" title={error}>
          Failed: {error}
        </span>
      )}
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
  const defaultBranch = useDefaultBranch(repoPath, worktree?.stackParent);

  // Simplified pinned-main-card view: hide Files/Commits tabs when parked on
  // the default branch with no PR. Florence-style repos parked on main get
  // the simpler view; branch-mode repos with a pinned main card keep the
  // full UX so they can scroll HEAD commits (#36).
  const isBranchModeDefault = shouldShowSimplifiedMainView({
    worktree: worktree ?? { isPinnedMainCard: false, branch: "" },
    defaultBranch,
    hasPr: !!pr,
  });
  const effectiveBaseBranch = pr?.baseBranch ?? worktree?.stackParent ?? undefined;

  // Show the rebase banner whenever the worktree isn't a branch-mode synthetic,
  // OR it's a pinned main card, OR it has a PR. Hidden during merge conflicts.
  // The banner's internal behindCount === 0 short-circuit handles up-to-date.
  const showRebaseBanner = !!worktree && (!worktree.isBranchMode || !!worktree.isPinnedMainCard || !!pr) && mergeable !== false;

  // Map panel tab to data-fetching view mode — force "changes" when tabs are hidden
  const dataViewMode: ViewMode = isBranchModeDefault ? "changes" : (panelTab === "commits" ? "commits" : "changes");

  const [selectedCommitIndex, setSelectedCommitIndex] = useState<number | null>(null);
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [activeFileIsUncommitted, setActiveFileIsUncommitted] = useState<boolean | undefined>(undefined);

  const { uncommittedFiles, committedFiles, commits, upstreamCommits, refetchUncommitted, error } = useChangesData(
    repoPath,
    dataViewMode,
    selectedCommitIndex,
    effectiveBaseBranch,
    pr?.mergeCommitSha ?? undefined,
    isBranchModeDefault,
  );

  const gitUser = useGitUser(repoPath);

  // ── Discard state ──────────────────────────────────────────
  const [discardTarget, setDiscardTarget] = useState<{ path: string; status: string } | null>(null);
  const [showDiscardAllDialog, setShowDiscardAllDialog] = useState(false);
  const discardConfirmRef = useRef<HTMLButtonElement>(null);
  const discardAllConfirmRef = useRef<HTMLButtonElement>(null);

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

  const handleConfirmDiscardAll = useCallback(async () => {
    try {
      await discardAllUncommitted(repoPath, uncommittedFiles);
      refetchUncommitted();
    } catch (err) {
      console.error("Discard all failed:", err);
    } finally {
      setShowDiscardAllDialog(false);
    }
  }, [repoPath, uncommittedFiles, refetchUncommitted]);

  const allCommits = useMemo(
    () => [...commits, ...upstreamCommits],
    [commits, upstreamCommits],
  );

  const handleSelectCommit = useCallback((index: number) => {
    setSelectedCommitIndex(index);
    setActiveFilePath(null);
    const commit = allCommits[index];
    if (!commit) {
      console.warn("[ChangesPanel] handleSelectCommit: no commit at index", index, "allCommits.length:", allCommits.length);
      return;
    }
    const tabId = lifecycleManager.openDiffPreview(worktreeId, {
      type: "commit",
      commitHash: commit.hash,
    });
    if (!tabId) {
      console.warn("[ChangesPanel] openDiffPreview returned null — no activePaneId?", { worktreeId });
    }
  }, [allCommits, worktreeId]);

  const handleSelectFile = useCallback(
    (path: string, isUncommitted: boolean) => {
      setActiveFilePath(path);
      setActiveFileIsUncommitted(isUncommitted);
      lifecycleManager.openDiffPreview(worktreeId, {
        type: "file",
        filePath: path,
        isUncommitted,
      });
    },
    [worktreeId],
  );

  const handleJumpToComment = useCallback(
    (filePath: string, line?: number) => {
      setActiveFileIsUncommitted(false);
      lifecycleManager.openDiffPreview(worktreeId, {
        type: "file",
        filePath,
        isUncommitted: false,
        scrollToLine: line,
      });
    },
    [worktreeId],
  );

  const handleTabChange = useCallback(
    (tab: "changes" | "commits" | "pr") => {
      setChangesViewMode(worktreeId, tab);
      if (tab !== "pr") {
        setSelectedCommitIndex(null);
        setActiveFilePath(null);
        setActiveFileIsUncommitted(undefined);
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
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-border-subtle flex-shrink-0">
        <span className="text-[13px] font-medium text-text-secondary">
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

      {/* Tab bar — hidden when only uncommitted changes exist (branch-mode on default branch) */}
      {!isBranchModeDefault && (
        <div className="flex px-2.5 py-2 gap-0 flex-shrink-0">
          <button
            onClick={() => handleTabChange("changes")}
            className={[
              "flex-1 px-2 py-1.5 text-xs font-medium border border-border-default rounded-l-md transition-colors",
              panelTab === "changes"
                ? "bg-accent-muted text-accent-primary border-accent-primary/40"
                : "text-text-tertiary hover:text-text-secondary",
            ].join(" ")}
          >
            <span className="whitespace-nowrap">Files</span>
            {fileCount > 0 && (
              <span
                className={[
                  "ml-1.5 text-[9px] font-semibold px-1.5 py-px rounded-sm",
                  panelTab === "changes"
                    ? "bg-accent-primary/20 text-accent-primary"
                    : "bg-white/5 text-text-tertiary",
                ].join(" ")}
              >
                {fileCount}
              </span>
            )}
          </button>
          <button
            onClick={() => handleTabChange("commits")}
            className={[
              "flex-1 px-2 py-1.5 text-xs font-medium border border-l-0 border-border-default transition-colors",
              hasPr ? "" : "rounded-r-md",
              panelTab === "commits"
                ? "bg-accent-muted text-accent-primary border-accent-primary/40"
                : "text-text-tertiary hover:text-text-secondary",
            ].join(" ")}
          >
            <span className="whitespace-nowrap">Commits</span>
            {commits.length > 0 && (
              <span
                className={[
                  "ml-1.5 text-[9px] font-semibold px-1.5 py-px rounded-sm",
                  panelTab === "commits"
                    ? "bg-accent-primary/20 text-accent-primary"
                    : "bg-white/5 text-text-tertiary",
                ].join(" ")}
              >
                {commits.length}
              </span>
            )}
          </button>
          {hasPr && (
            <button
              onClick={() => handleTabChange("pr")}
              className={[
                "flex-1 px-2 py-1.5 text-xs font-medium border border-l-0 border-border-default rounded-r-md transition-colors",
                panelTab === "pr"
                  ? "bg-accent-muted text-accent-primary border-accent-primary/40"
                  : "text-text-tertiary hover:text-text-secondary",
              ].join(" ")}
            >
              PR
            </button>
          )}
        </div>
      )}

      {/* Tab content */}
      {panelTab === "pr" && hasPr ? (
        <PrPanelContent
          worktreeId={worktreeId}
          onJumpToComment={handleJumpToComment}
        />
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 overflow-hidden">
            <FileSidebar
              viewMode={dataViewMode}
              uncommittedFiles={uncommittedFiles}
              committedFiles={committedFiles}
              commits={commits}
              upstreamCommits={upstreamCommits}
              gitUser={gitUser}
              selectedCommitIndex={selectedCommitIndex}
              onSelectCommit={handleSelectCommit}
              activeFilePath={activeFilePath}
              activeFileIsUncommitted={activeFileIsUncommitted}
              onSelectFile={handleSelectFile}
              onDiscardFile={handleDiscardFile}
              onDiscardAllUncommitted={uncommittedFiles.length > 0 ? () => setShowDiscardAllDialog(true) : undefined}
              prComments={prComments}
              onDoubleClickFile={() => lifecycleManager.pinCurrentPreview(worktreeId)}
              onDoubleClickCommit={() => lifecycleManager.pinCurrentPreview(worktreeId)}
              worktreePath={worktree?.path}
              defaultBranchName={defaultBranch}
              error={error}
            />
          </div>
          {isBranchModeDefault && (
            <RecentCommitsSection
              repoPath={repoPath}
              worktreeId={worktreeId}
              defaultBranchName={defaultBranch}
              gitUser={gitUser}
            />
          )}
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
          branch={pr.branch}
        />
      )}

      {showRebaseBanner && <RebaseBanner repoPath={repoPath} worktreePath={worktree!.path} stackParent={worktree!.stackParent} />}

      {/* Discard confirmation dialog */}
      <Dialog open={discardTarget !== null} onOpenChange={(open) => { if (!open) setDiscardTarget(null); }}>
        <DialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            discardConfirmRef.current?.focus();
          }}
        >
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
            <Button ref={discardConfirmRef} variant="danger" onClick={handleConfirmDiscard}>Discard</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Discard all confirmation dialog */}
      <Dialog open={showDiscardAllDialog} onOpenChange={(open) => { if (!open) setShowDiscardAllDialog(false); }}>
        <DialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            discardAllConfirmRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Discard all uncommitted changes?</DialogTitle>
            <DialogDescription>
              This will revert all {uncommittedFiles.length} uncommitted file{uncommittedFiles.length !== 1 ? "s" : ""}. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDiscardAllDialog(false)}>Cancel</Button>
            <Button ref={discardAllConfirmRef} variant="danger" onClick={handleConfirmDiscardAll}>Discard All</Button>
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
  const defaultBranch = useDefaultBranch(repoPath, undefined);
  const isBranchModeDefault = shouldShowSimplifiedMainView({
    worktree: worktree ?? { isPinnedMainCard: false, branch: "" },
    defaultBranch,
    hasPr: !!pr,
  });
  const minimizedBaseBranch = pr?.baseBranch ?? undefined;

  const { uncommittedFiles, committedFiles } = useChangesData(
    repoPath,
    "changes",
    null,
    minimizedBaseBranch,
    pr?.mergeCommitSha ?? undefined,
    isBranchModeDefault,
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
