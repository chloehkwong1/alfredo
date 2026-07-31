import { type ReactNode, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  closestCenter,
  type CollisionDetection,
  type DroppableContainer,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import type { KanbanColumn, Worktree } from "../../types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePrStore } from "../../stores/prStore";
import { setWorktreeColumn, setWorktreeOrders } from "../../api";
import { stopServerAndReleasePort } from "../../services/portReclaim";
import { sortColumnWorktrees, columnNameOrder, type WorktreeOrderMap } from "../../lib/worktreeOrder";
import { AgentItemOverlay } from "./AgentItemOverlay";

const COLUMNS: KanbanColumn[] = [
  "toDo",
  "inProgress",
  "blocked",
  "draftPr",
  "openPr",
  "needsReview",
  "done",
];

const COLUMN_SET = new Set<string>(COLUMNS);

interface SidebarDragContextProps {
  children: (isDragging: boolean, activeId: string | null) => ReactNode;
  collapsedColumns?: string[];
  onExpandColumn?: (column: KanbanColumn) => void;
  onSetTempExpanded?: (column: KanbanColumn, expanded: boolean) => void;
  /** Clear all temp-expanded sections except (optionally) one to keep —
   *  used at drag-end so the persisted-expand on the drop column doesn't
   *  flicker between drag-end and the async config write landing. */
  onClearTempExpanded?: (except?: KanbanColumn) => void;
  worktreeLabels?: Record<string, string>;
  /** Mirrors Sidebar's pinned-only filter so drag indices are computed on the
   *  list the user actually sees (StatusGroup hides unpinned cards when set). */
  hideUnpinned?: boolean;
}

/** Find which column an id belongs to. If the id IS a column, return it. Otherwise find the worktree's column. */
function findColumnForId(id: string, worktrees: Worktree[]): KanbanColumn | null {
  if (COLUMN_SET.has(id)) return id as KanbanColumn;
  const wt = worktrees.find((w) => w.id === id);
  return wt?.column ?? null;
}

const measuring = {
  droppable: { strategy: MeasuringStrategy.Always as const },
};

/** The cards of one column exactly as StatusGroup renders them: Sidebar's
 *  column grouping (unknown columns route to inProgress) → comparator sort →
 *  pinned-only filter → pinned-first hoist (stable within each half). Drag
 *  from/to indices must be computed on this list, not the raw store array. */
function renderedColumnCards(
  worktrees: Worktree[],
  column: KanbanColumn,
  orderByRepo: WorktreeOrderMap,
  pinned: Set<string>,
  hideUnpinned: boolean,
): Worktree[] {
  const inColumn = worktrees.filter(
    (wt) =>
      !wt.archived &&
      !wt.isBranchMode &&
      (COLUMN_SET.has(wt.column) ? wt.column : "inProgress") === column,
  );
  const sorted = sortColumnWorktrees(inColumn, column, orderByRepo);
  const visible = hideUnpinned ? sorted.filter((wt) => pinned.has(wt.id)) : sorted;
  return [
    ...visible.filter((wt) => pinned.has(wt.id)),
    ...visible.filter((wt) => !pinned.has(wt.id)),
  ];
}

function SidebarDragContext({
  children,
  collapsedColumns,
  onExpandColumn,
  onSetTempExpanded,
  onClearTempExpanded,
  worktreeLabels,
  hideUnpinned = false,
}: SidebarDragContextProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const reorderWorktrees = useWorkspaceStore((s) => s.reorderWorktrees);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null);

  // Snapshot for cancel rollback
  const snapshotRef = useRef<Worktree[] | null>(null);
  // Original column at drag start (for persistence on drop)
  const originColumnRef = useRef<KanbanColumn | null>(null);
  // Last overId to reduce flicker
  const lastOverIdRef = useRef<string | null>(null);
  // Last column the pointer was over, for driving temp-expand transitions.
  // dnd-kit's per-droppable `isOver` flickers as collision resolution prefers
  // items inside a column over the column itself; column-level transitions
  // here are stable.
  const prevOverColumnRef = useRef<KanbanColumn | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  /** Custom collision detection: pointerWithin first, then drill into column children via closestCenter. */
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerCollisions = pointerWithin(args);

      // If pointer is within a column droppable, drill down to find the closest item inside it
      if (pointerCollisions.length > 0) {
        const firstHit = pointerCollisions[0];
        if (COLUMN_SET.has(firstHit.id as string)) {
          // Filter droppable containers to only items in this column
          const columnId = firstHit.id as KanbanColumn;
          const columnItems = worktrees
            .filter((wt) => wt.column === columnId)
            .map((wt) => wt.id);
          const columnItemSet = new Set(columnItems);

          const filteredContainers: DroppableContainer[] = [];
          for (const container of args.droppableContainers) {
            if (columnItemSet.has(container.id as string)) {
              filteredContainers.push(container);
            }
          }

          if (filteredContainers.length > 0) {
            const closestItems = closestCenter({
              ...args,
              droppableContainers: filteredContainers,
            });
            if (closestItems.length > 0) {
              lastOverIdRef.current = closestItems[0].id as string;
              return closestItems;
            }
          }

          // Empty column — return the column itself
          lastOverIdRef.current = columnId;
          return pointerCollisions;
        }

        lastOverIdRef.current = firstHit.id as string;
        return pointerCollisions;
      }

      // Fallback: use cached last overId to prevent flicker during layout shifts
      if (lastOverIdRef.current) {
        return [{ id: lastOverIdRef.current, data: { droppableContainer: undefined, value: 0 } }];
      }

      return [];
    },
    [worktrees],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = event.active.id as string;
      setActiveId(id);

      // Snapshot for rollback
      snapshotRef.current = [...worktrees];
      originColumnRef.current = findColumnForId(id, worktrees);

      const el = (event.activatorEvent.target as HTMLElement)?.closest?.("button");
      if (el) {
        const { width, height } = el.getBoundingClientRect();
        setDragSize({ width, height });
      }
    },
    [worktrees],
  );

  const handleDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event;

      const currentWorktrees = useWorkspaceStore.getState().worktrees;
      const newOverCol = over ? findColumnForId(over.id as string, currentWorktrees) : null;

      // Drive temp-expand on column transitions. Reverting `prev` here (instead
      // of inside StatusGroup) sidesteps `isOver` flicker when collision
      // resolution drills into items.
      if (prevOverColumnRef.current !== newOverCol) {
        if (prevOverColumnRef.current) {
          onSetTempExpanded?.(prevOverColumnRef.current, false);
        }
        if (newOverCol && collapsedColumns?.includes(newOverCol)) {
          onSetTempExpanded?.(newOverCol, true);
        }
        prevOverColumnRef.current = newOverCol;
      }

      if (!over) return;

      const activeWtId = active.id as string;
      const overId = over.id as string;

      const activeColumn = findColumnForId(activeWtId, currentWorktrees);
      const overColumn = newOverCol;

      if (!activeColumn || !overColumn) return;
      if (activeColumn === overColumn) return; // same-column reorder handled in onDragEnd

      // Cross-column move: remove from source, insert at correct position in target
      const activeIdx = currentWorktrees.findIndex((wt) => wt.id === activeWtId);
      if (activeIdx === -1) return;

      const updated = [...currentWorktrees];
      const [removed] = updated.splice(activeIdx, 1);
      const item = { ...removed, column: overColumn };

      // Find insertion index among target column items
      if (COLUMN_SET.has(overId)) {
        // Dropped on empty column or column header — append to end of that column's items
        const lastInColumn = updated.reduce(
          (last, wt, idx) => (wt.column === overColumn ? idx : last),
          -1,
        );
        updated.splice(lastInColumn + 1, 0, item);
      } else {
        // Dropped near a specific item — insert at that item's position
        const overIdx = updated.findIndex((wt) => wt.id === overId);
        if (overIdx === -1) {
          updated.push(item);
        } else {
          updated.splice(overIdx, 0, item);
        }
      }

      reorderWorktrees(updated);
    },
    [reorderWorktrees, collapsedColumns, onSetTempExpanded],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      lastOverIdRef.current = null;

      const { active, over } = event;
      if (!over) {
        // No target — cancel
        if (snapshotRef.current) {
          reorderWorktrees(snapshotRef.current);
        }
        snapshotRef.current = null;
        originColumnRef.current = null;
        prevOverColumnRef.current = null;
        onClearTempExpanded?.();
        return;
      }

      const activeWtId = active.id as string;
      const overId = over.id as string;
      const currentWorktrees = useWorkspaceStore.getState().worktrees;

      // Same-column reorder
      const activeColumn = findColumnForId(activeWtId, currentWorktrees);
      const overColumn = findColumnForId(overId, currentWorktrees);

      const isCardOverCard =
        activeColumn != null &&
        overColumn != null &&
        activeColumn === overColumn &&
        activeWtId !== overId &&
        !COLUMN_SET.has(overId);

      if (isCardOverCard) {
        const activeIdx = currentWorktrees.findIndex((wt) => wt.id === activeWtId);
        const overIdx = currentWorktrees.findIndex((wt) => wt.id === overId);
        if (activeIdx !== -1 && overIdx !== -1 && activeIdx !== overIdx) {
          reorderWorktrees(arrayMove(currentWorktrees, activeIdx, overIdx));
        }
      }

      // Persist manual card order (personal config, per repo). The optimistic
      // setColumnOrder is what makes the drop stick — display order is owned
      // by sortColumnWorktrees, so the store array order alone would be
      // clobbered on the next comparator pass. Order must be computed on the
      // RENDERED list (column filter → comparator sort → pinned-only filter →
      // pinned-first hoist), not the store array (discovery order).
      const { worktreeOrder, setColumnOrder, pinnedWorktrees } = useWorkspaceStore.getState();
      const displayCards = (list: Worktree[], column: KanbanColumn) =>
        renderedColumnCards(list, column, worktreeOrder, pinnedWorktrees, hideUnpinned);
      // One backend write per drag, all affected columns in a single payload.
      const persistOrders = (repoPath: string, orders: Partial<Record<KanbanColumn, string[]>>) => {
        for (const [column, names] of Object.entries(orders) as [KanbanColumn, string[]][]) {
          setColumnOrder(repoPath, column, names);
        }
        setWorktreeOrders(repoPath, orders).catch((e) => {
          console.error("[drag] Failed to persist worktree order:", e);
        });
      };

      const worktree = currentWorktrees.find((wt) => wt.id === activeWtId);

      if (worktree && originColumnRef.current && worktree.column !== originColumnRef.current) {
        // Column changed from original — persist the move
        usePrStore.getState().setManualColumn(activeWtId, worktree.column, originColumnRef.current!);

        // Persist to Tauri backend (fire-and-forget)
        setWorktreeColumn(worktree.repoPath, worktree.name, worktree.column).catch((e) => {
          console.error("[drag] Failed to persist column change:", e);
        });

        // Stop the dev server and release its port when dragged to Done.
        if (worktree.column === "done") {
          stopServerAndReleasePort(worktree, "drag");
        }

        // Persist the target column with the card at its drop position, taken
        // straight from dnd-kit: insert before the card whose id is `overId`,
        // or append when dropped on the column container itself. Read fresh
        // state — handleDragOver has already moved the card in the store.
        const latest = useWorkspaceStore.getState().worktrees;
        const targetCol = worktree.column;
        const originCol = originColumnRef.current;
        const others = displayCards(latest, targetCol).filter((wt) => wt.id !== activeWtId);
        const overIdx = COLUMN_SET.has(overId) ? -1 : others.findIndex((wt) => wt.id === overId);
        const insertIdx = overIdx === -1 ? others.length : overIdx;
        others.splice(insertIdx, 0, worktree);

        const orders: Partial<Record<KanbanColumn, string[]>> = {
          [targetCol]: columnNameOrder(others, targetCol, worktree.repoPath),
        };
        // Prune the origin column's list only when one already exists —
        // creating a brand-new origin list from a move-out would silently
        // freeze a column the user never manually ordered.
        if (worktreeOrder[worktree.repoPath]?.[originCol] !== undefined) {
          orders[originCol] = columnNameOrder(
            displayCards(latest, originCol),
            originCol,
            worktree.repoPath,
          );
        }
        persistOrders(worktree.repoPath, orders);
      } else if (isCardOverCard && worktree && activeColumn) {
        // Same-column reorder — apply the move on the rendered list and
        // persist the result.
        const display = displayCards(currentWorktrees, activeColumn);
        const fromIdx = display.findIndex((wt) => wt.id === activeWtId);
        const toIdx = display.findIndex((wt) => wt.id === overId);
        if (fromIdx !== -1 && toIdx !== -1 && fromIdx !== toIdx) {
          persistOrders(worktree.repoPath, {
            [activeColumn]: columnNameOrder(
              arrayMove(display, fromIdx, toIdx),
              activeColumn,
              worktree.repoPath,
            ),
          });
        }
      }

      // If the dragged item ended up in a different, persistently-collapsed
      // column, expand that column permanently so the dropped item stays
      // visible. We skip drag-and-release inside the same column so picking up
      // and putting a card back doesn't leak its column open. Other
      // temp-expanded sections collapse back via onClearTempExpanded; the drop
      // column stays in the temp set until the config write lands (the prune
      // effect in Sidebar removes it then) so it doesn't flicker closed.
      const dropCol = worktree?.column ?? null;
      const persistDropCol =
        dropCol != null
        && dropCol !== originColumnRef.current
        && (collapsedColumns?.includes(dropCol) ?? false);
      if (persistDropCol && dropCol) {
        onExpandColumn?.(dropCol);
      }
      onClearTempExpanded?.(persistDropCol && dropCol ? dropCol : undefined);

      snapshotRef.current = null;
      originColumnRef.current = null;
      prevOverColumnRef.current = null;
    },
    [reorderWorktrees, collapsedColumns, onExpandColumn, onClearTempExpanded, hideUnpinned],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    lastOverIdRef.current = null;
    if (snapshotRef.current) {
      reorderWorktrees(snapshotRef.current);
    }
    snapshotRef.current = null;
    originColumnRef.current = null;
    prevOverColumnRef.current = null;
    onClearTempExpanded?.();
  }, [reorderWorktrees, onClearTempExpanded]);

  const activeWorktree = activeId
    ? worktrees.find((wt) => wt.id === activeId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      measuring={measuring}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {children(activeId !== null, activeId)}
      {createPortal(
        <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
          {activeWorktree ? (
            <AgentItemOverlay
              worktree={activeWorktree}
              width={dragSize?.width}
              label={worktreeLabels?.[activeWorktree.path]}
            />
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

export { SidebarDragContext };
