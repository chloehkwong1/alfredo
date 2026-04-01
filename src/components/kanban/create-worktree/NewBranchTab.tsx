import { Input } from "../../ui/Input";
import { BaseBranchPicker } from "./BaseBranchPicker";
import type { WorktreeSource } from "../../../types";

interface NewBranchTabProps {
  repoPath: string;
  branchName: string;
  baseBranch: string;
  onBranchNameChange: (name: string) => void;
  onBaseBranchChange: (base: string) => void;
  locked?: boolean;
  open: boolean;
}

function NewBranchTab({ repoPath, branchName, baseBranch, onBranchNameChange, onBaseBranchChange, locked, open }: NewBranchTabProps) {
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
      <BaseBranchPicker
        repoPath={repoPath}
        baseBranch={baseBranch}
        onBaseBranchChange={onBaseBranchChange}
        locked={locked}
        open={open}
      />
    </div>
  );
}

function getNewBranchSource(branchName: string, baseBranch: string): WorktreeSource | null {
  if (!branchName.trim()) return null;
  if (!baseBranch.trim()) return null;
  return { kind: "newBranch", name: branchName.trim(), base: baseBranch.trim() };
}

export { NewBranchTab, getNewBranchSource };
