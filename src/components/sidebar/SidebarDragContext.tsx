import { type ReactNode, useCallback, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { KanbanColumn } from "../../types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { setWorktreeColumn } from "../../api";

interface SidebarDragContextProps {
  children: (isDragging: boolean) => ReactNode;
}

function SidebarDragContext({ children }: SidebarDragContextProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const setManualColumn = useWorkspaceStore((s) => s.setManualColumn);
  const [isDragging, setIsDragging] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setIsDragging(false);

      const { active, over } = event;
      if (!over) return;

      const worktreeId = active.id as string;
      const targetColumn = over.id as KanbanColumn;

      const worktree = worktrees.find((wt) => wt.id === worktreeId);
      if (!worktree || worktree.column === targetColumn) return;

      setManualColumn(worktreeId, targetColumn);

      // Persist column override via Tauri command (fire-and-forget)
      setWorktreeColumn(".", worktree.name, targetColumn).catch(() => {
        // Tauri backend not available during development — ignore silently
      });
    },
    [worktrees, setManualColumn],
  );

  return (
    <DndContext
      sensors={sensors}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setIsDragging(false)}
    >
      {children(isDragging)}
    </DndContext>
  );
}

export { SidebarDragContext };
