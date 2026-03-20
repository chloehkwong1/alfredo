import { useDroppable } from "@dnd-kit/core";
import { AnimatePresence } from "framer-motion";
import type { KanbanColumn as KanbanColumnType, Worktree } from "../../types";
import { WorktreeCard } from "./WorktreeCard";

interface KanbanColumnProps {
  id: KanbanColumnType;
  title: string;
  accentColor: string;
  worktrees: Worktree[];
}

function KanbanColumn({ id, title, accentColor, worktrees }: KanbanColumnProps) {
  const { isOver, setNodeRef } = useDroppable({ id });

  return (
    <div className="flex flex-col min-w-[280px] w-[280px] flex-shrink-0">
      {/* Column header */}
      <div className="mb-3">
        <div
          className="h-[2px] rounded-full mb-3"
          style={{ backgroundColor: accentColor }}
        />
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
            {title}
          </h3>
          <span className="text-xs text-text-tertiary tabular-nums">
            {worktrees.length}
          </span>
        </div>
      </div>

      {/* Droppable area */}
      <div
        ref={setNodeRef}
        className={[
          "flex flex-col gap-2 flex-1 p-1 rounded-[var(--radius-md)] min-h-[120px]",
          "transition-colors duration-[var(--transition-fast)]",
          isOver ? "bg-accent-muted/30" : "",
        ].join(" ")}
      >
        <AnimatePresence mode="popLayout">
          {worktrees.map((wt) => (
            <WorktreeCard key={wt.id} worktree={wt} />
          ))}
        </AnimatePresence>

        {worktrees.length === 0 && (
          <div className="flex items-center justify-center h-[80px] text-xs text-text-tertiary">
            No worktrees
          </div>
        )}
      </div>
    </div>
  );
}

export { KanbanColumn };
