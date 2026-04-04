import { useState, useEffect, useCallback } from "react";
import { Settings, Plus, HelpCircle } from "lucide-react";
import { IconButton } from "../ui";
import logoSvg from "../../assets/logo-cat.svg";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { StatusGroup } from "./StatusGroup";
import { SidebarDragContext } from "./SidebarDragContext";
import { ArchiveSection } from "./ArchiveSection";
import { RepoSelector } from "./RepoSelector";
import { BranchModeView } from "./BranchModeView";
import { GlobalSettingsDialog } from "../settings/GlobalSettingsDialog";
import { ShortcutsOverlay } from "../settings/ShortcutsOverlay";
import { WorkspaceSettingsDialog } from "../settings/WorkspaceSettingsDialog";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { lifecycleManager } from "../../services/lifecycleManager";
import type { KanbanColumn, Worktree, RepoEntry } from "../../types";
import { useAppConfig } from "../../hooks/useAppConfig";
import { runArchiveScript } from "../../api";

const COLUMNS: KanbanColumn[] = [
  "toDo",
  "inProgress",
  "blocked",
  "draftPr",
  "openPr",
  "needsReview",
  "done",
];

function groupByColumn(
  worktrees: Worktree[],
): Record<KanbanColumn, Worktree[]> {
  const groups: Record<KanbanColumn, Worktree[]> = {
    toDo: [],
    inProgress: [],
    blocked: [],
    draftPr: [],
    openPr: [],
    needsReview: [],
    done: [],
  };
  for (const wt of worktrees) {
    const col = groups[wt.column] ? wt.column : "inProgress";
    groups[col].push(wt);
  }
  return groups;
}


