import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Loader,
  MinusCircle,
  SkipForward,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Wrench,
  ExternalLink,
} from "lucide-react";
import type { CheckRun, WorkflowRunLog } from "../../types";
import { getWorkflowLog, rerunFailedChecks } from "../../api";

interface CheckRunItemProps {
  run: CheckRun;
  repoPath: string;
  onAskClaudeFix?: (logs: WorkflowRunLog[]) => void;
}

function statusIcon(run: CheckRun) {
  if (run.status !== "completed") {
    return <Loader className="h-3.5 w-3.5 text-status-busy animate-spin" />;
  }
  switch (run.conclusion) {
    case "success":
      return <CheckCircle className="h-3.5 w-3.5 text-diff-added" />;
    case "failure":
    case "timed_out":
      return <XCircle className="h-3.5 w-3.5 text-status-error" />;
    case "cancelled":
      return <MinusCircle className="h-3.5 w-3.5 text-text-tertiary" />;
    case "skipped":
      return <SkipForward className="h-3.5 w-3.5 text-text-tertiary" />;
    default:
      return <MinusCircle className="h-3.5 w-3.5 text-text-tertiary" />;
  }
}

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

const isFailed = (run: CheckRun) =>
  run.conclusion === "failure" || run.conclusion === "timed_out";

function CheckRunItem({ run, repoPath, onAskClaudeFix }: CheckRunItemProps) {
  const failed = isFailed(run);
  const [expanded, setExpanded] = useState(failed);
  const [logs, setLogs] = useState<WorkflowRunLog[] | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const duration = formatDuration(run.startedAt, run.completedAt);

  const handleExpand = async () => {
    const willExpand = !expanded;
    setExpanded(willExpand);

    if (willExpand && !logs && run.checkSuiteId && failed) {
      setLoadingLogs(true);
      try {
        const result = await getWorkflowLog(repoPath, run.checkSuiteId);
        setLogs(result);
      } catch (err) {
        console.error("Failed to fetch logs:", err);
        setLogs([]);
      } finally {
        setLoadingLogs(false);
      }
    }
  };

  const handleRerun = async () => {
    if (!run.checkSuiteId) return;
    setRerunning(true);
    try {
      await rerunFailedChecks(repoPath, run.checkSuiteId);
    } catch (err) {
      console.error("Failed to re-run:", err);
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        {failed ? (
          <button
            type="button"
            onClick={handleExpand}
            className="flex items-center gap-1 text-text-tertiary hover:text-text-secondary"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {statusIcon(run)}
          </button>
        ) : (
          <span className="ml-4">{statusIcon(run)}</span>
        )}

        <a
          href={run.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-text-secondary hover:text-text-primary truncate flex-1"
        >
          {run.name}
        </a>

        {duration && (
          <span className="text-2xs text-text-tertiary flex-shrink-0">
            {duration}
          </span>
        )}

        <a
          href={run.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-tertiary hover:text-text-secondary"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {expanded && failed && (
        <div className="ml-8 mt-2">
          {loadingLogs && (
            <div className="text-xs text-text-tertiary flex items-center gap-1">
              <Loader className="h-3 w-3 animate-spin" /> Loading logs...
            </div>
          )}

          {logs && logs.length > 0 && (
            <div className="bg-bg-surface border border-border-subtle rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto p-2 mb-2">
              {logs.map((log, i) => (
                <div key={i}>
                  <div className="text-text-tertiary mb-1">
                    {log.jobName} / {log.stepName}
                  </div>
                  <pre className="text-status-error whitespace-pre-wrap break-words">
                    {log.logExcerpt}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {logs && logs.length === 0 && (
            <div className="text-xs text-text-tertiary mb-2">
              No failure details found in logs
            </div>
          )}

          <div className="flex items-center gap-3">
            {run.checkSuiteId && (
              <button
                type="button"
                onClick={handleRerun}
                disabled={rerunning}
                className="flex items-center gap-1 text-xs text-accent-primary hover:text-accent-hover disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                {rerunning ? "Re-running..." : "Re-run"}
              </button>
            )}
            {onAskClaudeFix && logs && logs.length > 0 && (
              <button
                type="button"
                onClick={() => onAskClaudeFix(logs)}
                className="flex items-center gap-1 text-xs text-status-busy hover:text-yellow-300"
              >
                <Wrench className="h-3 w-3" />
                Ask Claude to fix
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { CheckRunItem };
