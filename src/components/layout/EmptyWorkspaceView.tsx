import { CatLogo } from "../ui/CatLogo";

interface EmptyWorkspaceViewProps {
  hasWorktreeRepos: boolean;
  hasRepos: boolean;
}

function EmptyWorkspaceView({ hasWorktreeRepos, hasRepos }: EmptyWorkspaceViewProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full w-full text-text-tertiary gap-3">
      <CatLogo aria-hidden className="w-16 h-16 opacity-[0.15] select-none pointer-events-none text-white" />
      <div className="flex flex-col items-center gap-1">
        <span className="text-sm">
          {hasWorktreeRepos
            ? "Select a worktree to get started"
            : "Select a repo to get started"}
        </span>
        {hasWorktreeRepos && (
          <span className="text-xs">Each worktree gets its own branch, terminal, and agent · <kbd className="px-1.5 py-0.5 rounded bg-bg-elevated border border-border-default font-mono text-[11px]">⌘N</kbd> to create new worktree</span>
        )}
        {!hasWorktreeRepos && hasRepos && (
          <span className="text-xs">Click a repo in the sidebar to open it</span>
        )}
      </div>
    </div>
  );
}

export { EmptyWorkspaceView };
export type { EmptyWorkspaceViewProps };
