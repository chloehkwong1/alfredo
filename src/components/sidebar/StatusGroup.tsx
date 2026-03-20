import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  Circle,
  OctagonX,
  GitPullRequestDraft,
  GitPullRequest,
  CheckCircle2,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import type { KanbanColumn, Worktree } from "../../types";
import { AgentItem } from "./AgentItem";

interface StatusGroupProps {
  column: KanbanColumn;
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  onSelectWorktree: (id: string) => void;
  forceVisible?: boolean;
}

const columnIcon: Record<KanbanColumn, LucideIcon> = {
  inProgress: Circle,
  blocked: OctagonX,
  draftPr: GitPullRequestDraft,
  openPr: GitPullRequest,
  done: CheckCircle2,
};

const columnLabel: Record<KanbanColumn, string> = {
  inProgress: "In progress",
  blocked: "Blocked",
  draftPr: "Draft PR",
  openPr: "Open PR",
  done: "Done",
};

function StatusGroup({
  column,
  worktrees,
  activeWorktreeId,
  onSelectWorktree,
  forceVisible,
}: StatusGroupProps) {
  const isVisible =
    worktrees.length > 0 || column === "inProgress" || forceVisible === true;

  const { isOver, setNodeRef } = useDroppable({ id: column });

  if (!isVisible) return null;

  const [isCollapsed, setIsCollapsed] = useState(false);

  const Icon = columnIcon[column];
  const label = columnLabel[column];
  const isDone = column === "done";

  return (
    <div
      ref={setNodeRef}
      className={[
        "mb-1 rounded-md transition-colors",
        isOver ? "bg-accent-muted ring-1 ring-accent-primary" : "",
      ].join(" ")}
    >
      {/* Group header */}
      <button
        onClick={() => setIsCollapsed((prev) => !prev)}
        className={[
          "flex w-full items-center gap-2 px-3 py-1.5",
          "cursor-pointer select-none",
          isDone ? "text-text-tertiary" : "text-text-secondary",
        ].join(" ")}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          {label}
        </span>
        <span className="text-[11px] font-medium">{worktrees.length}</span>
        <ChevronRight
          className={[
            "ml-auto h-3.5 w-3.5 transition-transform duration-150",
            isCollapsed ? "rotate-0" : "rotate-90",
          ].join(" ")}
        />
      </button>

      {/* Agent items */}
      {!isCollapsed &&
        worktrees.map((wt) => (
          <AgentItem
            key={wt.id}
            worktree={wt}
            isSelected={wt.id === activeWorktreeId}
            onClick={() => onSelectWorktree(wt.id)}
          />
        ))}
    </div>
  );
}

export { StatusGroup };
export type { StatusGroupProps };
