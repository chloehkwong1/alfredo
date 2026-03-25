import { CheckCircle2, XCircle, Circle, Loader2, MinusCircle, SkipForward } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CheckRun } from "../../types";

interface CheckRunItemProps {
  run: CheckRun;
}

function getCheckIcon(run: CheckRun) {
  if (run.status !== "completed") {
    return <Loader2 size={14} className="text-status-busy animate-spin" />;
  }
  switch (run.conclusion) {
    case "success":
      return <CheckCircle2 size={14} className="text-status-idle" />;
    case "failure":
    case "timed_out":
      return <XCircle size={14} className="text-status-error" />;
    case "cancelled":
      return <MinusCircle size={14} className="text-text-tertiary" />;
    case "skipped":
      return <SkipForward size={14} className="text-text-tertiary" />;
    default:
      return <Circle size={14} className="text-text-tertiary" />;
  }
}

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function CheckRunItem({ run }: CheckRunItemProps) {
  const duration = formatDuration(run.startedAt, run.completedAt);

  return (
    <button
      type="button"
      onClick={() => run.htmlUrl && openUrl(run.htmlUrl)}
      className="w-full flex items-center gap-2.5 px-4 py-2 hover:bg-bg-hover transition-colors cursor-pointer"
    >
      {getCheckIcon(run)}
      <span className="text-body text-text-primary truncate flex-1">{run.name}</span>
      {duration && (
        <span className="text-micro text-text-tertiary flex-shrink-0">{duration}</span>
      )}
    </button>
  );
}

export { CheckRunItem };
