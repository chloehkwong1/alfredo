import { formatTimeAgo } from "./formatRelativeTime";

export function ReviewRow({
  reviewer,
  state,
  submittedAt,
}: {
  reviewer: string;
  state: string;
  submittedAt: string | null;
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

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 text-xs">
      {/* Avatar */}
      <div className="w-5 h-5 rounded-full bg-bg-hover flex items-center justify-center text-[10px] font-bold text-text-primary shrink-0">
        {initial}
      </div>
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary">
        {reviewer}
      </span>
      <span className={`${stateColorClass} shrink-0 text-[11px]`}>
        {stateLabel}
      </span>
      {submittedAt && (
        <span className="text-text-tertiary shrink-0 text-[10px]">
          {formatTimeAgo(submittedAt)}
        </span>
      )}
    </div>
  );
}
