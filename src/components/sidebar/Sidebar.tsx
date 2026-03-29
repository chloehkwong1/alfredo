import { useState, useEffect } from "react";
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
  const repoPath = activeRepo;

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

  useEffect(() => {
    const handler = () => setShortcutsOpen(true);
    window.addEventListener("alfredo:shortcuts-overlay", handler);
    return () => window.removeEventListener("alfredo:shortcuts-overlay", handler);
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
  const effectiveRepoColors = repoColors ?? {};
  const repoIndexMap = Object.fromEntries(repos.map((r, i) => [r.path, i]));
  const showRepoTags = effectiveSelectedRepos.length > 1;

  return (
    <div className="relative flex flex-col w-full h-full sidebar-bg border-r border-border-subtle flex-shrink-0">
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
            <SidebarDragContext>
              {(isDragging, dragActiveId, dragHeight) =>
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
                    dragActiveId={dragActiveId}
                    dragHeight={dragHeight}
                    repoColors={effectiveRepoColors}
                    repoDisplayNames={repoDisplayNames}
                    showRepoTags={showRepoTags}
                    repoIndexMap={repoIndexMap}
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
        selectedRepos={effectiveSelectedRepos}
        repoColors={effectiveRepoColors}
        repoDisplayNames={repoDisplayNames ?? {}}
        onSetRepoDisplayName={onSetRepoDisplayName}
        defaultRepoPath={
          worktrees.find((w) => w.id === activeWorktreeId)?.repoPath
          ?? effectiveSelectedRepos[0]
          ?? activeRepo
          ?? undefined
        }
      />
      {hasRepo && (
        <CreateWorktreeDialog
          open={createWorktreeOpen}
          onOpenChange={setCreateWorktreeOpen}
          repoPath={repoPath ?? undefined}
          repos={repos}
          selectedRepos={effectiveSelectedRepos}
          repoColors={effectiveRepoColors}
          defaultRepoPath={
            worktrees.find((w) => w.id === activeWorktreeId)?.repoPath
            ?? effectiveSelectedRepos[0]
            ?? activeRepo
            ?? undefined
          }
        />
      )}
    </div>
  );
}

export { Sidebar };
