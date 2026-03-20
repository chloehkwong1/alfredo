import { useCallback, useState } from "react";
import { DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { Plus, Settings, GitBranch } from "lucide-react";
import type { KanbanColumn as KanbanColumnType } from "../../types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { setWorktreeColumn } from "../../api";
import { Logo } from "../Logo";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { KanbanColumn } from "./KanbanColumn";
import { CreateWorktreeDialog } from "./CreateWorktreeDialog";
import { SettingsDialog } from "../settings/SettingsDialog";

const COLUMNS: { id: KanbanColumnType; title: string; accentColor: string }[] = [
  { id: "inProgress", title: "In Progress", accentColor: "var(--status-busy)" },
  { id: "blocked", title: "Blocked", accentColor: "var(--status-error)" },
  { id: "draftPr", title: "Draft PR", accentColor: "var(--status-waiting)" },
  { id: "openPr", title: "Open PR", accentColor: "var(--status-idle)" },
  { id: "done", title: "Done", accentColor: "var(--text-tertiary)" },
];

function KanbanBoard() {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const setManualColumn = useWorkspaceStore((s) => s.setManualColumn);
  const branchMode = useWorkspaceStore((s) => s.branchMode);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const worktreeId = active.id as string;
      const targetColumn = over.id as KanbanColumnType;

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border-default">
        <div className="flex items-center gap-3">
          <Logo size={28} className="text-accent-primary" />
          <h1 className="text-base font-semibold text-text-primary">Alfredo</h1>
          {branchMode && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bg-hover/50 text-xs font-medium text-accent-primary">
              <GitBranch className="h-3 w-3" />
              Branch Mode
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            size="sm"
            label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <Settings />
          </IconButton>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {branchMode ? "New Branch" : "New Worktree"}
          </Button>
        </div>
      </header>

      {/* Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-5 p-6 h-full min-w-min">
            {COLUMNS.map((col) => (
              <KanbanColumn
                key={col.id}
                id={col.id}
                title={col.title}
                accentColor={col.accentColor}
                worktrees={worktrees.filter((wt) => wt.column === col.id)}
              />
            ))}
          </div>
        </DndContext>
      </div>

      <CreateWorktreeDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}

export { KanbanBoard };
