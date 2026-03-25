import { useState, useEffect } from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "../ui/Button";
import { getActiveBranch } from "../../api";

interface BranchModeViewProps {
  repoPath: string;
  onEnableWorktrees: () => void;
  onOpenWorkspaceSettings?: () => void;
}

function BranchModeView({
  repoPath,
  onEnableWorktrees,
  onOpenWorkspaceSettings,
}: BranchModeViewProps) {
  const [activeBranch, setActiveBranch] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getActiveBranch(repoPath).then((branch) => {
      if (!cancelled) setActiveBranch(branch);
    });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  return (
    <div className="flex flex-col items-center justify-center flex-1 px-6 py-8 gap-4 text-center">
      <FolderOpen className="w-8 h-8 text-text-tertiary" />

      <div className="space-y-1.5">
        <p className="text-body font-medium text-text-secondary">
          Branch mode
        </p>
        <p className="text-caption text-text-tertiary">
          This repo is using branches directly. Enable worktrees for parallel
          development.
        </p>
      </div>

      <Button variant="secondary" size="sm" onClick={onEnableWorktrees}>
        Enable worktrees
      </Button>

      <div className="w-full h-px bg-border-subtle my-1" />

      {activeBranch && (
        <div className="flex flex-col items-center gap-1">
          <span className="text-micro uppercase tracking-wider text-text-tertiary">
            Current branch
          </span>
          <span className="text-caption text-text-secondary font-mono">
            {activeBranch}
          </span>
        </div>
      )}

      {onOpenWorkspaceSettings && (
        <button
          type="button"
          className="text-caption text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer mt-2"
          onClick={onOpenWorkspaceSettings}
        >
          Workspace settings
        </button>
      )}
    </div>
  );
}

export { BranchModeView };
