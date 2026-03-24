import { useState, useEffect, useMemo } from "react";
import { Settings, PanelLeftClose, PanelLeft, Plus } from "lucide-react";
import { IconButton, Tooltip } from "../ui";
import logoSvg from "../../assets/logo-cat.svg";
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

interface SidebarProps {
  hasRepo?: boolean;
}

function Sidebar({ hasRepo = false }: SidebarProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const sidebarCollapsed = useWorkspaceStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);

  const grouped = groupByColumn(worktrees);

  // Flat list of worktrees in display order (matches COLUMNS order)
  const flatWorktrees = COLUMNS.flatMap((col) => grouped[col]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      )
        return;

      if ((document.activeElement as HTMLElement)?.closest?.('.xterm')) return;

      const currentIndex = flatWorktrees.findIndex(
        (wt) => wt.id === activeWorktreeId,
      );

      if (event.key === "ArrowUp" && !event.metaKey) {
        event.preventDefault();
        if (flatWorktrees.length === 0) return;
        const nextIndex =
          currentIndex <= 0 ? flatWorktrees.length - 1 : currentIndex - 1;
        setActiveWorktree(flatWorktrees[nextIndex].id);
      } else if (event.key === "ArrowDown" && !event.metaKey) {
        event.preventDefault();
        if (flatWorktrees.length === 0) return;
        const nextIndex =
          currentIndex < 0 || currentIndex >= flatWorktrees.length - 1
            ? 0
            : currentIndex + 1;
        setActiveWorktree(flatWorktrees[nextIndex].id);
      } else if (event.metaKey && event.key >= "1" && event.key <= "9") {
        const idx = parseInt(event.key, 10) - 1;
        if (idx < flatWorktrees.length) {
          event.preventDefault();
          setActiveWorktree(flatWorktrees[idx].id);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [flatWorktrees, activeWorktreeId, setActiveWorktree]);

  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [createWorktreeOpen, setCreateWorktreeOpen] = useState(false);

  const MAX_DOTS = 8;

  const statusDotColor: Record<string, string> = useMemo(() => ({
    waitingForInput: "bg-status-waiting",
    busy: "bg-status-busy",
    idle: "bg-status-idle",
    error: "bg-status-error",
    notRunning: "bg-text-tertiary",
  }), []);

  const statusLabel: Record<string, string> = useMemo(() => ({
    waitingForInput: "waiting for input",
    busy: "busy",
    idle: "idle",
    error: "error",
    notRunning: "not running",
  }), []);

  if (sidebarCollapsed) {
    const overflow = flatWorktrees.length - MAX_DOTS;
    return (
      <div className="flex flex-col items-center w-12 bg-bg-secondary border-r border-border-default py-3 gap-3 flex-shrink-0">
        <img src={logoSvg} alt="Alfredo" width={28} height={28} />
        <IconButton size="sm" label="Expand sidebar" onClick={toggleSidebar}>
          <PanelLeft />
        </IconButton>

        <div className="w-6 h-px bg-border-default" />

        {/* Worktree status dots */}
        <div className="flex flex-col items-center gap-2 mt-1">
          {flatWorktrees.slice(0, MAX_DOTS).map((wt) => {
            const shouldPulse = wt.agentStatus === "busy" || wt.agentStatus === "waitingForInput";
            return (
              <Tooltip
                key={wt.id}
                side="right"
                content={`${wt.branch} — ${statusLabel[wt.agentStatus] ?? wt.agentStatus}`}
              >
                <button
                  type="button"
                  onClick={() => setActiveWorktree(wt.id)}
                  className={[
                    "h-2.5 w-2.5 rounded-full transition-all cursor-pointer",
                    "hover:scale-125",
                    statusDotColor[wt.agentStatus] ?? "bg-text-tertiary",
                    shouldPulse ? "animate-pulse-dot" : "",
                    wt.id === activeWorktreeId ? "ring-1 ring-offset-1 ring-accent-primary ring-offset-bg-secondary" : "",
                  ].join(" ")}
                />
              </Tooltip>
            );
          })}
          {overflow > 0 && (
            <span className="text-[9px] text-text-tertiary leading-none">
              +{overflow}
            </span>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* New worktree button — only when a repo is configured */}
        {hasRepo && (
          <>
            <IconButton size="sm" label="New worktree" onClick={() => setCreateWorktreeOpen(true)}>
              <Plus />
            </IconButton>

            <CreateWorktreeDialog
              open={createWorktreeOpen}
              onOpenChange={setCreateWorktreeOpen}
            />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-[260px] h-full bg-bg-secondary border-r border-border-default flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between h-12 px-4 border-b border-border-default flex-shrink-0">
        <div className="flex items-center gap-3">
          <img src={logoSvg} alt="Alfredo" width={24} height={24} />
          <span className="text-sm font-semibold text-text-primary">
            alfredo
          </span>
        </div>
        <div className="flex items-center gap-1">
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
      <div className="flex-1 overflow-y-auto py-3">
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

      {/* Footer — only show worktree actions when a repo is configured */}
      {hasRepo && (
        <div className="px-4 py-3 border-t border-border-default flex-shrink-0 space-y-2.5">
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 h-9 rounded-[var(--radius-md)] bg-accent-muted text-accent-primary text-sm font-medium hover:bg-accent-primary/25 transition-colors cursor-pointer"
            onClick={() => setCreateWorktreeOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New worktree
          </button>
          <button
            type="button"
            className="w-full text-center text-xs text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer py-0.5"
            onClick={() => setWorkspaceSettingsOpen(true)}
          >
            Workspace settings
          </button>
        </div>
      )}

      {/* Dialogs */}
      <GlobalSettingsDialog
        open={globalSettingsOpen}
        onOpenChange={setGlobalSettingsOpen}
      />
      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        onOpenChange={setWorkspaceSettingsOpen}
      />
      {hasRepo && (
        <CreateWorktreeDialog
          open={createWorktreeOpen}
          onOpenChange={setCreateWorktreeOpen}
        />
      )}
    </div>
  );
}

export { Sidebar };

