import { formatTimeAgo } from "./formatRelativeTime";
import { MarkdownBody } from "../shared/MarkdownBody";

export function ReviewRow({
  reviewer,
  state,
  submittedAt,
  body,
}: {
  reviewer: string;
  state: string;
  submittedAt: string | null;
  body?: string | null;
}) {
  const stateColorClass =
    state === "APPROVED"
      ? "text-diff-added"
      : state === "CHANGES_REQUESTED"
        ? "text-diff-removed"
        : "text-text-tertiary";

  const stateLabel =
    state === "APPROVED"
      ? "Approved"
      : state === "CHANGES_REQUESTED"
        ? "Changes requested"
        : state === "DISMISSED"
          ? "Dismissed"
          : state === "REQUESTED"
            ? "Requested"
            : "Pending";

  const initial = reviewer.charAt(0).toUpperCase();
  const hasBody = Boolean(body && body.trim().length > 0);

  return (
    <div className="px-2.5 py-1.5 text-[13px]">
      <div className="flex items-center gap-2">
        {/* Avatar */}
        <div className="w-5 h-5 rounded-full bg-bg-hover flex items-center justify-center text-[11px] font-semibold text-text-primary shrink-0">
          {initial}
        </div>
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">
          {reviewer}
        </span>
        <span className={`${stateColorClass} shrink-0 text-[11px]`}>
          {stateLabel}
        </span>
        {submittedAt && (
          <span className="text-text-tertiary shrink-0 text-[11px]">
            {formatTimeAgo(submittedAt)}
          </span>
        )}
      </div>
      {hasBody && (
        <details className="mt-1 ml-7">
          <summary className="text-text-tertiary text-[11px] cursor-pointer select-none hover:text-text-primary">
            Show summary
          </summary>
          <div className="mt-1 rounded bg-bg-hover/40 px-2 py-1.5">
            <MarkdownBody text={body as string} compact />
          </div>
        </details>
      )}
    </div>
  );
}
