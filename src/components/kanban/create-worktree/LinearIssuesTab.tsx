import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "../../ui/Input";
import { SelectableList, SelectableItem } from "./SelectableList";
import { BaseBranchPicker } from "./BaseBranchPicker";
import { searchLinearIssues, listMyLinearIssues } from "../../../api";
import type { LinearTicket } from "../../../types";

interface LinearIssuesTabProps {
  repoPath: string;
  open: boolean;
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string | null) => void;
  baseBranch: string;
  onBaseBranchChange: (base: string) => void;
  lockedBaseBranch?: boolean;
}

function LinearIssuesTab({ repoPath, open, selectedIssueId, onSelectIssue, baseBranch, onBaseBranchChange, lockedBaseBranch }: LinearIssuesTabProps) {
  const [defaultIssues, setDefaultIssues] = useState<LinearTicket[]>([]);
  const [searchResults, setSearchResults] = useState<LinearTicket[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load assigned issues when tab opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    listMyLinearIssues()
      .then((issues) => {
        if (!cancelled) setDefaultIssues(issues);
      })
      .catch(() => {
        // Silently degrade — search still works
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open]);

  const searchLinear = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q.trim()) {
      setSearchResults(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchLinearIssues(q);
        setSearchResults(res);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setSearchResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

  useEffect(() => {
    searchLinear(query);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchLinear]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setSearchResults(null);
      setDefaultIssues([]);
      setError(null);
    }
  }, [open]);

  const results = searchResults ?? defaultIssues;
  const emptyMessage = query.trim()
    ? "No issues found."
    : "No assigned issues.";

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search Linear issues..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />
      <SelectableList
        loading={loading}
        error={error}
        emptyMessage={emptyMessage}
        isEmpty={results.length === 0}
      >
        {results.map((issue) => (
          <SelectableItem
            key={issue.id}
            selected={issue.id === selectedIssueId}
            onClick={() => onSelectIssue(issue.id === selectedIssueId ? null : issue.id)}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-xs font-mono text-text-tertiary flex-shrink-0">
                {issue.identifier}
              </span>
              <span className="text-[13px] font-medium text-text-primary truncate">
                {issue.title}
              </span>
            </div>
            <div className="flex items-center gap-2 mt-1 ml-[42px]">
              <span className="text-xs text-text-tertiary">
                {issue.state}
              </span>
              {issue.assignee && (
                <span className="text-xs text-text-tertiary">
                  &middot; {issue.assignee}
                </span>
              )}
            </div>
          </SelectableItem>
        ))}
      </SelectableList>
      <BaseBranchPicker
        repoPath={repoPath}
        baseBranch={baseBranch}
        onBaseBranchChange={onBaseBranchChange}
        locked={lockedBaseBranch}
        open={open}
      />
    </div>
  );
}

export { LinearIssuesTab };
