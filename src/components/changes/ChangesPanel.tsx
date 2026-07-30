import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Download, GitBranch, PanelRightClose, PanelRightOpen, RefreshCw, Upload, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { discardFile, discardAllUncommitted, dropCommit, getAheadBehindOrigin, getCommitsBehindMain, gitPublishBranch, gitPullRebase, gitPush, isCommitPushed, rebaseWorktree } from "../../api";
import { useDefaultBranch } from "../../hooks/useDefaultBranch";
import { shouldShowSimplifiedMainView } from "../../lib/cardViewMode";
import type { ViewMode } from "./FileSidebar";
import type { CommitInfo, PrComment } from "../../types";
import { copyText } from "../../lib/clipboard";

const EMPTY_COMMENTS: PrComment[] = [];


function RebaseBanner({ repoPath, worktreePath, stackParent }: { repoPath: string; worktreePath: string; stackParent?: string | null }) {
  const [behindCount, setBehindCount] = useState<number | null>(null);
  const baseBranchName = useDefaultBranch(repoPath, stackParent);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const handleCopyError = async () => {
    if (!error) return;
    try {
      await copyText(error);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("Failed to copy rebase error:", e);
    }
  };

  // When behindCount hits 0 the banner unmounts and the error row goes with it.
  // Intentional: if the rebase isn't needed any more (resolved out-of-band, branch
  // deleted, poll caught up), surfacing a stale error is noise.
  if (behindCount == null || behindCount === 0 || baseBranchName == null) return null;

  return (
    <div className="bg-accent-primary/15 border-t border-accent-primary/30 border-l-2 border-l-accent-primary shrink-0">
      <div className="px-2.5 py-1.5 text-xs font-semibold flex items-center gap-2 text-text-secondary">
        <GitBranch size={13} className="shrink-0" />
        <span className="flex-1 min-w-0 text-[11px] truncate">
          <span className="text-accent-primary">{behindCount} commit{behindCount !== 1 ? "s" : ""}</span> behind {baseBranchName}
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRebase}
          disabled={loading}
          className="text-2xs px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium shrink-0"
        >
          {loading ? "Rebasing…" : "Rebase"}
        </Button>
      </div>
      {error && (
        <div className="px-2.5 pb-1.5 border-t border-red-400/20">
          <div className="flex items-center justify-between gap-2 pt-1.5">
            <span className="text-red-400 text-2xs font-semibold">Rebase failed</span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleCopyError}
                className={`text-2xs px-1.5 py-0.5 rounded border inline-flex items-center gap-1 cursor-pointer transition-colors ${
                  copied
                    ? "text-status-idle border-status-idle/30"
                    : "text-text-secondary border-border-subtle hover:bg-white/5 hover:text-text-primary hover:border-border-hover"
                }`}
              >
                {copied ? <Check size={9} /> : <Copy size={9} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label="Dismiss rebase error"
                className="text-text-tertiary hover:text-text-secondary cursor-pointer p-0.5"
                title="Dismiss"
              >
                <X size={11} />
              </button>
            </div>
          </div>
          <pre className="mt-1 text-2xs text-red-400/90 whitespace-pre-wrap break-words font-mono max-h-40 overflow-auto">
            {error}
          </pre>
        </div>
      )}
    </div>
  );
}

