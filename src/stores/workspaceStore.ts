import { create } from "zustand";
import type {
  Annotation,
  DiffViewMode,
  KanbanColumn,
  TabType,
  Worktree,
  WorkspaceTab,
} from "../types";

interface WorkspaceState {
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  /** Tracks which worktrees the user has "seen" while idle/waiting. */
  seenWorktrees: Set<string>;
  /** Tabs per worktree. Keyed by worktreeId. */
  tabs: Record<string, WorkspaceTab[]>;
  /** Active tab ID per worktree. Keyed by worktreeId. */
  activeTabId: Record<string, string>;
  /** Inline annotations per worktree. Keyed by worktreeId. */
  annotations: Record<string, Annotation[]>;
  /** Diff view mode per worktree. Keyed by worktreeId. */
  diffViewMode: Record<string, DiffViewMode>;
  /** Whether the sidebar is collapsed. */
  sidebarCollapsed: boolean;
  /** Number of days after merging before a worktree is auto-archived. */
  archiveAfterDays: number;
  /** Tab IDs awaiting resume/fresh decision after app restart. */
  disconnectedTabs: Set<string>;
  /** Tracks the currently running dev server, if any. */
  runningServer: { worktreeId: string; sessionId: string; tabId: string } | null;

  addWorktree: (worktree: Worktree) => void;
  removeWorktree: (id: string) => void;
  archiveWorktree: (id: string) => void;
  updateWorktree: (id: string, patch: Partial<Worktree>) => void;
  setColumn: (id: string, column: KanbanColumn) => void;
  setManualColumn: (id: string, column: KanbanColumn) => void;
  setActiveWorktree: (id: string | null) => void;
  setWorktrees: (worktrees: Worktree[]) => void;
  applyWorktreePatches: (patches: Map<string, Partial<Worktree>>) => void;
  markWorktreeSeen: (id: string) => void;
  addTab: (worktreeId: string, type: TabType) => void;
  removeTab: (worktreeId: string, tabId: string) => void;
  setActiveTabId: (worktreeId: string, tabId: string) => void;
  ensureDefaultTabs: (worktreeId: string) => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (worktreeId: string, annotationId: string) => void;
  clearAnnotations: (worktreeId: string) => void;
  setDiffViewMode: (worktreeId: string, mode: DiffViewMode) => void;
  restoreTabs: (worktreeId: string, tabs: WorkspaceTab[], activeTabId: string) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  addDisconnectedTab: (tabId: string) => void;
  removeDisconnectedTab: (tabId: string) => void;
  isTabDisconnected: (tabId: string) => boolean;
  updateTab: (worktreeId: string, tabId: string, patch: Partial<WorkspaceTab>) => void;
  setWorktreesForRepo: (repoPath: string, worktrees: Worktree[]) => void;
  clearWorktreesForRepo: (repoPath: string) => void;
  clearStore: () => void;
  setRunningServer: (server: { worktreeId: string; sessionId: string; tabId: string } | null) => void;
}

function withActivityTimestamps(
  incoming: Worktree[],
  existing: Worktree[],
): Worktree[] {
  const existingMap = new Map(existing.map((w) => [w.id, w]));
  return incoming.map((wt) => {
    const prev = existingMap.get(wt.id);
    if (!prev) return { ...wt, lastActivityAt: Date.now() };
    const changed =
      prev.agentStatus !== wt.agentStatus ||
      prev.additions !== wt.additions ||
      prev.deletions !== wt.deletions ||
      prev.prStatus?.number !== wt.prStatus?.number ||
      prev.prStatus?.state !== wt.prStatus?.state;
    return {
      ...wt,
      lastActivityAt: changed ? Date.now() : (prev.lastActivityAt ?? Date.now()),
    };
  });
}

/**
 * Merge fresh git worktree data with existing enriched state (PR status, column, agent status, archived).
 * Used by both setWorktrees and setWorktreesForRepo to avoid duplicating this logic.
 */
