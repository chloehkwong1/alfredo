import { create } from "zustand";
import type {
  Annotation,
  CheckRun,
  KanbanColumn,
  PrStatusWithColumn,
  TabType,
  Worktree,
  WorkspaceTab,
} from "../types";

interface WorkspaceState {
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  /** Tracks manual column overrides (from drag). Keyed by worktree id. */
  columnOverrides: Record<string, KanbanColumn>;
  /** Tracks the last-known PR state per worktree, so we can detect state changes. */
  lastPrState: Record<string, string>;
  /** Tracks which worktrees the user has "seen" while idle/waiting. */
  seenWorktrees: Set<string>;
  /** Tabs per worktree. Keyed by worktreeId. */
  tabs: Record<string, WorkspaceTab[]>;
  /** Active tab ID per worktree. Keyed by worktreeId. */
  activeTabId: Record<string, string>;
  /** Inline annotations per worktree. Keyed by worktreeId. */
  annotations: Record<string, Annotation[]>;
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
  applyPrUpdates: (prs: PrStatusWithColumn[]) => void;
  markWorktreeSeen: (id: string) => void;
  addTab: (worktreeId: string, type: TabType) => void;
  removeTab: (worktreeId: string, tabId: string) => void;
  setActiveTabId: (worktreeId: string, tabId: string) => void;
  ensureDefaultTabs: (worktreeId: string) => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (worktreeId: string, annotationId: string) => void;
  clearAnnotations: (worktreeId: string) => void;
  restoreTabs: (worktreeId: string, tabs: WorkspaceTab[], activeTabId: string) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Check runs per worktree. Keyed by worktreeId. */
  checkRuns: Record<string, CheckRun[]>;
  setCheckRuns: (worktreeId: string, runs: CheckRun[]) => void;
  addDisconnectedTab: (tabId: string) => void;
  removeDisconnectedTab: (tabId: string) => void;
  isTabDisconnected: (tabId: string) => boolean;
  updateTab: (worktreeId: string, tabId: string, patch: Partial<WorkspaceTab>) => void;
  clearStore: () => void;
  setRunningServer: (server: { worktreeId: string; sessionId: string; tabId: string } | null) => void;
}

/**
 * Compute a stable key representing the PR "state" for override-clearing purposes.
 * When this key changes, manual overrides are cleared.
 */
