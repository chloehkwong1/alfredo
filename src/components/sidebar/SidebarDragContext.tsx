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
import { setWorktreeColumn } from "../../api";
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

function SidebarDragContext({ children, collapsedColumns, onExpandColumn }: SidebarDragContextProps) {
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
      if (!over) return;

      const activeWtId = active.id as string;
      const overId = over.id as string;

      const currentWorktrees = useWorkspaceStore.getState().worktrees;
      const activeColumn = findColumnForId(activeWtId, currentWorktrees);
      const overColumn = findColumnForId(overId, currentWorktrees);

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

      // Expand target section if collapsed
      if (collapsedColumns?.includes(overColumn)) {
        onExpandColumn?.(overColumn);
      }
    },
    [reorderWorktrees, collapsedColumns, onExpandColumn],
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
        return;
      }

      const activeWtId = active.id as string;
      const overId = over.id as string;
      const currentWorktrees = useWorkspaceStore.getState().worktrees;

      // Same-column reorder
      const activeColumn = findColumnForId(activeWtId, currentWorktrees);
      const overColumn = findColumnForId(overId, currentWorktrees);

      if (activeColumn && overColumn && activeColumn === overColumn && activeWtId !== overId && !COLUMN_SET.has(overId)) {
        const activeIdx = currentWorktrees.findIndex((wt) => wt.id === activeWtId);
        const overIdx = currentWorktrees.findIndex((wt) => wt.id === overId);
        if (activeIdx !== -1 && overIdx !== -1 && activeIdx !== overIdx) {
          reorderWorktrees(arrayMove(currentWorktrees, activeIdx, overIdx));
        }
      }

      // Persist column change if column changed from original
      const worktree = currentWorktrees.find((wt) => wt.id === activeWtId);
      if (worktree && originColumnRef.current && worktree.column !== originColumnRef.current) {
        const stateKey = worktree.prStatus?.merged
          ? "merged"
          : worktree.prStatus?.draft
            ? "draft"
            : "open";
        usePrStore.getState().setManualColumn(activeWtId, worktree.column, stateKey);

        // Persist to Tauri backend (fire-and-forget)
        setWorktreeColumn(worktree.repoPath, worktree.name, worktree.column).catch(() => {
          // Tauri backend not available during development — ignore silently
        });
      }

      snapshotRef.current = null;
      originColumnRef.current = null;
    },
    [reorderWorktrees],
  );

  const handleDragCancel = useCallback(() => {
    setActiveId(null);
    lastOverIdRef.current = null;
    if (snapshotRef.current) {
      reorderWorktrees(snapshotRef.current);
    }
    snapshotRef.current = null;
    originColumnRef.current = null;
  }, [reorderWorktrees]);

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
            <AgentItemOverlay worktree={activeWorktree} width={dragSize?.width} />
          ) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

export { SidebarDragContext };
