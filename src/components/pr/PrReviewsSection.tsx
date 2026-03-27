import { type ReactNode } from "react";
import { CheckCircle, XCircle, Clock, XOctagon } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import type { PrReview } from "../../types";

interface PrReviewsSectionProps {
  reviews: PrReview[];
}

const stateIcon: Record<string, ReactNode> = {
  approved: <CheckCircle className="h-3.5 w-3.5 text-diff-added" />,
  changes_requested: <XCircle className="h-3.5 w-3.5 text-status-error" />,
  pending: <Clock className="h-3.5 w-3.5 text-text-tertiary" />,
  dismissed: <XOctagon className="h-3.5 w-3.5 text-text-tertiary" />,
};

const stateLabel: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  pending: "Pending",
  dismissed: "Dismissed",
};

function PrReviewsSection({ reviews }: PrReviewsSectionProps) {
  const sortOrder: Record<string, number> = {
    changes_requested: 0,
    pending: 1,
    approved: 2,
    dismissed: 3,
  };
  const sorted = [...reviews].sort(
    (a, b) => (sortOrder[a.state] ?? 4) - (sortOrder[b.state] ?? 4),
  );

  const hasChangesRequested = reviews.some((r) => r.state === "changes_requested");

  const badge = reviews.length > 0 ? (
    <span className="text-2xs text-text-tertiary">{reviews.length} reviewers</span>
  ) : null;

  return (
    <CollapsibleSection title="Reviews" badge={badge} defaultOpen={hasChangesRequested}>
      {sorted.length === 0 ? (
        <div className="text-sm text-text-tertiary py-2">No reviews yet</div>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((review) => (
            <div key={review.reviewer} className="flex items-center gap-2">
              {stateIcon[review.state] ?? <Clock className="h-3.5 w-3.5 text-text-tertiary" />}
              <span className="text-sm text-text-secondary font-medium">
                @{review.reviewer}
              </span>
              <span
                className={[
                  "text-xs",
                  review.state === "changes_requested"
                    ? "text-status-error"
                    : review.state === "approved"
                      ? "text-diff-added"
                      : "text-text-tertiary",
                ].join(" ")}
              >
                {stateLabel[review.state] ?? review.state}
              </span>
            </div>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

export { PrReviewsSection };
