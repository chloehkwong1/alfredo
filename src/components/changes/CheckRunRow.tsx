import type React from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CheckRun } from "../../types";
import { formatDuration } from "./formatRelativeTime";
import { IconButton } from "../ui/IconButton";

export function sortCheckRuns(checkRuns: CheckRun[]): CheckRun[] {
  return [...checkRuns].sort((a, b) => {
    const priority = (r: CheckRun) => {
      if (r.status === "completed" && r.conclusion === "failure") return 0;
      if (r.status !== "completed") return 1;
      return 2;
    };
    return priority(a) - priority(b);
  });
}

export function CheckRunSummary({ checkRuns }: { checkRuns: CheckRun[] }) {
  const passed = checkRuns.filter((r) => r.status === "completed" && r.conclusion === "success").length;
  const failing = checkRuns.filter((r) => r.status === "completed" && r.conclusion === "failure").length;
  const pending = checkRuns.filter((r) => r.status !== "completed").length;

  const parts: React.ReactNode[] = [];
  if (passed > 0) parts.push(<span key="passed" className="text-diff-added">{passed} passed</span>);
  if (failing > 0) parts.push(<span key="failing" className="text-diff-removed">{failing} failing</span>);
  if (pending > 0) parts.push(<span key="pending" className="text-status-busy">{pending} pending</span>);

  if (parts.length === 0) return null;

  return (
    <span className="text-[10px] ml-auto">
      {parts.reduce<React.ReactNode[]>((acc, part, i) => {
        if (i > 0) acc.push(<span key={`sep-${i}`} className="text-text-tertiary"> &middot; </span>);
        acc.push(part);
        return acc;
      }, [])}
    </span>
  );
}

export function CheckRunRow({ run }: { run: CheckRun }) {
  const isCompleted = run.status === "completed";
  const isSuccess = run.conclusion === "success" || run.conclusion === "skipped";
  const isFailed = isCompleted && !isSuccess && run.conclusion !== null;
  const isPending = !isCompleted;

  const dotColorClass = isFailed
    ? "text-diff-removed"
    : isPending
      ? "text-status-busy"
      : "text-diff-added";

  const bgColorClass = isFailed
    ? "bg-diff-removed"
    : isPending
      ? "bg-status-busy"
      : "bg-diff-added";

  const duration =
    run.startedAt && run.completedAt
      ? formatDuration(
          new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime(),
        )
      : null;

  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs">
      {isPending ? (
        <RefreshCw
          size={10}
          className={`${dotColorClass} shrink-0 animate-spin`}
        />
      ) : (
        <span
          className={`w-2 h-2 rounded-full ${bgColorClass} shrink-0 inline-block`}
        />
      )}
      <span
        className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-text-primary"
        title={run.name}
      >
        {run.name}
      </span>
      {duration && (
        <span className="text-text-tertiary shrink-0">
          {duration}
        </span>
      )}
      {isFailed && run.htmlUrl && (
        <IconButton
          size="sm"
          label="View logs"
          className="h-auto w-auto p-0 text-diff-removed hover:text-diff-removed/80 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            openUrl(run.htmlUrl!);
          }}
        >
          <ExternalLink size={11} />
        </IconButton>
      )}
    </div>
  );
}
