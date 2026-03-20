import { Button } from "../ui/Button";
import { FolderOpen, Plus, GitBranch, ArrowRight, Lightbulb } from "lucide-react";

interface EmptyWorkspaceProps {
  onCreateWorktree: () => void;
  repoPath?: string;
}

function EmptyWorkspace({ onCreateWorktree, repoPath }: EmptyWorkspaceProps) {
  const repoName = repoPath?.split("/").filter(Boolean).pop() ?? "repository";

  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="flex flex-col items-center text-center max-w-md px-6 -mt-12">
        {/* Success indicator */}
        <div className="h-12 w-12 rounded-full bg-accent-muted flex items-center justify-center mb-6">
          <FolderOpen className="h-5 w-5 text-accent-primary" />
        </div>

        <h2 className="text-lg font-semibold text-text-primary mb-1">
          {repoName}
        </h2>

        {repoPath && (
          <p className="text-xs text-text-tertiary font-mono mb-6 max-w-full truncate px-4">
            {repoPath}
          </p>
        )}

        <p className="text-sm text-text-secondary mb-8 leading-relaxed">
          Your repository is ready. Create a worktree to spin up an
          isolated branch with its own terminal and agent session.
        </p>

        {/* Primary action */}
        <Button size="lg" onClick={onCreateWorktree}>
          <Plus className="h-4 w-4" />
          Create a worktree
        </Button>

        {/* How it works hint */}
        <div className="mt-10 flex items-center gap-3 text-text-tertiary">
          <div className="flex items-center gap-1.5 text-xs">
            <GitBranch className="h-3.5 w-3.5" />
            <span>Branch</span>
          </div>
          <ArrowRight className="h-3 w-3" />
          <div className="flex items-center gap-1.5 text-xs">
            <div className="h-1.5 w-1.5 rounded-full bg-status-busy" />
            <span>Agent</span>
          </div>
          <ArrowRight className="h-3 w-3" />
          <div className="flex items-center gap-1.5 text-xs">
            <div className="h-3.5 w-3.5 rounded-sm border border-text-tertiary flex items-center justify-center text-[8px] leading-none font-mono">&gt;_</div>
            <span>Terminal</span>
          </div>
        </div>

        {/* Setup scripts tip */}
        <div className="mt-6 flex items-start gap-2.5 px-4 py-3 rounded-[var(--radius-md)] bg-bg-secondary border border-border-default max-w-sm">
          <Lightbulb className="h-4 w-4 text-text-tertiary flex-shrink-0 mt-px" />
          <p className="text-xs text-text-secondary text-left leading-relaxed">
            Configure setup scripts in workspace settings to automate{" "}
            <code className="px-1 py-0.5 bg-bg-hover rounded text-[11px]">
              npm install
            </code>{" "}
            for new worktrees.
          </p>
        </div>
      </div>
    </div>
  );
}

export { EmptyWorkspace };
export type { EmptyWorkspaceProps };
