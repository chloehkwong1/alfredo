import { Workflow } from "lucide-react";
import { Tooltip } from "../ui/Tooltip";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useAppConfigValue } from "../../stores/appConfigStore";
import { chipStyle, chipTintClassName } from "./StackGlyph";
import {
  markLine,
  noPlanHint,
  orchestrationOf,
  planItemFor,
  planLayout,
  planSquareLook,
  worktreeForPlanItem,
  type Orchestration,
  type OrchestrationMark,
  type PlanSquareLook,
} from "../../services/orchestrations";
import type { PlanItem, Worktree } from "../../types";

const SQUARE = 18;
const PAD = 4;
const COL_GAP = 28;
const ROW_GAP = 14;
// A 10px semibold digit or letter is about 6.5px wide; a key is at most 8 characters.
const squareWidth = (key: string) => Math.max(SQUARE, Math.ceil(key.length * 6.5 + 8));

const SQUARE_PAINT: Record<PlanSquareLook, { stroke: string; fill: string; dashed?: boolean; glow?: boolean }> = {
  merged: { stroke: "var(--status-idle)", fill: "color-mix(in srgb, var(--status-idle) 28%, transparent)" },
  closed: { stroke: "var(--text-tertiary)", fill: "color-mix(in srgb, var(--text-tertiary) 30%, transparent)" },
  todo: { stroke: "var(--text-tertiary)", fill: "none", dashed: true },
  needsYou: { stroke: "var(--status-waiting)", fill: "color-mix(in srgb, var(--status-waiting) 30%, transparent)", glow: true },
  active: { stroke: "var(--status-busy)", fill: "color-mix(in srgb, var(--status-busy) 18%, transparent)" },
};

/** The plan as squares joined by elbow lines. `here` is this row's own plan item. */
function PlanMap({ orchestration, plan, here }: { orchestration: Orchestration; plan: PlanItem[]; here?: PlanItem }) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const seen = useWorkspaceStore((s) => s.seenWorktrees);
  const unread = useWorkspaceStore((s) => s.unreadWorktrees);
  const layout = planLayout(plan);
  const members = orchestration.items
    .map((item) => worktrees.find((wt) => wt.id === item.worktreeId))
    .filter((wt): wt is Worktree => wt !== undefined);
  const w = Math.max(...plan.map((item) => squareWidth(item.key)));
  const colX = (col: number) => PAD + col * (w + COL_GAP);
  const rowY = (row: number) => PAD + row * (SQUARE + ROW_GAP);
  const width = PAD * 2 + layout.cols * w + (layout.cols - 1) * COL_GAP;
  const height = PAD * 2 + SQUARE + (layout.rows - 1) * (SQUARE + ROW_GAP);
  const at = new Map(layout.nodes.map((n) => [n.key, n]));
  const elbows = layout.edges
    .map(({ from, to }) => {
      const a = at.get(from)!;
      const b = at.get(to)!;
      const midX = colX(a.col) + w + COL_GAP / 2;
      return `M${colX(a.col) + w} ${rowY(a.row) + SQUARE / 2} H${midX} V${rowY(b.row) + SQUARE / 2} H${colX(b.col)}`;
    })
    .join(" ");
  return (
    <svg
      className="block mt-2"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      style={{ maxWidth: "100%", height: "auto" }}
      aria-label="Plan of the orchestration"
    >
      <path d={elbows} fill="none" stroke="var(--border-hover)" strokeWidth={1} />
      {layout.nodes.map((node) => {
        const item = plan.find((p) => p.key === node.key)!;
        const look = planSquareLook(item, worktreeForPlanItem(item, members), seen, unread);
        const paint = SQUARE_PAINT[look];
        const isHere = item === here;
        const x = colX(node.col);
        const y = rowY(node.row);
        return (
          <g key={node.key}>
            <rect
              x={x}
              y={y}
              width={w}
              height={SQUARE}
              rx={4}
              fill={paint.fill}
              stroke={isHere ? "var(--text-primary)" : paint.stroke}
              strokeWidth={isHere ? 2 : 1.2}
              strokeDasharray={paint.dashed && !isHere ? "2 2" : undefined}
              style={paint.glow ? { filter: "drop-shadow(0 0 4px var(--status-waiting))" } : undefined}
            />
            <text
              x={x + w / 2}
              y={y + 13}
              textAnchor="middle"
              fontSize={10}
              fontWeight={600}
              fill={look === "todo" ? "var(--text-tertiary)" : "var(--text-primary)"}
            >
              {node.key}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const markColor = (hue: number | null) => (hue != null ? `var(--stack-hue-${hue})` : "var(--accent-primary)");

/** Runs only while the tooltip is open: orchestrationOf builds new objects on every call. */
function OrchestrationTooltipContent({ worktreeId, hue }: { worktreeId: string; hue: number | null }) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const rules = useWorkspaceStore((s) => s.orchestrationRules);
  const labels = useAppConfigValue((s) => s.config?.worktreeLabels);
  const orchestration = orchestrationOf(worktreeId, worktrees, rules, labels ?? {});
  const worktree = worktrees.find((wt) => wt.id === worktreeId);
  if (!orchestration || !worktree) return null;
  const hint = noPlanHint(orchestration);
  return (
    <div className="max-w-[200px] font-normal">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
        <i className="w-1.5 h-1.5 rounded-[2px] flex-shrink-0" style={{ background: markColor(hue) }} />
        {orchestration.name}
      </div>
      {orchestration.plan && (
        <PlanMap orchestration={orchestration} plan={orchestration.plan} here={planItemFor(orchestration, worktree)} />
      )}
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
    <Tooltip side="right" content={<OrchestrationTooltipContent worktreeId={worktreeId} hue={mark.hue} />}>
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
