import { AnimatePresence, motion } from "framer-motion";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
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
  pinnedWorktrees?: Set<string>;
  hideUnpinned?: boolean;
  onSelectWorktree: (id: string) => void;
  onDeleteWorktree?: (id: string) => void;
  onArchiveWorktree?: (id: string) => void;
  onArchiveAll?: () => void;
  forceVisible?: boolean;
  dragActiveId?: string | null;
  repoColors?: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  repoShortLabels?: Record<string, string>;
  worktreeLabels?: Record<string, string>;
  onSetWorktreeLabel?: (worktreePath: string, label: string | null) => void;
  showRepoTags?: boolean;
  repoIndexMap?: Record<string, number>;
  isCollapsed?: boolean;
  onToggleCollapsed?: (column: KanbanColumn) => void;
  /** Drag-driven override: render expanded even when persistently collapsed. */
  isTempExpanded?: boolean;
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

const COLUMN_ORDER: KanbanColumn[] = [
  "toDo",
  "inProgress",
  "blocked",
  "draftPr",
  "openPr",
  "needsReview",
  "done",
];

export { columnIcon, columnLabel, COLUMN_ORDER };

function StatusGroup({
  column,
  worktrees,
  activeWorktreeId,
  pinnedWorktrees,
  hideUnpinned,
  onSelectWorktree,
  onDeleteWorktree,
  onArchiveWorktree,
  onArchiveAll,
  forceVisible,
  dragActiveId,
  repoColors,
  repoDisplayNames,
  repoShortLabels,
  worktreeLabels,
  onSetWorktreeLabel,
  showRepoTags,
  repoIndexMap,
  isCollapsed,
  onToggleCollapsed,
  isTempExpanded,
}: StatusGroupProps) {
  const persistedCollapsed = isCollapsed ?? false;
  const tempExpanded = isTempExpanded ?? false;
  const collapsed = persistedCollapsed && !tempExpanded;
  const { isOver, setNodeRef } = useDroppable({ id: column });

  const pinned = pinnedWorktrees ?? new Set<string>();
  const visibleWorktrees = hideUnpinned
    ? worktrees.filter((wt) => pinned.has(wt.id))
    : worktrees;

  const isVisible =
    visibleWorktrees.length > 0
    || (column === "inProgress" && !hideUnpinned)
    || forceVisible === true;

  if (!isVisible) return null;

  const Icon = columnIcon[column];
  const label = columnLabel[column];

  const draggedItemIsInThisGroup = dragActiveId != null && worktrees.some((wt) => wt.id === dragActiveId);
  const showCollapsedDropHint = collapsed && isOver && !draggedItemIsInThisGroup && dragActiveId != null;
  const showDropZoneHighlight = !collapsed && isOver && !draggedItemIsInThisGroup && dragActiveId != null;

  return (
    <div
      ref={setNodeRef}
      className={[
        "w-full mt-2 first:mt-0 rounded-md transition-colors",
        showCollapsedDropHint ? "bg-accent-muted/30 ring-1 ring-accent-primary/30" : "",
        "",
      ].join(" ")}
    >
      {/* Group header */}
      <div className="group/grp flex w-full items-center px-3.5 pt-3 pb-2 select-none">
        <button
          type="button"
          onClick={() => onToggleCollapsed?.(column)}
          className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary transition-colors"
        >
          <Icon className="h-4 w-4" />
          <span className={[
            "text-xs font-bold uppercase tracking-[0.08em] text-text-primary",
            showDropZoneHighlight ? "text-accent-primary" : "",
          ].join(" ")}>
            {label}
          </span>
        </button>
        <span className="flex-1 h-[1.5px] bg-gradient-to-r from-white/20 to-transparent mx-3" />
        {column === "done" && worktrees.length > 0 && onArchiveAll && (
          <button
            type="button"
            onClick={onArchiveAll}
            className="opacity-0 group-hover/grp:opacity-100 transition-opacity text-2xs text-text-tertiary hover:text-text-secondary mr-2 cursor-pointer"
          >
            Archive all
          </button>
        )}
        <button
          type="button"
          onClick={() => onToggleCollapsed?.(column)}
          className="flex items-center gap-2 cursor-pointer text-text-secondary hover:text-text-primary transition-colors"
        >
          <span className="text-2xs text-text-secondary tabular-nums font-semibold bg-bg-elevated rounded-full px-1.5 py-0.5">
            {hideUnpinned && visibleWorktrees.length !== worktrees.length
              ? `${visibleWorktrees.length} / ${worktrees.length}`
              : worktrees.length}
          </span>
          <ChevronRight
            className={[
              "h-3.5 w-3.5 transition-transform duration-150",
              collapsed ? "rotate-0" : "rotate-90",
            ].join(" ")}
          />
        </button>
      </div>

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
            {(() => {
              const pinnedItems = visibleWorktrees.filter((wt) => pinned.has(wt.id));
              const unpinnedItems = visibleWorktrees.filter((wt) => !pinned.has(wt.id));
              const sorted = [...pinnedItems, ...unpinnedItems];
              return (
            <SortableContext items={sorted.map((wt) => wt.id)} strategy={verticalListSortingStrategy}>
                {sorted.map((wt) => (
                  <div key={wt.id}>
                    <AgentItem
                      worktree={wt}
                      isSelected={wt.id === activeWorktreeId}
                      isPinned={pinned.has(wt.id)}
                      isDimmed={pinnedItems.length > 0 && !pinned.has(wt.id)}
                      onClick={() => onSelectWorktree(wt.id)}
                      onDelete={onDeleteWorktree}
                      onArchive={onArchiveWorktree}
                      repoPath={wt.repoPath}
                      repoColors={repoColors}
                      repoDisplayNames={repoDisplayNames}
                      repoShortLabels={repoShortLabels}
                      label={worktreeLabels?.[wt.path]}
                      onRename={onSetWorktreeLabel}
                      repoIndex={repoIndexMap?.[wt.repoPath ?? ""] ?? 0}
                      showRepoTag={showRepoTags ?? false}
                    />
                  </div>
                ))}
            </SortableContext>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export { StatusGroup };
export type { StatusGroupProps };