function OriginSyncBanner({
  worktreePath,
  repoPath,
  branch,
}: { worktreePath: string; repoPath: string; branch: string }) {
  // counts: undefined = first-load, null = no upstream, [a, b] = ahead/behind
  const [counts, setCounts] = useState<[number, number] | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  // Pair the error message with the action it came from so the header reads
  // "Pull failed" after a Pull even if the counts have since shifted such
  // that the live buttonLabel would now read "Push".
  const [error, setError] = useState<{ msg: string; action: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // Guards setState calls in handleAction against firing after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    // Reset to first-load state when switching worktree, otherwise the prior
    // worktree's counts flicker through with the new worktree's branch label.
    setCounts(undefined);
    let cancelled = false;
    const poll = () => {
      getAheadBehindOrigin(worktreePath, repoPath).then((r) => {
        if (cancelled) return;
        setCounts(r);
        // A successful poll means whatever produced an earlier action error
        // is no longer the live state; clear it so the banner doesn't keep
        // showing "Push failed" next to fresh, correct counts.
        setError(null);
      }).catch(() => {
        // Don't reset to undefined here — that would hide the banner on a
        // transient IPC error and lose the user's last-known prompt. Leave
        // the previous counts in place; the next poll will reconcile.
      });
    };
    poll();
    const id = setInterval(poll, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [worktreePath, repoPath]);

  const refetch = () => {
    // Bypass the backend throttle: the user just took a remote-touching
    // action, so we need fresh state, not the cached count from 30s ago.
    getAheadBehindOrigin(worktreePath, repoPath, true).then((r) => {
      if (mountedRef.current) setCounts(r);
    }).catch(() => {});
  };

  const handleAction = async () => {
    setLoading(true);
    setError(null);
    try {
      if (counts === null) {
        await gitPublishBranch(worktreePath, branch);
      } else if (counts) {
        const [ahead, behind] = counts;
        if (behind > 0) {
          await gitPullRebase(worktreePath);
        }
        if (ahead > 0) {
          await gitPush(worktreePath);
        }
      }
      // Optimistic only on full success — hides the banner immediately so it
      // doesn't visually lag the action. The refetch in finally then confirms
      // (or corrects, e.g. if a teammate raced a new commit in between).
      if (mountedRef.current) setCounts([0, 0]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Origin sync failed:", msg);
      if (mountedRef.current) setError({ msg, action: buttonLabel });
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        // Always refetch — on success to confirm [0, 0], on partial failure
        // (e.g. pull --rebase succeeded then push rejected) so the banner
        // reflects the new on-disk state rather than the pre-action counts.
        refetch();
      }
    }
  };

  const handleCopyError = async () => {
    if (!error) return;
    try {
      await copyText(error.msg);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("Failed to copy origin sync error:", e);
    }
  };

  if (counts === undefined) return null; // first poll still in flight
  const hasUpstream = counts !== null;
  const [ahead, behind] = counts ?? [0, 0];
  const inSync = hasUpstream && ahead === 0 && behind === 0;
  if (inSync) return null;

  let label: string;
  let buttonLabel: string;
  let Icon: LucideIcon;
  if (!hasUpstream) {
    label = "No upstream branch";
    buttonLabel = "Publish";
    Icon = Upload;
  } else if (ahead > 0 && behind === 0) {
    label = `${ahead} ahead of origin/${branch}`;
    buttonLabel = "Push";
    Icon = Upload;
  } else if (ahead === 0 && behind > 0) {
    label = `${behind} behind origin/${branch}`;
    buttonLabel = "Pull";
    Icon = Download;
  } else {
    label = `${ahead} ahead · ${behind} behind origin/${branch}`;
    buttonLabel = "Sync";
    Icon = RefreshCw;
  }
  // Explicit map so the in-flight label survives future button-label renames.
  const inFlightLabel: Record<string, string> = {
    Publish: "Publishing…",
    Push: "Pushing…",
    Pull: "Pulling…",
    Sync: "Syncing…",
  };

  return (
    <div className="bg-accent-primary/15 border-t border-accent-primary/30 border-l-2 border-l-accent-primary shrink-0">
      <div className="px-2.5 py-1.5 text-xs font-semibold flex items-center gap-2 text-text-secondary">
        <Icon size={13} className="shrink-0" />
        <span className="flex-1 min-w-0 text-[11px] truncate">{label}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleAction}
          disabled={loading}
          className="text-2xs px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium shrink-0"
        >
          {loading ? (inFlightLabel[buttonLabel] ?? buttonLabel) : buttonLabel}
        </Button>
      </div>
      {error && (
        <div className="px-2.5 pb-1.5 border-t border-red-400/20">
          <div className="flex items-center justify-between gap-2 pt-1.5">
            <span className="text-red-400 text-2xs font-semibold">{error.action} failed</span>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={handleCopyError}
                className={`text-2xs px-1.5 py-0.5 rounded border inline-flex items-center gap-1 cursor-pointer transition-colors ${
                  copied
                    ? "text-status-idle border-status-idle/30"
                    : "text-text-secondary border-border-subtle hover:bg-white/5 hover:text-text-primary hover:border-border-hover"
                }`}
              >
                {copied ? <Check size={9} /> : <Copy size={9} />}
                {copied ? "Copied" : "Copy"}
              </button>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label="Dismiss origin sync error"
                className="text-text-tertiary hover:text-text-secondary cursor-pointer p-0.5"
                title="Dismiss"
              >
                <X size={11} />
              </button>
            </div>
          </div>
          <pre className="mt-1 text-2xs text-red-400/90 whitespace-pre-wrap break-words font-mono max-h-40 overflow-auto">
            {error.msg}
          </pre>
        </div>
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
  // Mirror the rebase banner's mergeable gate AND exclude branch-mode synthetics:
  // those share the repo root path so push/pull would operate on whatever the
  // repo's HEAD is, not the branch shown in the sidebar — a "push the wrong
  // branch" footgun. Also exclude pinned-main cards (no meaningful tracking branch)
  // and stacked children: after a restack, diverging from origin is the expected
  // state and the fix is the stack's force-with-lease push — the banner's
  // pull --rebase would replay the child onto its stale pre-rebase origin tip,
  // silently undoing the restack. (Stack roots keep the banner: their history
  // is never rewritten by the restack loop, so pull/push behave normally.)
  const showOriginSyncBanner = !!worktree?.branch && !worktree.isBranchMode && !worktree.isPinnedMainCard && !worktree.stackParent && mergeable !== false;

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
    /* clampDrift */ !pr,
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

  // ── Drop-commit state ──────────────────────────────────────
  const [dropTarget, setDropTarget] = useState<{ commit: CommitInfo; pushed: boolean | null } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const dropConfirmRef = useRef<HTMLButtonElement>(null);

  const handleDropCommit = useCallback((commit: CommitInfo) => {
    setDropError(null);
    setDropTarget({ commit, pushed: null });
    // Pushed-check is best-effort: on failure the warning simply stays hidden.
    isCommitPushed(repoPath, commit.hash)
      .then((pushed) => {
        setDropTarget((cur) => (cur?.commit.hash === commit.hash ? { ...cur, pushed } : cur));
      })
      .catch(() => {});
  }, [repoPath]);

  const handleConfirmDrop = useCallback(async () => {
    if (!dropTarget) return;
    try {
      await dropCommit(repoPath, dropTarget.commit.hash);
      setSelectedCommitIndex(null);
      setActiveFilePath(null);
      refetchUncommitted();
      setDropTarget(null);
    } catch (err) {
      setDropError(String(err));
    }
  }, [dropTarget, repoPath, refetchUncommitted]);

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
          <PanelRightClose size={14} />
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
        <div className="flex-1 min-h-0 flex flex-col">
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
            onDropCommit={handleDropCommit}
            worktreePath={worktree?.path}
            defaultBranchName={defaultBranch}
            error={error}
          />
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

      {showOriginSyncBanner && <OriginSyncBanner worktreePath={worktree!.path} repoPath={repoPath} branch={worktree!.branch} />}
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

      {/* Drop commit confirmation dialog */}
      <Dialog open={dropTarget !== null} onOpenChange={(open) => { if (!open) { setDropTarget(null); setDropError(null); } }}>
        <DialogContent
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            dropConfirmRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Drop commit?</DialogTitle>
            <DialogDescription>
              This removes <code className="font-mono text-[12px]">{dropTarget?.commit.shortHash}</code>{" "}
              "{dropTarget?.commit.message.split("\n")[0] ?? ""}" from the branch history. Later commits are
              replayed on top; if one depends on it, nothing is changed.
            </DialogDescription>
            {dropTarget?.pushed && (
              <DialogDescription className="text-red-400">
                This commit is already on origin — dropping it rewrites pushed history and will require a force-push.
              </DialogDescription>
            )}
            {dropError && (
              <DialogDescription className="text-red-400">{dropError}</DialogDescription>
            )}
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setDropTarget(null); setDropError(null); }}>Cancel</Button>
            <Button ref={dropConfirmRef} variant="danger" onClick={handleConfirmDrop}>Drop Commit</Button>
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
    /* clampDrift */ !pr,
  );

  const fileCount = uncommittedFiles.length + committedFiles.length;
  const hasPr = pr !== null;

  // Without a summary, a screen reader gets nothing about what's inside the
  // collapsed rail. Fold the at-a-glance counts into the label so it's as
  // informative by ear as the icons + tooltips are by sight.
  const { failingChecks, unresolvedComments, reviewDecision } = usePrBadgeCounts(worktreeId);
  const summary = [
    fileCount > 0 ? `${fileCount} file${fileCount !== 1 ? "s" : ""}` : null,
    hasPr && failingChecks > 0 ? `${failingChecks} check${failingChecks !== 1 ? "s" : ""} failing` : null,
    hasPr && reviewDecision === "CHANGES_REQUESTED" ? "changes requested" : null,
    hasPr && unresolvedComments > 0 ? `${unresolvedComments} unresolved comment${unresolvedComments !== 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(", ");
  const ariaLabel = summary ? `Expand Changes panel — ${summary}` : "Expand Changes panel";

  return (
    <button
      onClick={onExpand}
      aria-label={ariaLabel}
      className="flex flex-col items-center gap-2 w-8 h-full bg-bg-primary border-l border-border-default hover:bg-bg-hover transition-colors py-3 flex-shrink-0 cursor-pointer"
    >
      <PanelRightOpen size={14} className="text-text-tertiary flex-shrink-0" />
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