function prStateKey(pr: PrStatusWithColumn): string {
  if (pr.merged) return "merged";
  if (pr.draft) return "draft";
  return "open";
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  worktrees: [],
  activeWorktreeId: null,
  columnOverrides: {},
  lastPrState: {},
  seenWorktrees: new Set<string>(),
  tabs: {},
  activeTabId: {},
  annotations: {},
  sidebarCollapsed: false,
  archiveAfterDays: 2,
  checkRuns: {},
  disconnectedTabs: new Set<string>(),
  runningServer: null,

  addWorktree: (worktree) =>
    set((state) => ({ worktrees: [...state.worktrees, worktree] })),

  removeWorktree: (id) =>
    set((state) => {
      const { [id]: _tabs, ...restTabs } = state.tabs;
      const { [id]: _activeTab, ...restActiveTabId } = state.activeTabId;
      const { [id]: _annotations, ...restAnnotations } = state.annotations;
      const { [id]: _checkRuns, ...restCheckRuns } = state.checkRuns;
      const { [id]: _override, ...restOverrides } = state.columnOverrides;
      const { [id]: _prState, ...restPrState } = state.lastPrState;
      const newSeen = new Set(state.seenWorktrees);
      newSeen.delete(id);
      return {
        worktrees: state.worktrees.filter((wt) => wt.id !== id),
        activeWorktreeId: state.activeWorktreeId === id ? null : state.activeWorktreeId,
        tabs: restTabs,
        activeTabId: restActiveTabId,
        annotations: restAnnotations,
        checkRuns: restCheckRuns,
        columnOverrides: restOverrides,
        lastPrState: restPrState,
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

  /** Manual column override from drag-and-drop. Persisted until PR state changes. */
  setManualColumn: (id, column) =>
    set((state) => ({
      columnOverrides: { ...state.columnOverrides, [id]: column },
      worktrees: state.worktrees.map((wt) =>
        wt.id === id ? { ...wt, column } : wt,
      ),
    })),

  setActiveWorktree: (id) => set({ activeWorktreeId: id }),

  setWorktrees: (freshWorktrees) =>
    set((state) => {
      // Merge fresh git data with existing enriched state (PR status, column, etc.)
      const existing = new Map(state.worktrees.map((wt) => [wt.id, wt]));
      const worktrees = freshWorktrees.map((fresh) => {
        const old = existing.get(fresh.id);
        if (old) {
          return {
            ...fresh,
            prStatus: old.prStatus,
            column: old.column,
            agentStatus: old.agentStatus,
            archived: old.archived,
          };
        }
        return fresh;
      });
      return { worktrees };
    }),

  /**
   * Apply PR status updates from the background sync loop.
   * Matches PRs to worktrees by branch name.
   * Auto-assigns columns unless a manual override is active.
   * Clears manual overrides when the PR state changes.
   */
  applyPrUpdates: (prs) =>
    set((state) => {
      // Index PRs by branch for quick lookup
      const prByBranch = new Map<string, PrStatusWithColumn>();
      for (const pr of prs) {
        prByBranch.set(pr.branch, pr);
      }

      const newOverrides = { ...state.columnOverrides };
      const newLastPrState = { ...state.lastPrState };

      const worktrees = state.worktrees.map((wt) => {
        const pr = prByBranch.get(wt.branch);

        if (!pr) {
          // No PR for this branch — keep existing state
          return wt;
        }

        const currentStateKey = prStateKey(pr);
        const previousStateKey = state.lastPrState[wt.id];

        // If PR state changed, clear any manual override
        if (previousStateKey && previousStateKey !== currentStateKey) {
          delete newOverrides[wt.id];
        }

        newLastPrState[wt.id] = currentStateKey;

        // Build updated PR status (without autoColumn, which is store-only)
        const prStatus = {
          number: pr.number,
          state: pr.state,
          title: pr.title,
          url: pr.url,
          draft: pr.draft,
          merged: pr.merged,
          branch: pr.branch,
          mergedAt: pr.mergedAt,
        };

        // Use manual override if still active, otherwise auto-assign
        const column = newOverrides[wt.id] ?? pr.autoColumn;

        return { ...wt, prStatus, column };
      });

      // Auto-create PR tabs for worktrees that gained a PR
      const newTabs = { ...state.tabs };
      for (const wt of worktrees) {
        const existingTabs = newTabs[wt.id] ?? [];
        const hasPrTab = existingTabs.some((t) => t.type === "pr");

        if (wt.prStatus && !hasPrTab) {
          // Worktree gained a PR — add PR tab before Changes
          const prTab: WorkspaceTab = { id: `${wt.id}:pr`, type: "pr", label: "PR" };
          const changesIdx = existingTabs.findIndex((t) => t.type === "changes");
          const tabs = [...existingTabs];
          if (changesIdx >= 0) {
            tabs.splice(changesIdx, 0, prTab);
          } else {
            tabs.push(prTab);
          }
          newTabs[wt.id] = tabs;
        }
      }

      return {
        worktrees,
        tabs: newTabs,
        columnOverrides: newOverrides,
        lastPrState: newLastPrState,
      };
    }),

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

    if (hasClaude && hasShell && hasChanges) return; // already has required tabs

    const tabs = [...existing];
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
            : type === "pr" ? "PR"
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

  restoreTabs: (worktreeId, tabs, activeTabId) =>
    set((state) => ({
      tabs: { ...state.tabs, [worktreeId]: tabs },
      activeTabId: { ...state.activeTabId, [worktreeId]: activeTabId },
    })),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed }),

  setCheckRuns: (worktreeId, runs) =>
    set((state) => ({
      checkRuns: { ...state.checkRuns, [worktreeId]: runs },
    })),

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

  clearStore: () =>
    set({
      worktrees: [],
      activeWorktreeId: null,
      columnOverrides: {},
      lastPrState: {},
      seenWorktrees: new Set<string>(),
      tabs: {},
      activeTabId: {},
      annotations: {},
      sidebarCollapsed: false,
      archiveAfterDays: 2,
      checkRuns: {},
      disconnectedTabs: new Set<string>(),
      runningServer: null,
    }),

  setRunningServer: (server) => set({ runningServer: server }),
}));
