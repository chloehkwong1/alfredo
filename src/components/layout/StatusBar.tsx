import { ExternalLink, Copy, Check } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { PrStatus, Worktree } from "../../types";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";

/** Label + color token for a PR's current state, terminal states first so a
 *  merged/closed PR is never mislabeled "Open". */
function prStatusLabel(pr: PrStatus): { text: string; className: string } {
  if (pr.merged) return { text: "Merged", className: "text-accent-primary" };
  if (pr.state === "closed") return { text: "Closed", className: "text-text-secondary" };
  if (pr.draft) return { text: "Draft", className: "text-status-busy" };
  return { text: "Open", className: "text-status-idle" };
}

interface StatusBarProps {
  worktree: Worktree | undefined;
  annotationCount: number;
}

function StatusBar({ worktree, annotationCount }: StatusBarProps) {
  const { copied, copy } = useCopyToClipboard();

  if (!worktree) {
    return <div className="h-8 bg-bg-bar border-b border-border-subtle flex-shrink-0" />;
  }

  const pr = worktree.prStatus;
  const prLabel = pr ? prStatusLabel(pr) : null;

  return (
    <div className="h-8 flex items-center justify-between px-4 bg-bg-bar border-b border-border-subtle text-xs text-text-tertiary flex-shrink-0">
      {/* Left side */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <button
          type="button"
          onClick={() => copy(worktree.branch)}
          title={worktree.branch}
          className="group flex items-center gap-1 font-medium text-text-secondary min-w-0 hover:text-text-primary transition-colors"
        >
          <span className="truncate" style={{ direction: "rtl" }}>
            <bdi dir="ltr">{worktree.branch}</bdi>
          </span>
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
      <div className="flex items-center gap-3 shrink-0">
        {worktree.linearTicketIdentifier && worktree.linearTicketUrl && (
          <button
            type="button"
            onClick={() => openUrl(worktree.linearTicketUrl!)}
            className="flex items-center gap-1 hover:text-text-secondary transition-colors cursor-pointer"
          >
            <span>{worktree.linearTicketIdentifier}</span>
            <ExternalLink size={12} />
          </button>
        )}
        {pr && prLabel && (
          <button
            type="button"
            onClick={() => openUrl(pr.url)}
            className="flex items-center gap-1 hover:text-text-secondary transition-colors cursor-pointer"
          >
            <span className={prLabel.className}>{prLabel.text} PR #{pr.number}</span>
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
