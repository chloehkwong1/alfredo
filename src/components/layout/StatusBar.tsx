import { ExternalLink, Copy, Check } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useState } from "react";
import type { Worktree } from "../../types";

interface StatusBarProps {
  worktree: Worktree | undefined;
  annotationCount: number;
}

function StatusBar({ worktree, annotationCount }: StatusBarProps) {
  const [copied, setCopied] = useState(false);

  if (!worktree) {
    return <div className="h-8 bg-bg-bar border-b border-border-subtle flex-shrink-0" />;
  }

  const pr = worktree.prStatus;

  const handleCopyBranch = () => {
    navigator.clipboard.writeText(worktree.branch);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="h-8 flex items-center justify-between px-4 bg-bg-bar border-b border-border-subtle text-xs text-text-tertiary flex-shrink-0">
      {/* Left side */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleCopyBranch}
          title="Copy branch name"
          className="group flex items-center gap-1 font-medium text-text-secondary max-w-[300px] truncate hover:text-text-primary transition-colors"
        >
          <span className="truncate">{worktree.branch}</span>
          {copied
            ? <Check size={11} className="shrink-0 text-diff-added" />
            : <Copy size={11} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
          }
        </button>
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
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-accent-primary/15 text-accent-primary text-2xs font-medium">
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-accent-primary text-text-on-accent text-2xs font-semibold">
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
