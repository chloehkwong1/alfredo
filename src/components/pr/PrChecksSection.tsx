import { CollapsibleSection } from "./CollapsibleSection";
import { CheckRunItem } from "./CheckRunItem";
import { Wrench } from "lucide-react";
import type { CheckRun, WorkflowRunLog } from "../../types";

interface PrChecksSectionProps {
  checkRuns: CheckRun[];
  repoPath: string;
  onAskClaudeFix: (logs: WorkflowRunLog[]) => void;
}

function PrChecksSection({ checkRuns, repoPath, onAskClaudeFix }: PrChecksSectionProps) {
  const successCount = checkRuns.filter((r) => r.conclusion === "success").length;
  const failureCount = checkRuns.filter(
    (r) => r.conclusion === "failure" || r.conclusion === "timed_out",
  ).length;
  const pendingCount = checkRuns.filter((r) => r.status !== "completed").length;

  const hasFailures = failureCount > 0;

  const badge = checkRuns.length > 0 ? (
    <span className="text-2xs text-text-tertiary">
      {successCount} passed
      {failureCount > 0 && <span className="text-status-error">, {failureCount} failed</span>}
      {pendingCount > 0 && `, ${pendingCount} pending`}
    </span>
  ) : null;

  return (
    <CollapsibleSection title="Checks" badge={badge} defaultOpen={hasFailures}>
      {checkRuns.length === 0 ? (
        <div className="text-sm text-text-tertiary py-2">No checks found</div>
      ) : (
        <>
          {checkRuns.map((run) => (
            <CheckRunItem
              key={run.id}
              run={run}
              repoPath={repoPath}
              onAskClaudeFix={onAskClaudeFix}
            />
          ))}
          {hasFailures && (
            <button
              type="button"
              onClick={() => onAskClaudeFix([])}
              className="flex items-center gap-1 text-xs text-status-busy hover:text-yellow-300 mt-2"
            >
              <Wrench className="h-3 w-3" />
              Ask Claude to fix all failures
            </button>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}

export { PrChecksSection };
