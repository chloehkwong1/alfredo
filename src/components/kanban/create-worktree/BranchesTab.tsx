import { useState, useEffect } from "react";
import { GitBranch } from "lucide-react";
import { Input } from "../../ui/Input";
import { SelectableList, SelectableItem } from "./SelectableList";
import { listBranches } from "../../../api";
import type { Worktree } from "../../../types";

interface BranchesTabProps {
  repoPath: string;
  open: boolean;
  selectedBranch: string | null;
  onSelectBranch: (branch: string | null) => void;
  onDefaultBranchDetected: (branch: string) => void;
}

function BranchesTab({ repoPath, open, selectedBranch, onSelectBranch, onDefaultBranchDetected }: BranchesTabProps) {
  const [branches, setBranches] = useState<Worktree[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (open && repoPath) {
      setLoading(true);
      onSelectBranch(null);
      listBranches(repoPath)
        .then((result) => {
          setBranches(result);
          setError(null);
          const names = result.map((b) => b.branch);
          const defaultBranch = names.find((n) => n === "main")
            ?? names.find((n) => n === "master")
            ?? names[0]
            ?? "main";
          onDefaultBranchDetected(defaultBranch);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    }
  }, [open, repoPath]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally only re-fetch on open/repo change

  const filtered = branches.filter(
    (b) => !filter.trim() || b.branch.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Filter branches..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      <SelectableList
        loading={loading}
        error={error}
        emptyMessage="No branches found."
        isEmpty={filtered.length === 0}
      >
        {filtered.map((b) => (
          <SelectableItem
            key={b.branch}
            selected={b.branch === selectedBranch}
            onClick={() => onSelectBranch(b.branch === selectedBranch ? null : b.branch)}
          >
            <div className="flex items-center gap-2.5">
              <GitBranch className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
              <span className="text-[13px] font-medium truncate">
                {b.branch}
              </span>
            </div>
          </SelectableItem>
        ))}
      </SelectableList>
    </div>
  );
}

export { BranchesTab };
