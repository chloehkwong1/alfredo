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
  onToggleRemoteControl?: (worktreeId: string) => void;
  forceVisible?: boolean;
  dragActiveId?: string | null;
  dragHeight?: number | null;
  repoColors?: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
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
  onToggleRemoteControl,
  forceVisible,
  dragActiveId,
  dragHeight,
  repoColors,
  repoDisplayNames,
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

  // Show a drop placeholder when dragging over this group from a different group
  const draggedItemIsInThisGroup = dragActiveId != null && worktrees.some((wt) => wt.id === dragActiveId);
  const showDropPlaceholder = isOver && !draggedItemIsInThisGroup && dragActiveId != null;

  return (
    <div
      ref={setNodeRef}
      className="w-full mt-2 first:mt-0 rounded-md transition-colors"
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
          <Icon className="h-4 w-4" />
          <span className="text-xs font-semibold uppercase tracking-[0.08em]">
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
                onToggleRemoteControl={onToggleRemoteControl}
                repoPath={wt.repoPath}
                repoColors={repoColors}
                repoDisplayNames={repoDisplayNames}
                repoIndex={repoIndexMap?.[wt.repoPath ?? ""] ?? 0}
                showRepoTag={showRepoTags ?? false}
              />
            ))}
            {showDropPlaceholder && (
              <div
                className="mx-3 my-1 rounded-md border border-dashed border-accent-primary/40 bg-accent-muted/30 transition-all"
                style={dragHeight ? { height: dragHeight } : { height: 40 }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { StatusGroup };
export type { StatusGroupProps };
