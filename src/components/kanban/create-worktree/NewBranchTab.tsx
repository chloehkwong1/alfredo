import { Input } from "../../ui/Input";
import type { WorktreeSource } from "../../../types";

interface NewBranchTabProps {
  branchName: string;
  baseBranch: string;
  onBranchNameChange: (name: string) => void;
  onBaseBranchChange: (base: string) => void;
  locked?: boolean;
}

function NewBranchTab({ branchName, baseBranch, onBranchNameChange, onBaseBranchChange, locked }: NewBranchTabProps) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-2">
          Branch name
        </label>
        <Input
          placeholder="feat/my-feature"
          value={branchName}
          onChange={(e) => onBranchNameChange(e.target.value)}
          autoFocus
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-text-secondary mb-2">
          Base branch
        </label>
        <Input
          placeholder="e.g. main, develop"
          value={baseBranch}
          onChange={(e) => onBaseBranchChange(e.target.value)}
          disabled={locked}
        />
        {locked && (
          <p className="text-xs text-accent-primary mt-1.5">
            Stacking on <span className="font-medium">{baseBranch}</span>
          </p>
        )}
      </div>
    </div>
  );
}

function getNewBranchSource(branchName: string, baseBranch: string): WorktreeSource | null {
  if (!branchName.trim()) return null;
  if (!baseBranch.trim()) return null;
  return { kind: "newBranch", name: branchName.trim(), base: baseBranch.trim() };
}

export { NewBranchTab, getNewBranchSource };
