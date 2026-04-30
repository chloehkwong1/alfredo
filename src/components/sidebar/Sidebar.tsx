import { useState, useEffect, useCallback, useMemo } from "react";
import { Settings, Plus, HelpCircle, Pin } from "lucide-react";
import { IconButton } from "../ui";
import { CatLogo } from "../ui/CatLogo";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { StatusGroup } from "./StatusGroup";
import { SidebarDragContext } from "./SidebarDragContext";
import { ArchiveSection } from "./ArchiveSection";
import { RepoSelector } from "./RepoSelector";
import { BranchSection } from "./BranchSection";
import { useBranchRepos } from "../../hooks/useBranchRepos";
import { GlobalSettingsDialog } from "../settings/GlobalSettingsDialog";
import { ShortcutsOverlay } from "../settings/ShortcutsOverlay";
import { WorkspaceSettingsDialog } from "../settings/WorkspaceSettingsDialog";
import { OPEN_WORKSPACE_SETTINGS_EVENT } from "../settings/openWorkspaceSettings";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { lifecycleManager } from "../../services/lifecycleManager";
import type { KanbanColumn, Worktree, RepoEntry } from "../../types";
import { useAppConfig } from "../../hooks/useAppConfig";
import { runArchiveScript, countWorktrees } from "../../api";
import { LifecycleNudge } from "./LifecycleNudge";

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
  // Most recently updated first within each section
  for (const col of Object.keys(groups) as KanbanColumn[]) {
    groups[col].sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  }
  return groups;
}


function GitHubAuthBanner() {
  const authErrors = useWorkspaceStore((s) => s.githubAuthErrors);
  if (authErrors.size === 0) return null;
  return (
    <div className="mx-3 mt-2 px-2.5 py-1.5 rounded-md bg-status-busy/15 border border-status-busy/30 text-[11px] text-status-busy">
      GitHub token missing or expired — PR sync paused.
      <button
        type="button"
        className="ml-1 underline cursor-pointer bg-transparent border-none text-[11px] text-status-busy p-0"
        onClick={() => window.dispatchEvent(new Event("alfredo:settings-open"))}
      >
        Fix in settings
      </button>
    </div>
  );
}

interface SidebarProps {
  hasRepo: boolean;
  repos: RepoEntry[];
  activeRepo: string | null;
  selectedRepos?: string[];
  onToggleRepo?: (path: string) => void;
  onAddRepo: () => void;
  onRemoveRepo: (path: string) => void;
  repoColors?: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  repoShortLabels?: Record<string, string>;
  worktreeLabels?: Record<string, string>;
  onSetRepoDisplayName?: (repoPath: string, name: string | null) => void;
  onSetRepoShortLabel?: (repoPath: string, label: string | null) => void;
  onSetRepoColor?: (repoPath: string, color: string) => void;
  onSetWorktreeLabel?: (worktreePath: string, label: string | null) => void;
  onCheckForUpdates?: () => Promise<void>;
  checkingForUpdates?: boolean;
  upToDate?: boolean;
}

