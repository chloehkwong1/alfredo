import { useEffect, useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PrHeader } from "./PrHeader";
import { PrChecksSection } from "./PrChecksSection";
import { PrReviewsSection } from "./PrReviewsSection";
import { PrCommentsSection } from "./PrCommentsSection";
import { PrConflictsSection } from "./PrConflictsSection";
import { getCheckRuns, getPrDetail } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Worktree, WorkflowRunLog, PrComment } from "../../types";

interface PrDetailPanelProps {
  worktree: Worktree;
  repoPath: string;
}

function PrDetailPanel({ worktree, repoPath }: PrDetailPanelProps) {
  const checkRuns = useWorkspaceStore((s) => s.checkRuns[worktree.id]) ?? [];
  const setCheckRuns = useWorkspaceStore((s) => s.setCheckRuns);
  const prDetail = useWorkspaceStore((s) => s.prDetail[worktree.id]);
  const setPrDetail = useWorkspaceStore((s) => s.setPrDetail);
  const [refreshing, setRefreshing] = useState(false);

  const fetchChecks = useCallback(async () => {
    try {
      const runs = await getCheckRuns(repoPath, worktree.branch);
      setCheckRuns(worktree.id, runs);
    } catch (err) {
      console.error("Failed to fetch check runs:", err);
    }
  }, [repoPath, worktree.branch, worktree.id, setCheckRuns]);

  const fetchDetail = useCallback(async () => {
    if (!worktree.prStatus) return;
    try {
      const detail = await getPrDetail(repoPath, worktree.prStatus.number);
      setPrDetail(worktree.id, detail);
    } catch (err) {
      console.error("Failed to fetch PR detail:", err);
    }
  }, [repoPath, worktree.prStatus, worktree.id, setPrDetail]);

  const hasPr = !!worktree.prStatus;

  useEffect(() => {
    if (!hasPr) return;
    fetchChecks();
    fetchDetail();
    const interval = setInterval(() => {
      fetchChecks();
      fetchDetail();
    }, 30_000);
    return () => clearInterval(interval);
  }, [hasPr, fetchChecks, fetchDetail]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchChecks(), fetchDetail()]);
    setRefreshing(false);
  };

  if (!worktree.prStatus) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        No pull request for this branch
      </div>
    );
  }

  // Calculate blocker counts
  const failingChecks = checkRuns.filter(
    (r) => r.conclusion === "failure" || r.conclusion === "timed_out",
  ).length;
  const hasChangesRequested = prDetail?.reviews?.some(
    (r) => r.state === "changes_requested",
  );
  const unresolvedComments = prDetail?.comments?.length ?? 0;
  const hasConflicts = prDetail?.mergeable === false;

  const blockerCount =
    (failingChecks > 0 ? 1 : 0) +
    (hasChangesRequested ? 1 : 0) +
    (unresolvedComments > 0 ? 1 : 0) +
    (hasConflicts ? 1 : 0);

  const resolvedCount =
    (failingChecks === 0 ? 1 : 0) +
    (!hasChangesRequested ? 1 : 0) +
    (unresolvedComments === 0 ? 1 : 0) +
    (!hasConflicts ? 1 : 0);

  const handleAskClaudeFix = (_logs: WorkflowRunLog[]) => {
    // Will be wired in Task 12
    console.log("Ask Claude to fix:", _logs);
  };

  const handleJumpToComment = (_comment: PrComment) => {
    // Will be wired in Task 13
    console.log("Jump to comment:", _comment);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center">
        <div className="flex-1">
          <PrHeader
            pr={worktree.prStatus}
            blockerCount={blockerCount}
            resolvedCount={resolvedCount}
          />
        </div>
        <div className="px-2 border-b border-border-subtle flex items-center">
          <button
            type="button"
            onClick={handleRefresh}
            className="p-1 text-text-tertiary hover:text-text-secondary"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <PrChecksSection
          checkRuns={checkRuns}
          repoPath={repoPath}
          onAskClaudeFix={handleAskClaudeFix}
        />
        <PrReviewsSection reviews={prDetail?.reviews ?? []} />
        <PrCommentsSection
          comments={prDetail?.comments ?? []}
          onJumpToComment={handleJumpToComment}
        />
        <PrConflictsSection mergeable={prDetail?.mergeable ?? null} />
      </div>
    </div>
  );
}

export { PrDetailPanel };