interface SidebarProps {
  hasRepo: boolean;
  repos: RepoEntry[];
  activeRepo: string | null;
  selectedRepos?: string[];
  onToggleRepo?: (path: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (path: string) => void;
  activeRepoMode: "worktree" | "branch";
  onEnableWorktrees: () => void;
  repoColors?: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  onSetRepoDisplayName?: (repoPath: string, name: string | null) => void;
}

function Sidebar({
  hasRepo = false,
  repos,
  activeRepo,
  selectedRepos,
  onToggleRepo,
  onAddRepo,
  onRemoveRepo,
  activeRepoMode,
  onEnableWorktrees,
  repoColors,
  repoDisplayNames,
  onSetRepoDisplayName,
}: SidebarProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
  const archiveWorktree = useWorkspaceStore((s) => s.archiveWorktree);
  const unarchiveWorktree = useWorkspaceStore((s) => s.unarchiveWorktree);
  const repoPath = activeRepo;

  const handleArchiveWorktree = useCallback(async (id: string) => {
    const wt = worktrees.find((w) => w.id === id);
    if (wt && repoPath) {
      try {
        await runArchiveScript(repoPath, wt.path);
      } catch (e) {
        console.warn("[sidebar] Archive script failed:", e);
      }
    }
    archiveWorktree(id);
  }, [worktrees, repoPath, archiveWorktree]);

  const { config, updateConfig } = useAppConfig();
  const collapsedColumns = config?.collapsedKanbanColumns ?? [];

  const handleToggleCollapsed = useCallback((column: KanbanColumn) => {
    const current = config?.collapsedKanbanColumns ?? [];
    const next = current.includes(column)
      ? current.filter((c: string) => c !== column)
      : [...current, column];
    updateConfig({ collapsedKanbanColumns: next });
  }, [config, updateConfig]);

  async function handleDeleteWorktree(id: string) {
    const wt = worktrees.find((w) => w.id === id);
    if (!wt || !repoPath) return;
    await lifecycleManager.removeWorktree(id, repoPath, wt.name);
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

      if (event.metaKey && event.key >= "1" && event.key <= "9") {
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

  useEffect(() => {
    const handler = () => setShortcutsOpen(true);
    window.addEventListener("alfredo:shortcuts-overlay", handler);
    return () => window.removeEventListener("alfredo:shortcuts-overlay", handler);
  }, []);

  useEffect(() => {
    const handler = () => setGlobalSettingsOpen(true);
    window.addEventListener("alfredo:settings-open", handler);
    return () => window.removeEventListener("alfredo:settings-open", handler);
  }, []);

  const [globalSettingsOpen, setGlobalSettingsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
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

  const effectiveSelectedRepos = selectedRepos ?? (activeRepo ? [activeRepo] : []);
  const defaultRepoPath =
    worktrees.find((w) => w.id === activeWorktreeId)?.repoPath
    ?? effectiveSelectedRepos[0]
    ?? activeRepo
    ?? undefined;
  const effectiveRepoColors = repoColors ?? {};
  const repoIndexMap = Object.fromEntries(repos.map((r, i) => [r.path, i]));
  const showRepoTags = effectiveSelectedRepos.length > 1;

  return (
    <div data-sidebar className="relative flex flex-col w-full h-full sidebar-bg border-r border-border-subtle flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between h-10 px-4 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-3">
          <img src={logoSvg} alt="Alfredo" width={22} height={22} className="flex-shrink-0" />
        </div>
        <div className="flex items-center gap-2">
          <IconButton size="sm" label="Keyboard shortcuts" className="rounded-[6px]" onClick={() => setShortcutsOpen(true)}>
            <HelpCircle />
          </IconButton>
          <IconButton size="sm" label="App settings" className="rounded-[6px]" onClick={() => setGlobalSettingsOpen(true)}>
            <Settings />
          </IconButton>
        </div>
      </div>

      {/* Repo selector */}
      {repos.length >= 2 && (
        <RepoSelector
          repos={repos}
          selectedRepos={effectiveSelectedRepos}
          repoColors={effectiveRepoColors}
          repoDisplayNames={repoDisplayNames ?? {}}
          onToggleRepo={onToggleRepo ?? (() => {})}
          onAddRepo={onAddRepo}
          onRemoveRepo={onRemoveRepo}
          worktreeCountByRepo={Object.fromEntries(
            repos.map((r) => [r.path, activeWorktrees.filter((wt) => wt.repoPath === r.path).length])
          )}
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
            <SidebarDragContext collapsedColumns={collapsedColumns} onExpandColumn={handleToggleCollapsed}>
              {(isDragging, dragActiveId) =>
                COLUMNS.map((col) => (
                  <StatusGroup
                    key={col}
                    column={col}
                    worktrees={grouped[col]}
                    activeWorktreeId={activeWorktreeId}
                    onSelectWorktree={setActiveWorktree}
                    onDeleteWorktree={handleDeleteWorktree}
                    onArchiveWorktree={handleArchiveWorktree}
                    forceVisible={isDragging}
                    dragActiveId={dragActiveId}
                    repoColors={effectiveRepoColors}
                    repoDisplayNames={repoDisplayNames}
                    showRepoTags={showRepoTags}
                    repoIndexMap={repoIndexMap}
                    isCollapsed={collapsedColumns.includes(col)}
                    onToggleCollapsed={handleToggleCollapsed}
                  />
                ))
              }
            </SidebarDragContext>
          </div>

          {/* Footer — only show worktree actions when a repo is configured */}
          {hasRepo && (
            <div className="px-4 pt-3 pb-4 border-t border-border-subtle flex-shrink-0">
              <ArchiveSection
                worktrees={archivedWorktrees}
                onDelete={handleDeleteWorktree}
                onDeleteAll={handleDeleteAllArchived}
                onUnarchive={unarchiveWorktree}
                deletingCount={deletingCount}
              />
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 h-9 rounded-[var(--radius-md)] border border-dashed border-accent-primary/25 text-accent-primary/70 text-sm font-medium hover:bg-accent-muted hover:border-accent-primary/40 hover:text-accent-primary transition-all cursor-pointer"
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
                Repository settings
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
      <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        onOpenChange={setWorkspaceSettingsOpen}
        repoPath={repoPath || "."}
        repos={repos}
        repoColors={effectiveRepoColors}
        repoDisplayNames={repoDisplayNames ?? {}}
        onSetRepoDisplayName={onSetRepoDisplayName}
        defaultRepoPath={defaultRepoPath}
      />
      {hasRepo && (
        <CreateWorktreeDialog
          open={createWorktreeOpen}
          onOpenChange={setCreateWorktreeOpen}
          repoPath={repoPath ?? undefined}
          repos={repos}
          repoColors={effectiveRepoColors}
          defaultRepoPath={defaultRepoPath}
        />
      )}
    </div>
  );
}

export { Sidebar };
