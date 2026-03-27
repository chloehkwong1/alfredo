import { useEffect, useCallback } from "react";
import { PrHeader } from "./PrHeader";
import { CheckRunItem } from "./CheckRunItem";
import { getCheckRuns } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Worktree } from "../../types";
import { RefreshCw } from "lucide-react";
import { IconButton } from "../ui";

interface PrDetailPanelProps {
  worktree: Worktree;
  repoPath: string;
}

function PrDetailPanel({ worktree, repoPath }: PrDetailPanelProps) {
  const checkRuns = useWorkspaceStore((s) => s.checkRuns[worktree.id]) ?? [];
  const setCheckRuns = useWorkspaceStore((s) => s.setCheckRuns);

  const fetchChecks = useCallback(async () => {
    try {
      const runs = await getCheckRuns(repoPath, worktree.branch);
      setCheckRuns(worktree.id, runs);
    } catch (err) {
      console.error("Failed to fetch check runs:", err);
    }
  }, [repoPath, worktree.branch, worktree.id, setCheckRuns]);

  // Track whether a PR exists, not the full prStatus object, to avoid
  // restarting the polling interval on every PR metadata update.
  const hasPr = !!worktree.prStatus;

  useEffect(() => {
    if (!hasPr) return;
    fetchChecks();
    const interval = setInterval(fetchChecks, 30_000);
    return () => clearInterval(interval);
  }, [hasPr, fetchChecks]);

  if (!worktree.prStatus) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        No pull request for this branch
      </div>
    );
  }

  const successCount = checkRuns.filter((r) => r.conclusion === "success").length;
  const failureCount = checkRuns.filter((r) => r.conclusion === "failure" || r.conclusion === "timed_out").length;
  const pendingCount = checkRuns.filter((r) => r.status !== "completed").length;

  return (
    <div className="flex flex-col h-full">
      <PrHeader pr={worktree.prStatus} />

      {/* Checks section */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
            Checks
          </span>
          {checkRuns.length > 0 && (
            <span className="text-2xs text-text-tertiary">
              {successCount} passed
              {failureCount > 0 && `, ${failureCount} failed`}
              {pendingCount > 0 && `, ${pendingCount} pending`}
            </span>
          )}
        </div>
        <IconButton size="sm" label="Refresh checks" onClick={fetchChecks}>
          <RefreshCw />
        </IconButton>
      </div>

      <div className="flex-1 overflow-y-auto">
        {checkRuns.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-text-tertiary text-sm">
            No checks found
          </div>
        ) : (
          checkRuns.map((run) => <CheckRunItem key={run.id} run={run} repoPath={repoPath} />)
        )}
      </div>
    </div>
  );
}

export { PrDetailPanel };
