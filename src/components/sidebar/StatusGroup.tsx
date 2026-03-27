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
  onDeleteWorktree?: (id: string) => void;
  onArchiveWorktree?: (id: string) => void;
  forceVisible?: boolean;
  repoColors?: Record<string, string>;
  showRepoTags?: boolean;
  repoIndexMap?: Record<string, number>;
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
  onDeleteWorktree,
  onArchiveWorktree,
  forceVisible,
  repoColors,
  showRepoTags,
  repoIndexMap,
}: StatusGroupProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { isOver, setNodeRef } = useDroppable({ id: column });

  const isVisible =
    worktrees.length > 0 || column === "inProgress" || forceVisible === true;

  if (!isVisible) return null;

  const Icon = columnIcon[column];
  const label = columnLabel[column];

  return (
    <div
      ref={setNodeRef}
      className={[
        "w-full mt-2 first:mt-0 rounded-md transition-colors",
        isOver ? "bg-accent-muted ring-1 ring-accent-primary" : "",
      ].join(" ")}
    >
      {/* Group header */}
      <button
        onClick={() => setIsCollapsed((prev) => !prev)}
        className={[
          "flex w-full items-center px-3.5 pt-3 pb-2",
          "cursor-pointer select-none",
          "text-text-tertiary hover:text-text-secondary transition-colors",
        ].join(" ")}
      >
        <span className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">
            {label}
          </span>
        </span>
        <span className="flex-1 h-px bg-gradient-to-r from-border-subtle to-transparent mx-3" />
        <span className="flex items-center gap-2">
          <span className="text-2xs text-text-tertiary tabular-nums">
            {worktrees.length}
          </span>
          <ChevronRight
            className={[
              "h-3.5 w-3.5 transition-transform duration-150",
              isCollapsed ? "rotate-0" : "rotate-90",
            ].join(" ")}
          />
        </span>
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
                onDelete={onDeleteWorktree}
                onArchive={onArchiveWorktree}
                repoPath={wt.repoPath}
                repoColors={repoColors}
                repoIndex={repoIndexMap?.[wt.repoPath ?? ""] ?? 0}
                showRepoTag={showRepoTags ?? false}
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
