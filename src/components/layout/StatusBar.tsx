import type { Worktree } from "../../types";

interface StatusBarProps {
  worktree: Worktree | undefined;
  annotationCount: number;
}

function StatusBar({ worktree, annotationCount }: StatusBarProps) {
  if (!worktree) {
    return (
      <div className="h-7 bg-bg-secondary border-t border-border-default flex-shrink-0" />
    );
  }

  const prLabel = worktree.prStatus
    ? worktree.prStatus.draft
      ? `Draft PR #${worktree.prStatus.number}`
      : `Open PR #${worktree.prStatus.number}`
    : null;

  const prColor = worktree.prStatus?.draft
    ? "text-status-busy"
    : "text-status-idle";

  return (
    <div className="h-7 flex items-center justify-between px-4 bg-bg-secondary border-t border-border-default text-xs text-text-tertiary flex-shrink-0">
      {/* Left side */}
      <div className="flex items-center gap-3">
        <span className="font-medium">{worktree.branch}</span>
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {prLabel && <span className={prColor}>{prLabel}</span>}
        {annotationCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent-primary/15 text-accent-primary text-[10px] font-medium">
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-accent-primary text-text-on-accent text-[9px] font-semibold">
              {annotationCount}
            </span>
            {annotationCount === 1 ? "annotation" : "annotations"}
          </span>
        )}
      </div>
    </div>
  );
}

export { StatusBar };
export type { StatusBarProps };
