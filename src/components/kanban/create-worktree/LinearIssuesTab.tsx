import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "../../ui/Input";
import { SelectableList, SelectableItem } from "./SelectableList";
import { searchLinearIssues } from "../../../api";
import type { LinearTicket } from "../../../types";

interface LinearIssuesTabProps {
  open: boolean;
  selectedIssueId: string | null;
  onSelectIssue: (issueId: string | null) => void;
}

function LinearIssuesTab({ open, selectedIssueId, onSelectIssue }: LinearIssuesTabProps) {
  const [results, setResults] = useState<LinearTicket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const searchLinear = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!q.trim()) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await searchLinearIssues(q);
        setResults(res);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setResults([]);
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
      setResults([]);
      setError(null);
    }
  }, [open]);

  const emptyMessage = query.trim()
    ? "No issues found."
    : "Type to search Linear issues.";

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
    </div>
  );
}

export { LinearIssuesTab };