function mergeWorktreeState(fresh: Worktree[], existing: Worktree[]): Worktree[] {
  const existingMap = new Map(existing.map((wt) => [wt.id, wt]));
  const merged = fresh.map((wt) => {
    const old = existingMap.get(wt.id);
    if (old) {
      return {
        ...wt,
        prStatus: old.prStatus,
        column: old.column,
        agentStatus: old.agentStatus,
        archived: old.archived,
      };
    }
    return wt;
  });
  return withActivityTimestamps(merged, existing);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  worktrees: [],
  activeWorktreeId: null,
  seenWorktrees: new Set<string>(),
  tabs: {},
  activeTabId: {},
  annotations: {},
  diffViewMode: {},
  sidebarCollapsed: false,
  archiveAfterDays: 2,
  disconnectedTabs: new Set<string>(),
  runningServer: null,

  addWorktree: (worktree) =>
    set((state) => ({ worktrees: [...state.worktrees, worktree] })),

  removeWorktree: (id) =>
    set((state) => {
      const { [id]: _tabs, ...restTabs } = state.tabs;
      const { [id]: _activeTab, ...restActiveTabId } = state.activeTabId;
      const { [id]: _annotations, ...restAnnotations } = state.annotations;
      const newSeen = new Set(state.seenWorktrees);
      newSeen.delete(id);
      return {
        worktrees: state.worktrees.filter((wt) => wt.id !== id),
        activeWorktreeId: state.activeWorktreeId === id ? null : state.activeWorktreeId,
        tabs: restTabs,
        activeTabId: restActiveTabId,
        annotations: restAnnotations,
        seenWorktrees: newSeen,
        runningServer: state.runningServer?.worktreeId === id ? null : state.runningServer,
      };
    }),

  archiveWorktree: (id) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) =>
        wt.id === id ? { ...wt, archived: true } : wt,
      ),
    })),

  updateWorktree: (id, patch) =>
    set((state) => {
      // When agent starts working, clear the "seen" flag
      const newSeen = new Set(state.seenWorktrees);
      if (patch.agentStatus === "busy") {
        newSeen.delete(id);
      }
      return {
        worktrees: state.worktrees.map((wt) =>
          wt.id === id ? { ...wt, ...patch } : wt,
        ),
        seenWorktrees: newSeen,
      };
    }),

  setColumn: (id, column) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) =>
        wt.id === id ? { ...wt, column } : wt,
      ),
    })),

  setManualColumn: (id, column) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) =>
        wt.id === id ? { ...wt, column } : wt,
      ),
    })),

  setActiveWorktree: (id) => set({ activeWorktreeId: id }),

  setWorktrees: (freshWorktrees) =>
    set((state) => ({
      worktrees: mergeWorktreeState(freshWorktrees, state.worktrees),
    })),

  applyWorktreePatches: (patches) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) => {
        const patch = patches.get(wt.id);
        return patch ? { ...wt, ...patch } : wt;
      }),
    })),

  markWorktreeSeen: (id) =>
    set((state) => ({
      seenWorktrees: new Set(state.seenWorktrees).add(id),
    })),

  ensureDefaultTabs: (worktreeId) => {
    const state = get();
    const existing = state.tabs[worktreeId] ?? [];
    const hasClaude = existing.some((t) => t.type === "claude");
    const hasShell = existing.some((t) => t.type === "shell");
    const hasChanges = existing.some((t) => t.type === "changes");

    // Remove stale "pr" tabs from before the redesign
    const validTypes = new Set(["claude", "shell", "server", "changes"]);
    const cleaned = existing.filter((t) => validTypes.has(t.type));
    const hadStale = cleaned.length !== existing.length;

    if (hasClaude && hasShell && hasChanges && !hadStale) return;

    const tabs = [...cleaned];
    let claudeTabId = state.activeTabId[worktreeId];

    if (!hasClaude) {
      const claudeTab: WorkspaceTab = {
        id: `${worktreeId}:claude:${crypto.randomUUID().slice(0, 8)}`,
        type: "claude",
        label: "Claude",
      };
      // Insert Claude tab at the beginning
      tabs.unshift(claudeTab);
      claudeTabId = claudeTab.id;
    }

    if (!hasShell) {
      const shellTab: WorkspaceTab = {
        id: `${worktreeId}:shell:${crypto.randomUUID().slice(0, 8)}`,
        type: "shell",
        label: "Terminal",
      };
      // Insert shell tab after claude tabs
      const lastClaudeIdx = tabs.reduce((acc, t, i) => (t.type === "claude" ? i : acc), -1);
      tabs.splice(lastClaudeIdx + 1, 0, shellTab);
    }

    if (!hasChanges) {
      const changesTab: WorkspaceTab = {
        id: `${worktreeId}:changes`,
        type: "changes",
        label: "Changes",
      };
      // Changes tab always goes last
      tabs.push(changesTab);
    }

    set({
      tabs: { ...state.tabs, [worktreeId]: tabs },
      // Set active tab to Claude if no active tab was set
      activeTabId: {
        ...state.activeTabId,
        [worktreeId]: state.activeTabId[worktreeId] ?? claudeTabId,
      },
    });
  },

  addTab: (worktreeId, type) =>
    set((state) => {
      const existing = state.tabs[worktreeId] ?? [];
      const count = existing.filter((t) => t.type === type).length;
      const label =
        type === "claude"
          ? count > 0 ? `Claude ${count + 1}` : "Claude"
          : type === "shell"
            ? count > 0 ? `Terminal ${count + 1}` : "Terminal"
            : "Changes";
      const tab: WorkspaceTab = {
        id: `${worktreeId}:${type}:${crypto.randomUUID().slice(0, 8)}`,
        type,
        label,
      };
      // Insert before the Changes tab (always last)
      const changesIdx = existing.findIndex((t) => t.type === "changes");
      const tabs = [...existing];
      if (changesIdx >= 0) {
        tabs.splice(changesIdx, 0, tab);
      } else {
        tabs.push(tab);
      }
      return {
        tabs: { ...state.tabs, [worktreeId]: tabs },
        activeTabId: { ...state.activeTabId, [worktreeId]: tab.id },
      };
    }),

  removeTab: (worktreeId, tabId) =>
    set((state) => {
      const existing = state.tabs[worktreeId] ?? [];
      const tabToRemove = existing.find((t) => t.id === tabId);
      if (!tabToRemove) return state;
      const filtered = existing.filter((t) => t.id !== tabId);
      // Don't allow removing the last non-changes tab
      if (filtered.filter((t) => t.type !== "changes").length === 0) return state;
      // Don't allow removing the last claude or last shell tab
      if (
        (tabToRemove.type === "claude" && filtered.filter((t) => t.type === "claude").length === 0) ||
        (tabToRemove.type === "shell" && filtered.filter((t) => t.type === "shell").length === 0)
      )
        return state;
      const newActiveId =
        state.activeTabId[worktreeId] === tabId
          ? (filtered.find((t) => t.type !== "changes")?.id ?? filtered[0]?.id ?? "")
          : state.activeTabId[worktreeId];
      return {
        tabs: { ...state.tabs, [worktreeId]: filtered },
        activeTabId: { ...state.activeTabId, [worktreeId]: newActiveId },
      };
    }),

  setActiveTabId: (worktreeId, tabId) =>
    set((state) => ({
      activeTabId: { ...state.activeTabId, [worktreeId]: tabId },
    })),

  addAnnotation: (annotation) =>
    set((state) => ({
      annotations: {
        ...state.annotations,
        [annotation.worktreeId]: [
          ...(state.annotations[annotation.worktreeId] || []),
          annotation,
        ],
      },
    })),

  removeAnnotation: (worktreeId, annotationId) =>
    set((state) => ({
      annotations: {
        ...state.annotations,
        [worktreeId]: (state.annotations[worktreeId] || []).filter(
          (a) => a.id !== annotationId,
        ),
      },
    })),

  clearAnnotations: (worktreeId) =>
    set((state) => ({
      annotations: {
        ...state.annotations,
        [worktreeId]: [],
      },
    })),

  setDiffViewMode: (worktreeId, mode) =>
    set((state) => ({
      diffViewMode: { ...state.diffViewMode, [worktreeId]: mode },
    })),

  restoreTabs: (worktreeId, tabs, activeTabId) =>
    set((state) => ({
      tabs: { ...state.tabs, [worktreeId]: tabs },
      activeTabId: { ...state.activeTabId, [worktreeId]: activeTabId },
    })),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed }),

  addDisconnectedTab: (tabId) =>
    set((state) => ({
      disconnectedTabs: new Set(state.disconnectedTabs).add(tabId),
    })),

  removeDisconnectedTab: (tabId) =>
    set((state) => {
      const next = new Set(state.disconnectedTabs);
      next.delete(tabId);
      return { disconnectedTabs: next };
    }),

  isTabDisconnected: (tabId) => get().disconnectedTabs.has(tabId),

  updateTab: (worktreeId, tabId, patch) =>
    set((state) => ({
      tabs: {
        ...state.tabs,
        [worktreeId]: (state.tabs[worktreeId] ?? []).map((t) =>
          t.id === tabId ? { ...t, ...patch } : t,
        ),
      },
    })),

  setWorktreesForRepo: (repoPath, freshWorktrees) =>
    set((state) => {
      const otherRepoWorktrees = state.worktrees.filter((wt) => wt.repoPath !== repoPath);
      const existingForRepo = state.worktrees.filter((wt) => wt.repoPath === repoPath);
      return { worktrees: [...otherRepoWorktrees, ...mergeWorktreeState(freshWorktrees, existingForRepo)] };
    }),

  clearWorktreesForRepo: (repoPath) =>
    set((state) => ({
      worktrees: state.worktrees.filter((wt) => wt.repoPath !== repoPath),
    })),

  clearStore: () =>
    set({
      worktrees: [],
      activeWorktreeId: null,
      seenWorktrees: new Set<string>(),
      tabs: {},
      activeTabId: {},
      annotations: {},
      diffViewMode: {},
      sidebarCollapsed: false,
      archiveAfterDays: 2,
      disconnectedTabs: new Set<string>(),
      runningServer: null,
    }),

  setRunningServer: (server) => set({ runningServer: server }),
}));
