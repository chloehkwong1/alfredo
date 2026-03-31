import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDroppable } from "@dnd-kit/core";
import {
  CircleDot,
  Circle,
  OctagonX,
  GitPullRequestDraft,
  GitPullRequest,
  Eye,
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
  dragActiveId?: string | null;
  dragHeight?: number | null;
  repoColors?: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  showRepoTags?: boolean;
  repoIndexMap?: Record<string, number>;
  isCollapsed?: boolean;
  onToggleCollapsed?: (column: KanbanColumn) => void;
}

const columnIcon: Record<KanbanColumn, LucideIcon> = {
  toDo: CircleDot,
  inProgress: Circle,
  blocked: OctagonX,
  draftPr: GitPullRequestDraft,
  openPr: GitPullRequest,
  needsReview: Eye,
  done: CheckCircle2,
};

const columnLabel: Record<KanbanColumn, string> = {
  toDo: "To do",
  inProgress: "In progress",
  blocked: "Blocked",
  draftPr: "Draft PR",
  openPr: "In review",
  needsReview: "Needs review",
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
  dragActiveId,
  dragHeight,
  repoColors,
  repoDisplayNames,
  showRepoTags,
  repoIndexMap,
  isCollapsed,
  onToggleCollapsed,
}: StatusGroupProps) {
  const collapsed = isCollapsed ?? false;
  const { isOver, setNodeRef } = useDroppable({ id: column });
  const expandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-expand collapsed section after 500ms hover during drag
  useEffect(() => {
    if (collapsed && isOver && dragActiveId != null) {
      expandTimerRef.current = setTimeout(() => {
        onToggleCollapsed?.(column);
      }, 500);
    }
    return () => {
      if (expandTimerRef.current) {
        clearTimeout(expandTimerRef.current);
        expandTimerRef.current = null;
      }
    };
  }, [collapsed, isOver, dragActiveId, column, onToggleCollapsed]);

  const isVisible =
    worktrees.length > 0 || column === "inProgress" || forceVisible === true;

  if (!isVisible) return null;

  const Icon = columnIcon[column];
  const label = columnLabel[column];

  // Show a drop placeholder when dragging over this group from a different group
  const draggedItemIsInThisGroup = dragActiveId != null && worktrees.some((wt) => wt.id === dragActiveId);
  const showDropPlaceholder = isOver && !draggedItemIsInThisGroup && dragActiveId != null;
  const showCollapsedDropHint = collapsed && isOver && !draggedItemIsInThisGroup && dragActiveId != null;

  return (
    <div
      ref={setNodeRef}
      className={[
        "w-full mt-2 first:mt-0 rounded-md transition-colors",
        showCollapsedDropHint ? "bg-accent-muted/30 ring-1 ring-accent-primary/30" : "",
      ].join(" ")}
    >
      {/* Group header */}
      <button
        onClick={() => onToggleCollapsed?.(column)}
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
              collapsed ? "rotate-0" : "rotate-90",
            ].join(" ")}
          />
        </span>
      </button>

      {/* Agent items */}
      <AnimatePresence initial={false}>
        {!collapsed && (
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
