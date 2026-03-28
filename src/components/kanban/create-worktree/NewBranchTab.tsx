import { Input } from "../../ui/Input";
import type { WorktreeSource } from "../../../types";

interface NewBranchTabProps {
  branchName: string;
  baseBranch: string;
  onBranchNameChange: (name: string) => void;
  onBaseBranchChange: (base: string) => void;
}

function NewBranchTab({ branchName, baseBranch, onBranchNameChange, onBaseBranchChange }: NewBranchTabProps) {
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
          placeholder="main"
          value={baseBranch}
          onChange={(e) => onBaseBranchChange(e.target.value)}
        />
      </div>
    </div>
  );
}

function getNewBranchSource(branchName: string, baseBranch: string): WorktreeSource | null {
  if (!branchName.trim()) return null;
  return { kind: "newBranch", name: branchName.trim(), base: baseBranch || "main" };
}

export { NewBranchTab, getNewBranchSource };