function Sidebar({
  hasRepo = false,
  repos,
  activeRepo,
  selectedRepos,
  onToggleRepo,
  onAddRepo,
  onRemoveRepo,
  repoColors,
  repoDisplayNames,
  repoShortLabels,
  worktreeLabels,
  onSetRepoDisplayName,
  onSetRepoShortLabel,
  onSetRepoColor,
  onSetWorktreeLabel,
  onCheckForUpdates,
  checkingForUpdates,
  upToDate,
}: SidebarProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
  const archiveWorktree = useWorkspaceStore((s) => s.archiveWorktree);
  const unarchiveWorktree = useWorkspaceStore((s) => s.unarchiveWorktree);
  const pinnedWorktrees = useWorkspaceStore((s) => s.pinnedWorktrees);
  const repoPath = activeRepo;

  const handleArchiveWorktree = useCallback(async (id: string) => {
    const wt = worktrees.find((w) => w.id === id);
    if (wt) {
      try {
        await runArchiveScript(wt.repoPath, wt.path);
      } catch (e) {
        console.warn("[sidebar] Archive script failed:", e);
      }
    }
    archiveWorktree(id);
  }, [worktrees, archiveWorktree]);

  const { config, updateConfig } = useAppConfig();
  const collapsedColumns = config?.collapsedKanbanColumns ?? [];
  const hideUnpinned = config?.hideUnpinnedWorktrees ?? false;
  const showMainCardRepos = config?.showMainCardRepos ?? [];

  const handleToggleCollapsed = useCallback((column: KanbanColumn) => {
    updateConfig((prev) => {
      const current = prev.collapsedKanbanColumns ?? [];
      const next = current.includes(column)
        ? current.filter((c: string) => c !== column)
        : [...current, column];
      return { collapsedKanbanColumns: next };
    });
  }, [updateConfig]);

  const handleToggleHideUnpinned = useCallback(() => {
    updateConfig((prev) => ({ hideUnpinnedWorktrees: !(prev.hideUnpinnedWorktrees ?? false) }));
  }, [updateConfig]);

  async function handleDeleteWorktree(id: string) {
    const wt = worktrees.find((w) => w.id === id);
    if (!wt) return;
    await lifecycleManager.removeWorktree(id, wt.repoPath, wt.name);
  }

  const [archivingAll, setArchivingAll] = useState(false);
  const handleArchiveAllDone = useCallback(async () => {
    if (archivingAll) return;
    setArchivingAll(true);
    try {
      const done = worktrees.filter((wt) => !wt.archived && !wt.isBranchMode && wt.column === "done");
      for (const wt of done) {
        await handleArchiveWorktree(wt.id);
      }
    } finally {
      setArchivingAll(false);
    }
  }, [worktrees, handleArchiveWorktree, archivingAll]);

  const activeWorktrees = worktrees.filter((wt) => !wt.archived && !wt.isBranchMode);
  const archivedWorktrees = worktrees.filter((wt) => wt.archived);
  const grouped = groupByColumn(activeWorktrees);

  const doneWorktrees = worktrees.filter((wt) => !wt.archived && !wt.isBranchMode && wt.column === "done");
  const showLifecycleNudge =
    !config?.dismissedLifecycleNudge &&
    doneWorktrees.length >= 3 &&
    archivedWorktrees.length === 0;

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
  const [settingsInitialSection, setSettingsInitialSection] = useState<
    "general" | "terminal" | "agent" | "notifications" | "integrations" | "comment-chips" | null
  >(null);
  const [settingsInitialFocusIndex, setSettingsInitialFocusIndex] = useState<number | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ section?: string; focusIndex?: number }>;
      const section = ce.detail?.section;
      if (section === "comment-chips") {
        setSettingsInitialSection("comment-chips");
        setSettingsInitialFocusIndex(
          typeof ce.detail?.focusIndex === "number" ? ce.detail.focusIndex : null,
        );
        setGlobalSettingsOpen(true);
      }
    };
    window.addEventListener("open-global-settings", handler);
    return () => window.removeEventListener("open-global-settings", handler);
  }, []);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  useEffect(() => {
    const toggle = () => setAskOpen((v) => !v);
    const close = () => setAskOpen(false);
    window.addEventListener("alfredo:toggle-ask", toggle);
    window.addEventListener("alfredo:close-ask", close);
    return () => {
      window.removeEventListener("alfredo:toggle-ask", toggle);
      window.removeEventListener("alfredo:close-ask", close);
    };
  }, []);
  const [workspaceSettingsOpen, setWorkspaceSettingsOpen] = useState(false);
  const [workspaceSettingsRepoOverride, setWorkspaceSettingsRepoOverride] = useState<string | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ repoPath?: string }>;
      if (ce.detail?.repoPath) setWorkspaceSettingsRepoOverride(ce.detail.repoPath);
      setWorkspaceSettingsOpen(true);
    };
    window.addEventListener(OPEN_WORKSPACE_SETTINGS_EVENT, handler);
    return () => window.removeEventListener(OPEN_WORKSPACE_SETTINGS_EVENT, handler);
  }, []);
  const [createWorktreeOpen, setCreateWorktreeOpen] = useState(false);
  const [deletingCount, setDeletingCount] = useState<{ current: number; total: number } | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);

  async function handleDeleteAllArchived() {
    const total = archivedWorktrees.length;
    for (let i = 0; i < archivedWorktrees.length; i++) {
      setDeletingCount({ current: i + 1, total });
      await handleDeleteWorktree(archivedWorktrees[i].id);
    }
    setDeletingCount(null);
  }

  const effectiveSelectedRepos = selectedRepos ?? (activeRepo ? [activeRepo] : []);

  // Worktree counts for the repo-selector dropdown. Unselected repos don't
  // have their worktrees in the workspace store (useSessionRestore clears
  // them), so deriving the count from `activeWorktrees` alone would show 0
  // for every unselected repo. Fetch counts directly via `count_worktrees`
  // and prefer the live store count for repos that are currently selected.
  const [cachedRepoCounts, setCachedRepoCounts] = useState<Record<string, number>>({});
  const worktreeReposKey = repos
    .filter((r) => r.mode !== "branch")
    .map((r) => r.path)
    .sort()
    .join(",");
  const selectedReposKey = effectiveSelectedRepos.slice().sort().join(",");
  useEffect(() => {
    const paths = worktreeReposKey ? worktreeReposKey.split(",") : [];
    if (paths.length === 0) return;
    let cancelled = false;
    Promise.all(
      paths.map((p) =>
        countWorktrees(p)
          .then((n) => [p, n] as const)
          .catch(() => [p, 0] as const),
      ),
    ).then((entries) => {
      if (cancelled) return;
      setCachedRepoCounts((prev) => {
        const next = { ...prev };
        for (const [p, n] of entries) next[p] = n;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [worktreeReposKey, selectedReposKey]);

  const defaultRepoPath =
    worktrees.find((w) => w.id === activeWorktreeId)?.repoPath
    ?? effectiveSelectedRepos[0]
    ?? activeRepo
    ?? undefined;
  const effectiveRepoColors = repoColors ?? {};
  const repoIndexMap = useMemo(
    () => Object.fromEntries(repos.map((r, i) => [r.path, i])),
    [repos],
  );
  const showRepoTags = effectiveSelectedRepos.length > 1;
  const branchRepos = useBranchRepos(repos, effectiveSelectedRepos, showMainCardRepos);
  const worktreeModeRepoSet = useMemo(
    () => new Set(repos.filter((r) => r.mode === "worktree").map((r) => r.path)),
    [repos],
  );
  const hasWorktreeRepos = repos.some(
    (r) => effectiveSelectedRepos.includes(r.path) && r.mode === "worktree",
  );
  const hasWorktreeItems = activeWorktrees.length > 0;
  const pinnedSet = useMemo(() => new Set(showMainCardRepos), [showMainCardRepos]);
  const eligibleWorktreeRepos = useMemo(
    () =>
      repos.filter(
        (r) =>
          r.mode === "worktree" &&
          effectiveSelectedRepos.includes(r.path) &&
          !pinnedSet.has(r.path),
      ),
    [repos, effectiveSelectedRepos, pinnedSet],
  );
  const worktreeCountByRepo = useMemo(
    () =>
      Object.fromEntries(
        repos.map((r) => {
          const liveCount = activeWorktrees.filter((wt) => wt.repoPath === r.path).length;
          const isSelected = effectiveSelectedRepos.includes(r.path);
          return [r.path, isSelected ? liveCount : cachedRepoCounts[r.path] ?? 0];
        }),
      ),
    [repos, activeWorktrees, effectiveSelectedRepos, cachedRepoCounts],
  );
  // Use the updater form so the read-modify-write happens inside updateConfig's
  // serialization queue against fresh disk state. Computing the new array from
  // the local `config` snapshot would lose writes when the user pins/unpins
  // back-to-back faster than the config-changed event can refresh state.
  const handlePinRepo = useCallback((path: string) => {
    updateConfig((prev) => {
      const current = prev.showMainCardRepos ?? [];
      if (current.includes(path)) return {};
      return { showMainCardRepos: [...current, path] };
    });
  }, [updateConfig]);
  const handleUnpinRepo = useCallback((path: string) => {
    updateConfig((prev) => ({
      showMainCardRepos: (prev.showMainCardRepos ?? []).filter((p) => p !== path),
    }));
  }, [updateConfig]);

  return (
    <div data-sidebar className="relative flex flex-col w-full h-full sidebar-bg border-r border-border-subtle flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between h-10 px-4 border-b border-border-subtle flex-shrink-0">
        <div className="flex items-center gap-3">
          <CatLogo aria-label="Alfredo" width={22} height={22} className="flex-shrink-0 text-text-tertiary" />
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            size="sm"
            label="Ask Alfredo"
            data-ask-trigger=""
            aria-expanded={askOpen}
            className={`rounded-[6px] ${askOpen ? "bg-accent-muted text-accent-primary hover:bg-accent-muted hover:text-accent-primary" : ""}`}
            onClick={() => window.dispatchEvent(new CustomEvent("alfredo:toggle-ask"))}
          >
            <HelpCircle />
          </IconButton>
          <IconButton size="sm" label="App settings" className="rounded-[6px]" onClick={() => setGlobalSettingsOpen(true)}>
            <Settings />
          </IconButton>
        </div>
      </div>

      {/* Repo selector is always visible so the repo name has a stable home;
          Add-repo lives as a fixed + icon on the far right */}
      <div className="flex items-stretch gap-1 px-3.5 py-2">
        <RepoSelector
          repos={repos}
          selectedRepos={effectiveSelectedRepos}
          repoColors={effectiveRepoColors}
          repoDisplayNames={repoDisplayNames ?? {}}
          onToggleRepo={onToggleRepo ?? (() => {})}
          onRemoveRepo={onRemoveRepo}
          worktreeCountByRepo={worktreeCountByRepo}
        />
        <button
          type="button"
          data-tour-id="add-repo"
          aria-label="Add a repo"
          title="Add a repo (⌘⇧R)"
          onClick={onAddRepo}
          className="flex items-center justify-center px-2 rounded-[var(--radius-md)] border border-border-subtle bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.04)] text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <GitHubAuthBanner />

      <>
        {/* Scrollable agent list */}
        <div className="flex-1 overflow-y-auto pb-3">
          {hasWorktreeRepos && (pinnedWorktrees.size > 0 || hideUnpinned) && (
            <div className="sticky top-0 z-10 flex justify-end px-3.5 pb-1 bg-gradient-to-b from-[var(--bg-sidebar)] via-[var(--bg-sidebar)] to-transparent">
              <button
                type="button"
                onClick={handleToggleHideUnpinned}
                aria-pressed={hideUnpinned}
                className={[
                  "inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md text-[11px] font-medium transition-colors cursor-pointer",
                  hideUnpinned
                    ? "text-accent-primary bg-accent-muted"
                    : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover",
                ].join(" ")}
              >
                <Pin className="h-2.5 w-2.5" fill={hideUnpinned ? "currentColor" : "none"} />
                Pinned only
              </button>
            </div>
          )}
          {hasWorktreeRepos && (
            <SidebarDragContext collapsedColumns={collapsedColumns} onExpandColumn={handleToggleCollapsed} worktreeLabels={worktreeLabels}>
              {(isDragging, dragActiveId) =>
                COLUMNS.map((col) => (
                  <StatusGroup
                    key={col}
                    column={col}
                    worktrees={grouped[col]}
                    activeWorktreeId={activeWorktreeId}
                    pinnedWorktrees={pinnedWorktrees}
                    hideUnpinned={hideUnpinned}
                    onSelectWorktree={setActiveWorktree}
                    onDeleteWorktree={handleDeleteWorktree}
                    onArchiveWorktree={handleArchiveWorktree}
                    onArchiveAll={col === "done" ? handleArchiveAllDone : undefined}
                    forceVisible={isDragging}
                    dragActiveId={dragActiveId}
                    repoColors={effectiveRepoColors}
                    repoDisplayNames={repoDisplayNames}
                    repoShortLabels={repoShortLabels}
                    worktreeLabels={worktreeLabels}
                    onSetWorktreeLabel={onSetWorktreeLabel}
                    showRepoTags={showRepoTags}
                    repoIndexMap={repoIndexMap}
                    isCollapsed={collapsedColumns.includes(col)}
                    onToggleCollapsed={handleToggleCollapsed}
                  />
                ))
              }
            </SidebarDragContext>
          )}

          {showLifecycleNudge && (
            <LifecycleNudge
              onArchiveAllDone={handleArchiveAllDone}
              onOpenAutoArchive={() => setRulesOpen(true)}
              onDismiss={() => updateConfig({ dismissedLifecycleNudge: true })}
            />
          )}

          {/* Branch-mode repos — below kanban columns.
              Worktree-mode repos that opted into the main card also appear here,
              rendered in a distinct "branch-title" layout. */}
          <BranchSection
            branchRepos={branchRepos}
            activeRepoId={activeWorktreeId}
            onSelectRepo={setActiveWorktree}
            repoColors={effectiveRepoColors}
            repoDisplayNames={repoDisplayNames}
            repoShortLabels={repoShortLabels}
            repoIndexMap={repoIndexMap}
            showRepoTags={showRepoTags}
            hasWorktreeItems={hasWorktreeItems}
            worktreeModeRepoSet={worktreeModeRepoSet}
            eligibleWorktreeRepos={eligibleWorktreeRepos}
            worktreeCountByRepo={worktreeCountByRepo}
            onPinRepo={handlePinRepo}
            onUnpinRepo={handleUnpinRepo}
          />
        </div>

        {/* Footer */}
        {hasRepo && (
          <div className="px-4 pt-3 pb-4 border-t border-border-subtle flex-shrink-0">
            {hasWorktreeRepos && (
              <>
                <ArchiveSection
                  worktrees={archivedWorktrees}
                  onDelete={handleDeleteWorktree}
                  onDeleteAll={handleDeleteAllArchived}
                  onUnarchive={unarchiveWorktree}
                  deletingCount={deletingCount}
                  archiveAfterDays={config?.archiveAfterDays ?? 2}
                  deleteAfterDays={config?.deleteAfterDays ?? 0}
                  onUpdateLifecycleRules={(patch) => updateConfig(patch)}
                  rulesOpen={rulesOpen}
                  onRulesOpenChange={setRulesOpen}
                />
                <button
                  type="button"
                  data-tour-id="create-worktree"
                  className="w-full flex items-center justify-center gap-2 h-9 rounded-[var(--radius-md)] border border-dashed border-accent-primary/25 text-accent-primary/70 text-sm font-medium hover:bg-accent-muted hover:border-accent-primary/40 hover:text-accent-primary transition-all cursor-pointer"
                  onClick={() => setCreateWorktreeOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                  New worktree
                </button>
              </>
            )}
            <div className="flex items-center justify-center gap-1 mt-2">
              <button
                type="button"
                data-tour-id="setup-script"
                className="text-xs text-text-tertiary hover:text-text-secondary hover:underline cursor-pointer transition-colors"
                onClick={() => setWorkspaceSettingsOpen(true)}
              >
                Repository Settings
              </button>
              <span className="text-text-quaternary text-xs">·</span>
              <span className="text-xs text-text-tertiary/70 tabular-nums">
                v{__APP_VERSION__}
              </span>
            </div>
          </div>
        )}
      </>

      {/* Dialogs */}
      <GlobalSettingsDialog
        open={globalSettingsOpen}
        onOpenChange={(open) => {
          setGlobalSettingsOpen(open);
          if (!open) {
            setSettingsInitialSection(null);
            setSettingsInitialFocusIndex(null);
          }
        }}
        onCheckForUpdates={onCheckForUpdates}
        checkingForUpdates={checkingForUpdates}
        upToDate={upToDate}
        initialSection={settingsInitialSection}
        initialFocusIndex={settingsInitialFocusIndex}
        onDeepLinkConsumed={() => {
          // Keep focusIndex around until CommentChipsSettings consumes it
          // but clear section so re-opening manually doesn't re-trigger.
          setSettingsInitialSection(null);
        }}
      />
      <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <WorkspaceSettingsDialog
        open={workspaceSettingsOpen}
        onOpenChange={(open) => {
          setWorkspaceSettingsOpen(open);
          if (!open) setWorkspaceSettingsRepoOverride(null);
        }}
        repoPath={workspaceSettingsRepoOverride || repoPath || "."}
        repos={repos}
        repoColors={effectiveRepoColors}
        repoDisplayNames={repoDisplayNames ?? {}}
        repoShortLabels={repoShortLabels ?? {}}
        onSetRepoDisplayName={onSetRepoDisplayName}
        onSetRepoShortLabel={onSetRepoShortLabel}
        onSetRepoColor={onSetRepoColor}
        defaultRepoPath={workspaceSettingsRepoOverride ?? defaultRepoPath}
      />
      {hasRepo && (
        <CreateWorktreeDialog
          open={createWorktreeOpen}
          onOpenChange={setCreateWorktreeOpen}
          repoPath={repoPath ?? undefined}
          repos={repos.filter((r) => r.mode === "worktree")}
          repoColors={effectiveRepoColors}
          defaultRepoPath={defaultRepoPath}
          selectedRepos={effectiveSelectedRepos}
        />
      )}
    </div>
  );
}

export { Sidebar };
