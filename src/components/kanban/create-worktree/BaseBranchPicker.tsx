import { useState, useEffect, useRef } from "react";
import { GitBranch } from "lucide-react";
import { Input } from "../../ui/Input";
import { SelectableList, SelectableItem } from "./SelectableList";
import { listBranches } from "../../../api";
import type { Worktree } from "../../../types";

interface BaseBranchPickerProps {
  repoPath: string;
  baseBranch: string;
  onBaseBranchChange: (branch: string) => void;
  locked?: boolean;
  open: boolean;
}

function BaseBranchPicker({
  repoPath,
  baseBranch,
  onBaseBranchChange,
  locked,
  open,
}: BaseBranchPickerProps) {
  const [expanded, setExpanded] = useState(false);
  const [branches, setBranches] = useState<Worktree[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  // Collapse and clear cache when dialog closes
  useEffect(() => {
    if (!open) {
      setExpanded(false);
      setFilter("");
      setBranches([]);
      setError(null);
    }
  }, [open]);

  // Fetch branches on expand (only if not already cached)
  useEffect(() => {
    if (expanded && repoPath && branches.length === 0) {
      setLoading(true);
      listBranches(repoPath)
        .then((result) => {
          setBranches(result);
          setError(null);
        })
        .catch((err) =>
          setError(err instanceof Error ? err.message : String(err)),
        )
        .finally(() => setLoading(false));
    }
  }, [expanded, repoPath, branches.length]);

  // Focus filter input when expanded
  useEffect(() => {
    if (expanded) {
      // Delay to let the DOM render
      requestAnimationFrame(() => filterRef.current?.focus());
    }
  }, [expanded]);

  const filtered = branches.filter(
    (b) =>
      !filter.trim() ||
      b.branch.toLowerCase().includes(filter.toLowerCase()),
  );

  if (!expanded) {
    return (
      <div className="flex items-center gap-2 text-[13px]">
        <span className="text-xs text-text-tertiary">Base branch</span>
        <GitBranch className="h-3.5 w-3.5 flex-shrink-0 opacity-50" />
        <span className="text-text-secondary font-medium truncate">
          {baseBranch}
        </span>
        {locked ? (
          <span className="text-text-tertiary text-xs ml-1">
            (stacking — base is fixed)
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-accent-fg text-xs hover:underline cursor-pointer ml-1"
          >
            Change
          </button>
        )}
      </div>
    );
  }

  const collapse = () => {
    setExpanded(false);
    setFilter("");
  };

  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          collapse();
        }
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          ref={filterRef}
          placeholder="Filter branches..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1"
        />
        <button
          type="button"
          onClick={collapse}
          className="text-text-tertiary text-xs hover:text-text-secondary cursor-pointer shrink-0"
        >
          Cancel
        </button>
      </div>
      <SelectableList
        loading={loading}
        error={error}
        emptyMessage="No branches found."
        isEmpty={filtered.length === 0}
      >
        {filtered.map((b) => (
          <SelectableItem
            key={b.branch}
            selected={b.branch === baseBranch}
            onClick={() => {
              onBaseBranchChange(b.branch);
              setExpanded(false);
              setFilter("");
            }}
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

export { BaseBranchPicker };
