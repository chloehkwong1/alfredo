import { Workflow } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useAppConfigValue } from "../../stores/appConfigStore";
import { chipStyle, chipTintClassName } from "./StackGlyph";
import { markLine, noPlanHint, orchestrationOf, type OrchestrationMark } from "../../services/orchestrations";

/** Runs only while the tooltip is open: orchestrationOf builds new objects on every call. */
function OrchestrationTooltipContent({ worktreeId }: { worktreeId: string }) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const rules = useWorkspaceStore((s) => s.orchestrationRules);
  const labels = useAppConfigValue((s) => s.config?.worktreeLabels);
  const orchestration = orchestrationOf(worktreeId, worktrees, rules, labels ?? {});
  const worktree = worktrees.find((wt) => wt.id === worktreeId);
  if (!orchestration || !worktree) return null;
  const hint = noPlanHint(orchestration);
  return (
    <div className="max-w-[200px] font-normal">
      <div className="text-xs font-semibold text-text-primary">{orchestration.name}</div>
      <div className="mt-2 text-[11px] text-text-secondary">{markLine(orchestration, worktree)}</div>
      {hint && (
        <div className="mt-2 pt-2 border-t border-border-default text-[11px] leading-[1.45] text-text-tertiary">
          {hint}
        </div>
      )}
    </div>
  );
}

/** The mark after a member row's name, or the `orchestrator` tag on the
 *  orchestrator's row. Not interactive: no handlers, so a press on it still
 *  drags and selects the row. */
function OrchestrationChip({ worktreeId, mark }: { worktreeId: string; mark: OrchestrationMark }) {
  return (
    <Tooltip side="right" content={<OrchestrationTooltipContent worktreeId={worktreeId} />}>
      <span
        className={[
          "flex-shrink-0 inline-flex items-center justify-center rounded-[3px] cursor-default transition-colors",
          mark.orchestrator ? "px-1.5 py-px text-[10px]" : "w-[18px] h-4",
          chipTintClassName(mark.hue),
        ].join(" ")}
        style={chipStyle(mark.hue)}
      >
        {mark.orchestrator ? "orchestrator" : <Workflow size={11} aria-hidden="true" />}
      </span>
    </Tooltip>
  );
}

export { OrchestrationChip };
