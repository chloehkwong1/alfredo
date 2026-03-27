import { useState, useEffect } from "react";
import { Settings, Plus } from "lucide-react";
import { IconButton } from "../ui";
import logoSvg from "../../assets/logo-cat.svg";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { StatusGroup } from "./StatusGroup";
import { SidebarDragContext } from "./SidebarDragContext";
import { ArchiveSection } from "./ArchiveSection";
import { RepoPills } from "./RepoPills";
import { BranchModeView } from "./BranchModeView";
import { GlobalSettingsDialog } from "../settings/GlobalSettingsDialog";
import { WorkspaceSettingsDialog } from "../settings/WorkspaceSettingsDialog";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { deleteWorktree } from "../../api";
import { sessionManager } from "../../services/sessionManager";
import { deleteSession } from "../../services/SessionPersistence";
import type { KanbanColumn, Worktree, RepoEntry } from "../../types";

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

function repoNameFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

interface SidebarProps {
  hasRepo: boolean;
  repos: RepoEntry[];
  activeRepo: string | null;
  onSwitchRepo: (path: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (path: string) => void;
  activeRepoMode: "worktree" | "branch";
  onEnableWorktrees: () => void;
}

function Sidebar({
  hasRepo = false,
  repos,
  activeRepo,
  onSwitchRepo,
  onAddRepo,
  onRemoveRepo,
  activeRepoMode,
  onEnableWorktrees,
}: SidebarProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
  const removeWorktree = useWorkspaceStore((s) => s.removeWorktree);
  const archiveWorktree = useWorkspaceStore((s) => s.archiveWorktree);
  const allTabs = useWorkspaceStore((s) => s.tabs);
  const repoPath = activeRepo;

  async function handleDeleteWorktree(id: string) {
    const wt = worktrees.find((w) => w.id === id);
    if (!wt || !repoPath) return;

    // 1. Remove from store first (prevents sync loop race)
    removeWorktree(id);

    // 2. Close any PTY sessions for this worktree's tabs
    const worktreeTabs = allTabs[id] ?? [];
    for (const tab of worktreeTabs) {
      await sessionManager.closeSession(tab.id);
    }

    // 3. Force-delete worktree + branch
    try {
      await deleteWorktree(repoPath, wt.name, true);
    } catch (e) {
      console.error("Failed to delete worktree:", e);
    }

    // 4. Delete session file
    try {
      await deleteSession(repoPath, id);
    } catch {
      // Non-critical — session file may not exist
    }
  }

  const activeWorktrees = worktrees.filter((wt) => !wt.archived);
  const archivedWorktrees = worktrees.filter((wt) => wt.archived);
  const grouped = groupByColumn(activeWorktrees);

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
  const [deletingCount, setDeletingCount] = useState<{ current: number; total: number } | null>(null);

  async function handleDeleteAllArchived() {
    if (!repoPath) return;
    const total = archivedWorktrees.length;
    for (let i = 0; i < archivedWorktrees.length; i++) {
      setDeletingCount({ current: i + 1, total });
      await handleDeleteWorktree(archivedWorktrees[i].id);
    }
    setDeletingCount(null);
  }

  const displayName = activeRepo ? repoNameFromPath(activeRepo) : "alfredo";

  return (
    <div className="flex flex-col w-[260px] h-full bg-bg-sidebar border-r border-border-subtle flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between h-10 px-4 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-3">
          <img src={logoSvg} alt="Alfredo" width={22} height={22} className="flex-shrink-0" />
          <span className="text-sm font-semibold tracking-[-0.3px] text-text-primary">
            {displayName}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <IconButton size="sm" label="App settings" className="rounded-[6px]" onClick={() => setGlobalSettingsOpen(true)}>
            <Settings />
          </IconButton>
        </div>
      </div>

      {/* Repo pills */}
      {repos.length >= 1 && (
        <RepoPills
          repos={repos}
          activeRepo={activeRepo}
          activeSessions={{}}
          onSwitch={onSwitchRepo}
          onAddRepo={onAddRepo}
          onRemoveRepo={onRemoveRepo}
        />
      )}

      {/* Main content — branch mode vs worktree mode */}
      {activeRepoMode === "branch" ? (
        <BranchModeView
          repoPath={activeRepo ?? ""}
          onEnableWorktrees={onEnableWorktrees}
          onOpenWorkspaceSettings={() => setWorkspaceSettingsOpen(true)}
        />
      ) : (
        <>
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
                    onDeleteWorktree={handleDeleteWorktree}
                    onArchiveWorktree={archiveWorktree}
                    forceVisible={isDragging}
                  />
                ))
              }
            </SidebarDragContext>
            <ArchiveSection
              worktrees={archivedWorktrees}
              onDelete={handleDeleteWorktree}
              onDeleteAll={handleDeleteAllArchived}
              deletingCount={deletingCount}
            />
          </div>

          {/* Footer — only show worktree actions when a repo is configured */}
          {hasRepo && (
            <div className="p-4 border-t border-border-subtle flex-shrink-0">
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
                className="w-full text-center text-xs text-text-tertiary hover:text-text-secondary hover:underline mt-2 cursor-pointer transition-colors"
                onClick={() => setWorkspaceSettingsOpen(true)}
              >
                Workspace settings
              </button>
            </div>
          )}
        </>
      )}

      {/* Dialogs */}
      <GlobalSettingsDialog
        open={globalSettingsOpen}
        onOpenChange={setGlobalSettingsOpen}
      />
      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        onOpenChange={setWorkspaceSettingsOpen}
        repoPath={repoPath || "."}
      />
      {hasRepo && (
        <CreateWorktreeDialog
          open={createWorktreeOpen}
          onOpenChange={setCreateWorktreeOpen}
          repoPath={repoPath ?? undefined}
        />
      )}
    </div>
  );
}

export { Sidebar };
