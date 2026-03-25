import { ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Worktree } from "../../types";

interface StatusBarProps {
  worktree: Worktree | undefined;
  annotationCount: number;
}

function StatusBar({ worktree, annotationCount }: StatusBarProps) {
  if (!worktree) {
    return (
      <div className="h-8 flex items-center justify-center bg-bg-bar border-t border-border-subtle flex-shrink-0 text-caption text-text-tertiary">
        Select a worktree to get started
      </div>
    );
  }

  const pr = worktree.prStatus;

  return (
    <div className="h-8 flex items-center justify-between px-4 bg-bg-bar border-t border-border-subtle text-caption text-text-tertiary flex-shrink-0">
      {/* Left side */}
      <div className="flex items-center gap-3">
        <span className="font-medium text-text-secondary max-w-[300px] truncate">{worktree.branch}</span>
        {worktree.additions != null && worktree.additions > 0 && (
          <span className="text-diff-added">+{worktree.additions}</span>
        )}
        {worktree.deletions != null && worktree.deletions > 0 && (
          <span className="text-diff-removed">-{worktree.deletions}</span>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-3">
        {pr && (
          <button
            type="button"
            onClick={() => openUrl(pr.url)}
            className="flex items-center gap-1 hover:text-text-secondary transition-colors cursor-pointer"
          >
            <span className={pr.draft ? "text-status-busy" : "text-status-idle"}>
              {pr.draft ? "Draft" : "Open"} PR #{pr.number}
            </span>
            <ExternalLink size={12} />
          </button>
        )}
        {annotationCount > 0 && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent-primary/15 text-accent-primary text-micro font-medium">
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-accent-primary text-text-on-accent text-micro font-semibold">
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
