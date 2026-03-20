import { useState } from "react";
import { Settings, PanelLeftClose, PanelLeft, Plus } from "lucide-react";
import { Logo } from "../Logo";
import { IconButton } from "../ui";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { StatusGroup } from "./StatusGroup";
import { SidebarDragContext } from "./SidebarDragContext";
import { GlobalSettingsDialog } from "../settings/GlobalSettingsDialog";
import { WorkspaceSettingsDialog } from "../settings/WorkspaceSettingsDialog";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import type { KanbanColumn, Worktree } from "../../types";

const COLUMNS: KanbanColumn[] = [
  "inProgress",
  "blocked",
  "draftPr",
  "openPr",
  "done",
];

function groupByColumn(
  worktrees: Worktree[],
): Record<KanbanColumn, Worktree[]> {
  const groups: Record<KanbanColumn, Worktree[]> = {
    inProgress: [],
    blocked: [],
    draftPr: [],
    openPr: [],
    done: [],
  };
  for (const wt of worktrees) {
    const col = groups[wt.column] ? wt.column : "inProgress";
    groups[col].push(wt);
  }
  return groups;
}

function Sidebar() {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const sidebarCollapsed = useWorkspaceStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);

  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [createWorktreeOpen, setCreateWorktreeOpen] = useState(false);

  const grouped = groupByColumn(worktrees);

  if (sidebarCollapsed) {
    return (
      <div className="flex flex-col items-center w-12 bg-bg-secondary border-r border-border-default py-3 gap-3 flex-shrink-0">
        <Logo size={24} />
        <IconButton size="sm" label="Expand sidebar" onClick={toggleSidebar}>
          <PanelLeft />
        </IconButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[260px] bg-bg-secondary border-r border-border-default flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between h-11 px-3 border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-2">
          <Logo size={22} />
          <span className="text-sm font-semibold text-text-primary">
            alfredo
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton size="sm" label="Settings" onClick={() => setGlobalSettingsOpen(true)}>
            <Settings />
          </IconButton>
          <IconButton
            size="sm"
            label="Collapse sidebar"
            onClick={toggleSidebar}
          >
            <PanelLeftClose />
          </IconButton>
        </div>
      </div>

      {/* Scrollable agent list */}
      <div className="flex-1 overflow-y-auto py-2">
        <SidebarDragContext>
          {(isDragging) =>
            COLUMNS.map((col) => (
              <StatusGroup
                key={col}
                column={col}
                worktrees={grouped[col]}
                activeWorktreeId={activeWorktreeId}
                onSelectWorktree={setActiveWorktree}
                forceVisible={isDragging}
              />
            ))
          }
        </SidebarDragContext>
      </div>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-border-default flex-shrink-0 space-y-2">
        <button
          type="button"
          className="w-full flex items-center justify-center gap-2 h-8 rounded-[var(--radius-md)] border border-dashed border-accent-primary text-accent-primary text-sm font-medium hover:bg-accent-muted transition-colors cursor-pointer"
          onClick={() => setCreateWorktreeOpen(true)}
        >
          <Plus className="h-4 w-4" />
          New worktree
        </button>
        <button
          type="button"
          className="w-full text-center text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer"
          onClick={() => setWorkspaceSettingsOpen(true)}
        >
          Workspace settings
        </button>
      </div>

      {/* Dialogs */}
      <GlobalSettingsDialog
        open={globalSettingsOpen}
        onOpenChange={setGlobalSettingsOpen}
      />
      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        onOpenChange={setWorkspaceSettingsOpen}
      />
      <CreateWorktreeDialog
        open={createWorktreeOpen}
        onOpenChange={setCreateWorktreeOpen}
      />
    </div>
  );
}

export { Sidebar };
