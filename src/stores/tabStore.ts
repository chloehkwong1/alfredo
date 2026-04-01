import { create } from "zustand";
import type { TabType, WorkspaceTab } from "../types";

interface TabState {
  /** Tabs per worktree. Keyed by worktreeId. */
  tabs: Record<string, WorkspaceTab[]>;
  /** Active tab ID per worktree. Keyed by worktreeId. */
  activeTabId: Record<string, string>;
  /** Tab IDs awaiting resume/fresh decision after app restart. */
  disconnectedTabs: Set<string>;

  addTab: (worktreeId: string, type: TabType) => void;
  removeTab: (worktreeId: string, tabId: string) => void;
  setActiveTabId: (worktreeId: string, tabId: string) => void;
  updateTab: (worktreeId: string, tabId: string, patch: Partial<WorkspaceTab>) => void;
  ensureDefaultTabs: (worktreeId: string) => void;
  restoreTabs: (worktreeId: string, tabs: WorkspaceTab[], activeTabId: string) => void;
  addDisconnectedTab: (tabId: string) => void;
  removeDisconnectedTab: (tabId: string) => void;
  isTabDisconnected: (tabId: string) => boolean;
  /** Remove all tab state for a worktree (used during worktree cleanup). */
  removeWorktreeTabs: (worktreeId: string) => void;
  clearStore: () => void;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: {},
  activeTabId: {},
  disconnectedTabs: new Set<string>(),

  ensureDefaultTabs: (worktreeId) => {
    const state = get();
    const existing = state.tabs[worktreeId] ?? [];

    // Migrate old "changes" tabs to "diff" type (from persisted sessions)
    const migrated = existing.map((t) =>
      (t.type as string) === "changes"
        ? { ...t, type: "diff" as TabType, label: t.label === "Changes" ? "Diff" : t.label }
        : t,
    );

    const hasClaude = migrated.some((t) => t.type === "claude");
    const hasShell = migrated.some((t) => t.type === "shell");
    // Remove stale tabs from before redesigns (e.g. "pr")
    const validTypes = new Set(["claude", "shell", "server", "diff"]);
    const cleaned = migrated.filter((t) => validTypes.has(t.type));
    const hadStale = cleaned.length !== migrated.length;

    if (hasClaude && hasShell && !hadStale) return;

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
            : type === "diff"
              ? "Diff"
              : "Server";
      const tab: WorkspaceTab = {
        id: `${worktreeId}:${type}:${crypto.randomUUID().slice(0, 8)}`,
        type,
        label,
      };
      const tabs = [...existing, tab];
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
      // Don't allow removing the last tab
      if (filtered.length === 0) return state;
      // Don't allow removing the last claude or shell tab
      if (
        (tabToRemove.type === "claude" && filtered.filter((t) => t.type === "claude").length === 0) ||
        (tabToRemove.type === "shell" && filtered.filter((t) => t.type === "shell").length === 0)
      )
        return state;
      const newActiveId =
        state.activeTabId[worktreeId] === tabId
          ? (filtered[0]?.id ?? "")
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

  restoreTabs: (worktreeId, tabs, activeTabId) =>
    set((state) => ({
      tabs: { ...state.tabs, [worktreeId]: tabs },
      activeTabId: { ...state.activeTabId, [worktreeId]: activeTabId },
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

  removeWorktreeTabs: (worktreeId) =>
    set((state) => {
      const { [worktreeId]: _tabs, ...restTabs } = state.tabs;
      const { [worktreeId]: _activeTab, ...restActiveTabId } = state.activeTabId;
      return {
        tabs: restTabs,
        activeTabId: restActiveTabId,
      };
    }),

  clearStore: () =>
    set({
      tabs: {},
      activeTabId: {},
      disconnectedTabs: new Set<string>(),
    }),
}));
