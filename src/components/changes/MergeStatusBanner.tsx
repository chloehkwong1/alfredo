import { useState, useEffect } from "react";
import type { CheckRun, PrStatus, WorkflowRunLog } from "../../types";
import { formatTimeAgo } from "./formatRelativeTime";
import { rerunFailedChecks, fixFailingChecks, mergeAndFix, pushForceWithLease } from "../../services/prActions";
import { focusAgentTab } from "../../services/agentMessenger";
import { getJobLog } from "../../api";
import { Button } from "../ui/Button";

export function MergeStatusBanner({
  worktreeId,
  pr,
  checkRuns,
  mergeable,
  reviewDecision,
  repoPath,
  branch,
}: {
  worktreeId: string;
  pr: PrStatus;
  checkRuns: CheckRun[];
  mergeable: boolean | null;
  reviewDecision: string | null;
  repoPath: string;
  branch: string;
}) {
  const [loading, setLoading] = useState<"rerun" | "fix" | "merge" | "push" | null>(null);
  const [readyToPush, setReadyToPush] = useState(false);
  const [checksExpanded, setChecksExpanded] = useState(false);
  const [failureLogs, setFailureLogs] = useState<Record<number, WorkflowRunLog | null>>({});
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [logsLoading, setLogsLoading] = useState(false);

  // Clear readyToPush when mergeable state changes (e.g. agent pushed, or merge aborted externally)
  useEffect(() => {
    if (mergeable !== false) setReadyToPush(false);
  }, [mergeable]);

  const failedChecks = checkRuns.filter(
    (r) => r.status === "completed" && r.conclusion !== "success" && r.conclusion !== "skipped" && r.conclusion !== null,
  );

  const handleRerun = async () => {
    setLoading("rerun");
    try {
      await rerunFailedChecks(repoPath, failedChecks);
    } finally {
      setLoading(null);
    }
  };

  const handleFixChecks = async () => {
    setLoading("fix");
    try {
      const sent = await fixFailingChecks(worktreeId, repoPath, branch, failedChecks);
      if (sent) focusAgentTab(worktreeId);
    } finally {
      setLoading(null);
    }
  };

  const handleMergeAndFix = async () => {
    setLoading("merge");
    try {
      const result = await mergeAndFix(worktreeId, repoPath, branch, pr.baseBranch ?? "main");
      if (result.merged) {
        setReadyToPush(true);
      }
    } catch (e) {
      console.error("Merge failed:", e);
    } finally {
      setLoading(null);
    }
  };

  const handlePush = async () => {
    setLoading("push");
    try {
      await pushForceWithLease(repoPath);
      setReadyToPush(false);
    } catch (e) {
      console.error("Push failed:", e);
    } finally {
      setLoading(null);
    }
  };

  const handleExpandChecks = async () => {
    const next = !checksExpanded;
    setChecksExpanded(next);

    if (!next) return;

    // Fetch logs for failed checks we haven't fetched yet
    const toFetch = failedChecks.filter((run) => !(run.id in failureLogs));
    if (toFetch.length === 0) return;

    setLogsLoading(true);
    try {
      const results = await Promise.allSettled(
        toFetch.map((run) => getJobLog(repoPath, run.id, run.name)),
      );

      const newLogs: Record<number, WorkflowRunLog | null> = { ...failureLogs };
      toFetch.forEach((run, i) => {
        const result = results[i];
        newLogs[run.id] = result.status === "fulfilled" ? result.value : null;
      });
      setFailureLogs(newLogs);
    } finally {
      setLogsLoading(false);
    }
  };

  const toggleLogExpand = (key: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Merged ──
  if (pr.merged) {
    return (
      <div className="px-2.5 py-1.5 bg-accent-primary/10 border-t border-accent-primary/20 text-xs text-accent-primary font-semibold shrink-0">
        Merged{pr.mergedAt ? ` · ${formatTimeAgo(pr.mergedAt)}` : ""}
      </div>
    );
  }

  // ── Closed ──
  if (pr.state === "closed") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        Closed
      </div>
    );
  }

  // ── Ready to push (after merge conflict resolution) ──
  if (readyToPush) {
    return (
      <div className="px-2.5 py-1.5 bg-diff-added/10 border-t border-diff-added/20 text-xs text-diff-added font-semibold shrink-0 flex items-center gap-2">
        <span className="flex-1">Ready to push</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handlePush}
          disabled={loading !== null}
          className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
        >
          {loading === "push" ? "Pushing\u2026" : "Push"}
        </Button>
      </div>
    );
  }

  // ── Priority 1: Merge conflict ──
  if (mergeable === false) {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0 flex items-center gap-2">
        <span className="flex-1">Merge conflict</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleMergeAndFix}
          disabled={loading !== null}
          className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
        >
          {loading === "merge" ? "Merging\u2026" : "Fix conflicts"}
        </Button>
      </div>
    );
  }

  // ── Priority 2: Failing checks (expandable) ──
  if (failedChecks.length > 0) {
    // Build a map from check name to log entries for display
    const logsByCheck = new Map<string, { jobName: string; stepName: string; excerpt: string; htmlUrl: string }[]>();
    for (const check of failedChecks) {
      const entries: { jobName: string; stepName: string; excerpt: string; htmlUrl: string }[] = [];
      const log = failureLogs[check.id];
      if (log) {
        entries.push({
          jobName: log.jobName,
          stepName: log.stepName,
          excerpt: log.logExcerpt,
          htmlUrl: check.htmlUrl,
        });
      }
      if (entries.length === 0) {
        entries.push({
          jobName: check.name,
          stepName: "",
          excerpt: "",
          htmlUrl: check.htmlUrl,
        });
      }
      logsByCheck.set(check.name, entries);
    }

    return (
      <div className="bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        {/* Header row */}
        <div className="px-2.5 py-1.5 flex items-center gap-2">
          <button
            onClick={handleExpandChecks}
            className="flex-1 flex items-center gap-1.5 text-left"
          >
            <svg
              className={`w-3 h-3 transition-transform ${checksExpanded ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {failedChecks.length} check{failedChecks.length !== 1 ? "s" : ""} failing
          </button>
          {!checksExpanded && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRerun}
                disabled={loading !== null}
                className="text-[10px] px-2 py-0.5 h-auto bg-bg-secondary border border-border-default text-text-secondary hover:bg-bg-hover disabled:opacity-50 font-medium"
              >
                {loading === "rerun" ? "Rerunning\u2026" : "Rerun"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleFixChecks}
                disabled={loading !== null}
                className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
              >
                {loading === "fix" ? "Sending\u2026" : "Fix with agent"}
              </Button>
            </>
          )}
        </div>

        {/* Expanded failure list */}
        {checksExpanded && (
          <div className="border-t border-diff-removed/20">
            {[...logsByCheck.entries()].map(([checkName, entries]) => (
              <div key={checkName} className="px-2.5 py-1.5 border-b border-diff-removed/10 last:border-b-0">
                {entries.map((entry, i) => {
                  const logKey = `${checkName}-${i}`;
                  const lines = entry.excerpt.split("\n");
                  const collapsed = lines.length > 5 && !expandedLogs.has(logKey);
                  const displayLines = collapsed ? lines.slice(0, 5) : lines;

                  return (
                    <div key={logKey}>
                      <div className="font-semibold text-diff-removed mb-0.5">
                        {entry.jobName}{entry.stepName ? ` / ${entry.stepName}` : ""}
                      </div>
                      {entry.excerpt ? (
                        <>
                          <pre className="text-[10px] font-mono text-text-secondary bg-bg-primary/50 rounded px-1.5 py-1 overflow-x-auto whitespace-pre-wrap">
                            {displayLines.join("\n")}
                          </pre>
                          {collapsed && (
                            <button
                              onClick={() => toggleLogExpand(logKey)}
                              className="text-[10px] text-accent-primary hover:underline mt-0.5"
                            >
                              Show more ({lines.length - 5} more lines)
                            </button>
                          )}
                          {!collapsed && lines.length > 5 && (
                            <button
                              onClick={() => toggleLogExpand(logKey)}
                              className="text-[10px] text-accent-primary hover:underline mt-0.5"
                            >
                              Show less
                            </button>
                          )}
                        </>
                      ) : logsLoading ? (
                        <div className="text-[10px] text-text-tertiary italic">
                          Loading logs…
                        </div>
                      ) : (
                        <div className="text-[10px] text-text-tertiary italic">
                          No logs available — agent will check CI output
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Bulk actions at bottom */}
            <div className="px-2.5 py-1.5 flex items-center justify-end gap-2 border-t border-diff-removed/20">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRerun}
                disabled={loading !== null}
                className="text-[10px] px-2 py-0.5 h-auto bg-bg-secondary border border-border-default text-text-secondary hover:bg-bg-hover disabled:opacity-50 font-medium"
              >
                {loading === "rerun" ? "Rerunning\u2026" : "Rerun all"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleFixChecks}
                disabled={loading !== null}
                className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
              >
                {loading === "fix" ? "Sending\u2026" : "Fix with agent"}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Ready to merge ──
  if (mergeable === true && reviewDecision === "APPROVED") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-added/10 border-t border-diff-added/20 text-xs text-diff-added font-semibold shrink-0">
        Ready to merge
      </div>
    );
  }

  // ── Changes requested ──
  if (reviewDecision === "CHANGES_REQUESTED") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        Changes requested
      </div>
    );
  }

  return null;
}
