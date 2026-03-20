import { Logo } from "../Logo";
import { Button } from "../ui/Button";
import { Plus } from "lucide-react";

interface EmptyWorkspaceProps {
  onCreateWorktree: () => void;
}

function EmptyWorkspace({ onCreateWorktree }: EmptyWorkspaceProps) {
  return (
    <div className="flex-1 flex items-center justify-center h-full">
      <div className="flex flex-col items-center text-center max-w-md px-6">
        <Logo
          size={48}
          color="var(--text-tertiary)"
          className="mb-5 opacity-60"
        />

        <h2 className="text-lg font-semibold text-text-primary mb-2">
          No worktrees yet
        </h2>

        <p className="text-sm text-text-secondary mb-6 leading-relaxed">
          Create a worktree to start an agent session. Each worktree gets its
          own terminal and branch.
        </p>

        <Button size="lg" onClick={onCreateWorktree}>
          <Plus className="h-4 w-4" />
          Create first worktree
        </Button>

        <p className="text-xs text-text-tertiary mt-6">
          Tip: configure setup scripts in workspace settings to automate{" "}
          <code className="px-1 py-0.5 bg-bg-secondary rounded text-[11px]">
            npm install
          </code>{" "}
          etc.
        </p>
      </div>
    </div>
  );
}

export { EmptyWorkspace };
export type { EmptyWorkspaceProps };
