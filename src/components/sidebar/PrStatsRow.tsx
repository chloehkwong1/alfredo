import {
  CircleCheck,
  CircleX,
  Loader,
  Eye,
  UserPlus,
  Clock,
  MessageCircle,
  AlertTriangle,
  GitMerge,
} from "lucide-react";

export type PrSummary = {
  failingCheckCount?: number;
  pendingCheckCount?: number;
  unresolvedCommentCount?: number;
  reviewDecision?: string | null;
  mergeable?: boolean | null;
  requestedReviewers?: string[];
  merged: boolean;
};

export function hasPrStats(s: PrSummary): boolean {
  const { failingCheckCount, unresolvedCommentCount, reviewDecision, mergeable, merged } = s;
  if (merged) return true;
  if (failingCheckCount != null) return true;
  if (
    reviewDecision === "approved" ||
    reviewDecision === "changes_requested" ||
    reviewDecision === "review_required" ||
    reviewDecision === "review_requested"
  )
    return true;
  if (unresolvedCommentCount != null && unresolvedCommentCount > 0) return true;
  if (mergeable != null) return true;
  return false;
}

export function formatDiffStat(n: number | null): string | null {
  if (n == null || n === 0) return null;
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function PrStatsRow({ prSummary }: { prSummary: PrSummary }) {
  const {
    failingCheckCount,
    pendingCheckCount,
    unresolvedCommentCount,
    reviewDecision,
    mergeable,
    merged,
  } = prSummary;

  // Merged is a terminal state — suppress precursor chips (Approved / Checks pass
  // / etc.) so the card stops implying work-to-do.
  if (merged) {
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <span className="flex items-center gap-1 text-xs text-accent-primary">
          <GitMerge size={12} />
          Merged
        </span>
      </div>
    );
  }

  const checksRunning = (pendingCheckCount ?? 0) > 0;
  const checksPass = !checksRunning && failingCheckCount != null && failingCheckCount === 0;
  const checksFail = failingCheckCount != null && failingCheckCount > 0;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {checksRunning && !checksFail && (
        <span className="flex items-center gap-1 text-xs text-status-waiting">
          <Loader size={12} className="animate-spin" />
          Checks running
        </span>
      )}
      {checksPass && (
        <span className="flex items-center gap-1 text-xs text-status-idle">
          <CircleCheck size={12} />
          Checks pass
        </span>
      )}
      {checksFail && (
        <span className="flex items-center gap-1 text-xs text-status-error">
          <CircleX size={12} />
          {failingCheckCount} failing
        </span>
      )}
      {reviewDecision === "approved" && (
        <span className="flex items-center gap-1 text-xs text-status-idle">
          <Eye size={12} />
          Approved
        </span>
      )}
      {reviewDecision === "changes_requested" && (
        <span className="flex items-center gap-1 text-xs text-status-error">
          <Eye size={12} />
          Changes requested
        </span>
      )}
      {reviewDecision === "review_requested" && (
        <span className="flex items-center gap-1 text-xs text-text-tertiary">
          <UserPlus size={12} />
          {prSummary.requestedReviewers && prSummary.requestedReviewers.length > 0
            ? prSummary.requestedReviewers.length === 1
              ? prSummary.requestedReviewers[0]
              : `${prSummary.requestedReviewers[0]} + ${prSummary.requestedReviewers.length - 1} other${prSummary.requestedReviewers.length > 2 ? "s" : ""}`
            : "Review requested"}
        </span>
      )}
      {reviewDecision === "review_required" && (
        <span className="flex items-center gap-1 text-xs text-text-tertiary">
          <Clock size={12} />
          Needs reviewer
        </span>
      )}
      {unresolvedCommentCount != null && unresolvedCommentCount > 0 && (
        <span className="flex items-center gap-1 text-xs text-text-tertiary">
          <MessageCircle size={12} />
          {unresolvedCommentCount}
        </span>
      )}
      {mergeable === false && (
        <span className="flex items-center gap-1 text-xs text-status-error">
          <AlertTriangle size={12} />
          Conflict
        </span>
      )}
      {mergeable === true && reviewDecision === "approved" && checksPass && (
        <span className="flex items-center gap-1 text-xs text-status-idle">
          <CircleCheck size={12} />
          Ready to merge
        </span>
      )}
    </div>
  );
}
