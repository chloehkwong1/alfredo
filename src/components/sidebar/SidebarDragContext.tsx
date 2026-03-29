import { type ReactNode, useCallback, useState } from "react";
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { KanbanColumn } from "../../types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePrStore } from "../../stores/prStore";
import { setWorktreeColumn } from "../../api";
import { AgentItemOverlay } from "./AgentItemOverlay";

interface SidebarDragContextProps {
  children: (isDragging: boolean, activeId: string | null, dragHeight: number | null) => ReactNode;
}

function SidebarDragContext({ children }: SidebarDragContextProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const setManualColumn = useWorkspaceStore((s) => s.setManualColumn);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    const el = (event.activatorEvent.target as HTMLElement)?.closest?.("button");
    if (el) {
      const { width, height } = el.getBoundingClientRect();
      setDragSize({ width, height });
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);

      const { active, over } = event;
      if (!over) return;

      const worktreeId = active.id as string;
      const targetColumn = over.id as KanbanColumn;

      const worktree = worktrees.find((wt) => wt.id === worktreeId);
      if (!worktree || worktree.column === targetColumn) return;

      usePrStore.getState().setManualColumn(worktreeId, targetColumn);
      setManualColumn(worktreeId, targetColumn);

      // Persist column override via Tauri command (fire-and-forget)
      setWorktreeColumn(worktree.repoPath, worktree.name, targetColumn).catch(() => {
        // Tauri backend not available during development — ignore silently
      });
    },
    [worktrees, setManualColumn],
  );

  const activeWorktree = activeId
    ? worktrees.find((wt) => wt.id === activeId)
    : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      {children(activeId !== null, activeId, dragSize?.height ?? null)}
      <DragOverlay dropAnimation={null}>
        {activeWorktree ? (
          <AgentItemOverlay worktree={activeWorktree} width={dragSize?.width} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export { SidebarDragContext };
