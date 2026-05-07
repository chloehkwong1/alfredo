import { Input } from "../../ui/Input";
import { BaseBranchPicker } from "./BaseBranchPicker";
import { validateBranchName } from "../../../lib/validateBranchName";
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
  const trimmed = branchName.trim();
  // Suppress the message until the user has typed something — empty input is
  // the unsubmitted state, not a validation failure to surface.
  const error = trimmed.length > 0 ? validateBranchName(trimmed) : null;

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
          aria-invalid={error ? true : undefined}
        />
        {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
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
  const name = branchName.trim();
  const base = baseBranch.trim();
  if (!name || !base) return null;
  if (validateBranchName(name) !== null) return null;
  return { kind: "newBranch", name, base };
}

export { NewBranchTab, getNewBranchSource };
