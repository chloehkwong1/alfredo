import { Loader2 } from "lucide-react";
import { useOpenIssueProgress } from "../../stores/openIssueProgressStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";

/**
 * Overlay shown while a Linear issue opens (worktree create → Claude boot →
 * prompt paste). Scoped to the content pane (rendered inside its `relative`
 * wrapper, so it centers over the terminal/chat — not the changes panel beside
 * it) and only while the worktree being created is the active one — so it never
 * blocks browsing the other worktrees. Non-blocking (pointer-events-none) so it
 * can't trap the user if a step is slow; clears when the prompt lands.
 */
function OpenIssueOverlay() {
  const status = useOpenIssueProgress((s) => s.status);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  if (!status || status.worktreeId !== activeWorktreeId) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
      <div className="absolute inset-0 bg-black/25 backdrop-blur-[1px] animate-in fade-in-0 duration-150" />
      <div
        role="status"
        aria-live="polite"
        className={[
          "relative flex items-center gap-4",
          "px-6 py-5 max-w-[440px]",
          "bg-bg-elevated border border-border-default",
          "rounded-[var(--radius-md)] shadow-2xl",
          "animate-in fade-in-0 zoom-in-95 duration-150",
        ].join(" ")}
      >
        <Loader2 className="h-5 w-5 text-accent-primary animate-spin flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-text-primary truncate">
            Opening {status.label}
          </div>
          <div className="text-[12px] text-text-tertiary truncate">
            Creating a worktree in {status.repo} and launching Claude…
          </div>
        </div>
      </div>
    </div>
  );
}

export { OpenIssueOverlay };
