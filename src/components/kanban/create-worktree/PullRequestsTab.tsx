import { useState, useEffect } from "react";
import { Input } from "../../ui/Input";
import { SelectableList, SelectableItem } from "./SelectableList";
import { syncPrStatus } from "../../../api";
import type { PrStatus } from "../../../types";

interface PullRequestsTabProps {
  repoPath: string;
  open: boolean;
  selectedPrNumber: number | null;
  onSelectPr: (prNumber: number | null) => void;
}

function PullRequestsTab({ repoPath, open, selectedPrNumber, onSelectPr }: PullRequestsTabProps) {
  const [prs, setPrs] = useState<PrStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [fetchedForRepo, setFetchedForRepo] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (open && repoPath && repoPath !== fetchedForRepo) {
      setLoading(true);
      setFetchedForRepo(repoPath);
      onSelectPr(null);
      syncPrStatus(repoPath)
        .then((result) => {
          setPrs(result);
          setError(null);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setLoading(false));
    }
    if (!open) {
      setFetchedForRepo(undefined);
    }
  }, [open, repoPath, fetchedForRepo]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = prs.filter(
    (pr) => !filter.trim() || pr.title.toLowerCase().includes(filter.toLowerCase()) || `#${pr.number}`.includes(filter),
  );

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Filter pull requests..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      <SelectableList
        loading={loading}
        error={error}
        emptyMessage="No pull requests found."
        isEmpty={filtered.length === 0}
      >
        {filtered.map((pr) => (
          <SelectableItem
            key={pr.number}
            selected={pr.number === selectedPrNumber}
            onClick={() => onSelectPr(pr.number === selectedPrNumber ? null : pr.number)}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-mono text-text-tertiary flex-shrink-0">
                #{pr.number}
              </span>
              <span className="text-[13px] font-medium text-text-primary truncate">
                {pr.title}
              </span>
              {pr.draft && (
                <span className="text-2xs text-text-tertiary bg-bg-hover px-1.5 py-0.5 rounded flex-shrink-0">
                  Draft
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1 ml-[30px]">
              <span className="text-xs text-text-tertiary truncate">
                {pr.branch}
              </span>
            </div>
          </SelectableItem>
        ))}
      </SelectableList>
    </div>
  );
}

export { PullRequestsTab };
