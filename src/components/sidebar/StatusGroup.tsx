import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { isOver, setNodeRef } = useDroppable({ id: column });

  const isVisible =
    worktrees.length > 0 || column === "inProgress" || forceVisible === true;

  if (!isVisible) return null;

  const Icon = columnIcon[column];
  const label = columnLabel[column];
  const isDone = column === "done";

  return (
    <div
      ref={setNodeRef}
      className={[
        "mb-2 rounded-md transition-colors",
        isOver ? "bg-accent-muted ring-1 ring-accent-primary" : "",
      ].join(" ")}
    >
      {/* Group header */}
      <button
        onClick={() => setIsCollapsed((prev) => !prev)}
        className={[
          "flex w-full items-center gap-2 px-4 py-2",
          "cursor-pointer select-none",
          isDone ? "text-text-tertiary" : "text-text-secondary",
        ].join(" ")}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">
          {label}
        </span>
        <span className="ml-auto text-[10px] text-text-tertiary tabular-nums">
          {worktrees.length}
        </span>
        <ChevronRight
          className={[
            "h-3.5 w-3.5 transition-transform duration-150",
            isCollapsed ? "rotate-0" : "rotate-90",
          ].join(" ")}
        />
      </button>

      {/* Agent items */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            {worktrees.map((wt) => (
              <AgentItem
                key={wt.id}
                worktree={wt}
                isSelected={wt.id === activeWorktreeId}
                onClick={() => onSelectWorktree(wt.id)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { StatusGroup };
export type { StatusGroupProps };
