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
import { AgentItem, travelsWithDrag } from "./AgentItem";

import { useWorkspaceStore } from "../../stores/workspaceStore";
import { worktreeNeedsYou } from "../../services/dockBadge";

interface StatusGroupProps {
  column: KanbanColumn;
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  pinnedWorktrees?: Set<string>;
  hideUnpinned?: boolean;
  onSelectWorktree: (
    id: string,
    e: React.MouseEvent,
    column: KanbanColumn,
    renderedIds: string[],
  ) => void;
  /** The checkbox path — selection only, never opens the worktree. */
  onToggleSelection?: (
    id: string,
    e: React.MouseEvent,
    column: KanbanColumn,
    renderedIds: string[],
  ) => void;
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

/** The rows a column actually shows, in the order it shows them: the
 *  hide-unpinned filter, then pinned rows first. Shared with the Sidebar so
 *  the bulk bar's "Select all" selects exactly what the column renders — the
 *  two must not drift. */
export function visibleColumnOrder(
  worktrees: Worktree[],
  pinned: Set<string>,
  hideUnpinned: boolean | undefined,
): Worktree[] {
  const visible = hideUnpinned ? worktrees.filter((wt) => pinned.has(wt.id)) : worktrees;
  return [...visible.filter((wt) => pinned.has(wt.id)), ...visible.filter((wt) => !pinned.has(wt.id))];
}

function StatusGroup({
  column,
  worktrees,
  activeWorktreeId,
  pinnedWorktrees,
  hideUnpinned,
  onSelectWorktree,
  onToggleSelection,
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
  const seenWorktrees = useWorkspaceStore((s) => s.seenWorktrees);
  const unreadWorktrees = useWorkspaceStore((s) => s.unreadWorktrees);
  const selectedWorktreeIds = useWorkspaceStore((s) => s.selectedWorktreeIds);
  const selectionColumn = useWorkspaceStore((s) => s.selectionColumn);
  const setWorktreeSelection = useWorkspaceStore((s) => s.setWorktreeSelection);

  // Expanded groups surface attention on the cards themselves; collapsed
  // groups hide the cards, so the count pill takes over as the indicator.
  // This column owns the live selection, so every row here inks its checkbox —
  // once you are selecting, each target should look togglable, not just the
  // one under the cursor.
  const selectionActive = selectionColumn === column && selectedWorktreeIds.size > 0;
  const collapsedNeedsYou =
    collapsed
    && worktrees.some((wt) => worktreeNeedsYou(wt, seenWorktrees, unreadWorktrees));

  const pinned = pinnedWorktrees ?? new Set<string>();
  const sorted = visibleColumnOrder(worktrees, pinned, hideUnpinned);
  const visibleWorktrees = sorted;
  const sortedIds = sorted.map((wt) => wt.id);
  const pinnedItems = sorted.filter((wt) => pinned.has(wt.id));


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
        <span className="flex-1 h-[1.5px] bg-gradient-to-r from-group-rule to-transparent mx-3" />

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
          <span
            className={[
              "text-2xs tabular-nums font-semibold rounded-full px-1.5 py-0.5",
              collapsedNeedsYou
                ? "text-accent-primary bg-accent-muted dot-glow-attn"
                : "text-text-secondary bg-bg-elevated",
            ].join(" ")}
          >
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
              return (
            <SortableContext items={sortedIds} strategy={verticalListSortingStrategy}>
                {sorted.map((wt) => (
                  <div key={wt.id} className="px-2 pb-1.5">
                    <AgentItem
                      worktree={wt}
                      isSelected={wt.id === activeWorktreeId}
                      isPinned={pinned.has(wt.id)}
                      isDimmed={pinnedItems.length > 0 && !pinned.has(wt.id)}
                      onClick={(e) => onSelectWorktree(wt.id, e, column, sortedIds)}
                      isMultiSelected={selectedWorktreeIds.has(wt.id)}
                      // Decided here, not in the row: AgentItem would have to
                      // subscribe to dnd-kit's context to learn the active id,
                      // and that re-renders on every pointer move.
                      isTravellingWithDrag={travelsWithDrag(
                        dragActiveId ?? null,
                        wt.id,
                        selectedWorktreeIds,
                      )}
                      selectionActive={selectionActive}
                      onSelectAllInColumn={() => setWorktreeSelection(sortedIds, column)}
                      onToggleSelection={
                        onToggleSelection &&
                        ((e: React.MouseEvent) =>
                          onToggleSelection(wt.id, e, column, sortedIds))
                      }
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
