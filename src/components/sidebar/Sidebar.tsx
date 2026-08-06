import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Settings, Plus, HelpCircle, Pin, PinOff, ChevronsLeft, Bell, BellOff } from "lucide-react";
import { IconButton } from "../ui";
import { CatLogo } from "../ui/CatLogo";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { StatusGroup } from "./StatusGroup";
import { SidebarDragContext } from "./SidebarDragContext";
import { ArchiveSection } from "./ArchiveSection";
import { RepoSelector } from "./RepoSelector";
import { BranchSection } from "./BranchSection";
import { useBranchRepos } from "../../hooks/useBranchRepos";
import { openWorkspaceSettings } from "../settings/openWorkspaceSettings";
import { DEFAULT_NOTIFICATION_CONFIG } from "../settings/notificationConfig";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { lifecycleManager } from "../../services/lifecycleManager";
import type { KanbanColumn, Worktree, RepoEntry } from "../../types";
import { useAppConfig } from "../../hooks/useAppConfig";
import { runArchiveScript, countWorktrees, notificationPermissionStatus, requestNotificationPermission } from "../../api";
import { stopServerAndReleasePort } from "../../services/portReclaim";
import { sortColumnWorktrees, type WorktreeOrderMap } from "../../lib/worktreeOrder";
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
  worktreeOrder: WorktreeOrderMap,
  dragActiveId?: string | null,
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
  for (const col of Object.keys(groups) as KanbanColumn[]) {
    groups[col] = sortColumnWorktrees(groups[col], col, worktreeOrder, dragActiveId);
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
  onSetWorktreeLabel?: (worktreePath: string, label: string | null) => void;
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
  onSetWorktreeLabel,
}: SidebarProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
  const archiveWorktree = useWorkspaceStore((s) => s.archiveWorktree);
  const unarchiveWorktree = useWorkspaceStore((s) => s.unarchiveWorktree);
  const pinnedWorktrees = useWorkspaceStore((s) => s.pinnedWorktrees);
  const worktreeOrder = useWorkspaceStore((s) => s.worktreeOrder);
  const clearAllPins = useWorkspaceStore((s) => s.clearAllPins);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const repoPath = activeRepo;

  const handleArchiveWorktree = useCallback(async (id: string) => {
    const wt = worktrees.find((w) => w.id === id);
    if (wt) {
      try {
        await runArchiveScript(wt.repoPath, wt.path);
      } catch (e) {
        console.warn("[sidebar] Archive script failed:", e);
      }
      await stopServerAndReleasePort(wt, "archive");
    }
    archiveWorktree(id);
  }, [worktrees, archiveWorktree]);

  const { config, updateConfig } = useAppConfig();
  const collapsedColumns = config?.collapsedKanbanColumns ?? [];
  const hideUnpinned = config?.hideUnpinnedWorktrees ?? false;
  const showMainCardRepos = config?.showMainCardRepos ?? [];

  const notificationsEnabled = config?.notifications?.enabled ?? false;

  // Global notifications toggle. Enabling re-checks OS permission (requesting it
  // if undecided) so the bell mirrors the master toggle in Notification settings.
  const handleToggleNotifications = useCallback(async () => {
    if (notificationsEnabled) {
      await updateConfig((prev) => ({
        notifications: { ...(prev.notifications ?? DEFAULT_NOTIFICATION_CONFIG), enabled: false },
      }));
      return;
    }
    const status = await notificationPermissionStatus();
    const granted = status === "granted" || (await requestNotificationPermission());
    if (granted) {
      await updateConfig((prev) => ({
        notifications: { ...(prev.notifications ?? DEFAULT_NOTIFICATION_CONFIG), enabled: true },
      }));
    }
  }, [notificationsEnabled, updateConfig]);

  const handleToggleCollapsed = useCallback((column: KanbanColumn) => {
    updateConfig((prev) => {
      const current = prev.collapsedKanbanColumns ?? [];
      const next = current.includes(column)
        ? current.filter((c: string) => c !== column)
        : [...current, column];
      return { collapsedKanbanColumns: next };
    });
  }, [updateConfig]);

  // Sections that are expanded only because the user is dragging over them.
  // Reverts to the persisted collapsed state on drag-leave / drag-end, except
  // for the actual drop column which gets persisted via handleToggleCollapsed.
  const [dragTempExpanded, setDragTempExpanded] = useState<Set<KanbanColumn>>(() => new Set());
  const handleSetTempExpanded = useCallback((column: KanbanColumn, expanded: boolean) => {
    setDragTempExpanded((prev) => {
      const has = prev.has(column);
      if (expanded === has) return prev;
      const next = new Set(prev);
      if (expanded) next.add(column); else next.delete(column);
      return next;
    });
  }, []);
  const handleClearTempExpanded = useCallback((except?: KanbanColumn) => {
    setDragTempExpanded((prev) => {
      if (prev.size === 0) return prev;
      if (except !== undefined && prev.has(except)) {
        if (prev.size === 1) return prev;
        return new Set([except]);
      }
      return new Set();
    });
  }, []);
  // Once the drop column has been persisted-expanded (removed from
  // collapsedKanbanColumns), drop it from the temp set too — otherwise the
  // override is harmless but stale.
  const collapsedKey = collapsedColumns.join(",");
  useEffect(() => {
    setDragTempExpanded((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set(prev);
      for (const col of prev) {
        if (!collapsedColumns.includes(col)) {
          next.delete(col);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsedKey]);

  const handleToggleHideUnpinned = useCallback(() => {
    updateConfig((prev) => ({ hideUnpinnedWorktrees: !(prev.hideUnpinnedWorktrees ?? false) }));
  }, [updateConfig]);

  // Auto-expand a kanban section when a worktree arrives in it or transitions
  // into it (e.g. GitHub sync moving a PR from In Progress → Needs Review).
  // Without this, newly-added PR-review worktrees vanish into a collapsed
  // section once the auto-column re-classification fires.
  const seenColumnsByIdRef = useRef<Map<string, KanbanColumn> | null>(null);
  useEffect(() => {
    const activeNow = worktrees.filter((wt) => !wt.archived && !wt.isBranchMode);
    const seen = seenColumnsByIdRef.current;

    const nextSnapshot = new Map<string, KanbanColumn>();
    for (const wt of activeNow) nextSnapshot.set(wt.id, wt.column);

    // First pass after mount: snapshot only, never expand — respects the
    // user's persisted collapsed state on app start / repo switch.
    if (seen === null) {
      seenColumnsByIdRef.current = nextSnapshot;
      return;
    }

    const arrivalColumns = new Set<KanbanColumn>();
    for (const wt of activeNow) {
      // "done" never drives auto-expand: when a worktree lands in Done via an
      // automatic transition (merge detection / GitHub sync / auto-archive)
      // there's no reason to pop the section open — completed work doesn't
      // need surfacing. Excluded here (not just at the toExpand filter below)
      // so a Done arrival also can't inflate the size gate and suppress a
      // sibling column's expansion. Manual drops onto a collapsed Done still
      // expand it via the drag path (SidebarDragContext's onExpandColumn).
      if (wt.column === "done") continue;
      const prev = seen.get(wt.id);
      if (prev === undefined || prev !== wt.column) {
        arrivalColumns.add(wt.column);
      }
    }

    seenColumnsByIdRef.current = nextSnapshot;

    if (arrivalColumns.size === 0) return;
    // Gate on distinct destination columns, not row count: a burst of N PR
    // syncs landing in the same column should still expand it (size=1),
    // while a repo switch sprays arrivals across many sections (size > 2).
    if (arrivalColumns.size > 2) return;

    const toExpand = new Set<string>(
      [...arrivalColumns].filter((c) => collapsedColumns.includes(c)),
    );
    if (toExpand.size === 0) return;

    updateConfig((prev) => ({
      collapsedKanbanColumns: (prev.collapsedKanbanColumns ?? []).filter(
        (c) => !toExpand.has(c),
      ),
    }));
    // collapsedColumns and updateConfig intentionally omitted: this effect
    // should only fire on worktree mutations (arrivals / transitions), not
    // when the user manually toggles a section.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worktrees]);

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
  const grouped = groupByColumn(activeWorktrees, worktreeOrder);

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
          <IconButton
            size="sm"
            label={notificationsEnabled ? "Mute notifications" : "Enable notifications"}
            className="rounded-[6px]"
            onClick={handleToggleNotifications}
          >
            {notificationsEnabled ? <Bell /> : <BellOff />}
          </IconButton>
          <IconButton size="sm" label="App settings" className="rounded-[6px]" onClick={() => window.dispatchEvent(new Event("alfredo:settings-open"))}>
            <Settings />
          </IconButton>
          <IconButton size="sm" label="Hide sidebar (⌘B)" className="rounded-[6px]" onClick={toggleSidebar}>
            <ChevronsLeft />
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
          className="flex items-center justify-center px-2 rounded-[var(--radius-md)] border border-border-default bg-bg-elevated hover:bg-bg-hover text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      <GitHubAuthBanner />

      <>
        {/* Scrollable agent list */}
        <div className="flex-1 overflow-y-auto pb-3">
          {hasWorktreeRepos && (pinnedWorktrees.size > 0 || hideUnpinned) && (
            <div className="sticky top-0 z-10 flex justify-end gap-1 px-3.5 pb-1 bg-gradient-to-b from-[var(--bg-sidebar)] via-[var(--bg-sidebar)] to-transparent">
              {pinnedWorktrees.size > 0 && (
                <button
                  type="button"
                  onClick={clearAllPins}
                  className="inline-flex items-center gap-1.5 h-[22px] px-2 rounded-md text-[11px] font-medium text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors cursor-pointer"
                >
                  <PinOff className="h-2.5 w-2.5" />
                  Unpin all
                </button>
              )}
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
            <SidebarDragContext
              collapsedColumns={collapsedColumns}
              onExpandColumn={handleToggleCollapsed}
              onSetTempExpanded={handleSetTempExpanded}
              onClearTempExpanded={handleClearTempExpanded}
              worktreeLabels={worktreeLabels}
              hideUnpinned={hideUnpinned}
            >
              {(isDragging, dragActiveId) => {
                // Mid-drag, regroup with the active card pinned to its store
                // position so it renders where handleDragOver spliced it —
                // see sortColumnWorktrees' dragActiveId doc.
                const dragGrouped = dragActiveId
                  ? groupByColumn(activeWorktrees, worktreeOrder, dragActiveId)
                  : grouped;
                return COLUMNS.map((col) => (
                  <StatusGroup
                    key={col}
                    column={col}
                    worktrees={dragGrouped[col]}
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
                    isTempExpanded={dragTempExpanded.has(col)}
                  />
                ));
              }}
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
                  className="w-full flex items-center justify-center gap-2 h-9 rounded-[var(--radius-md)] border border-accent-edge bg-accent-soft text-accent-primary text-sm font-medium hover:bg-accent-soft-hover hover:border-accent-edge-hover transition-all cursor-pointer"
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
                onClick={() => openWorkspaceSettings()}
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
