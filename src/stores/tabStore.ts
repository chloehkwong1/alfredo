import { create } from "zustand";
import { AGENT_TAB_TYPES, isAgentTab } from "../types";
import type { TabType, WorkspaceTab } from "../types";

/** Read the default agent from localStorage. Falls back to "claude". */
function getDefaultAgent(): TabType {
  try {
    const stored = localStorage.getItem("alfredo-default-agent");
    if (stored && AGENT_TAB_TYPES.has(stored as TabType)) {
      return stored as TabType;
    }
  } catch {
    // Ignore
  }
  return "claude";
}

interface TabLabelInputs {
  titleFromOsc: string | null;
  foregroundProcess: string | null;
  cwd: string | null;
}

/** Derive the effective dynamic label from raw inputs. First match wins. */
function deriveDynamicLabel(inputs: TabLabelInputs | undefined): string | null {
  if (!inputs) return null;
  return inputs.titleFromOsc ?? inputs.foregroundProcess ?? inputs.cwd ?? null;
}

function applyLabelInput(
  state: TabState,
  worktreeId: string,
  tabId: string,
  patch: Partial<TabLabelInputs>,
): Partial<TabState> {
  const prev = state.labelInputs[tabId] ?? {
    titleFromOsc: null,
    foregroundProcess: null,
    cwd: null,
  };
  const next: TabLabelInputs = { ...prev, ...patch };
  const dynamicLabel = deriveDynamicLabel(next);
  const tabs = state.tabs[worktreeId] ?? [];
  const updatedTabs = tabs.map((t) =>
    t.id === tabId ? { ...t, dynamicLabel } : t,
  );
  return {
    labelInputs: { ...state.labelInputs, [tabId]: next },
    tabs: { ...state.tabs, [worktreeId]: updatedTabs },
  };
}

interface TabState {
  /** Tabs per worktree. Keyed by worktreeId. */
  tabs: Record<string, WorkspaceTab[]>;
  /** Active tab ID per worktree. Keyed by worktreeId. */
  activeTabId: Record<string, string>;
  /** Tab IDs awaiting resume/fresh decision after app restart. */
  disconnectedTabs: Set<string>;
  /** Raw label inputs per tab. Keyed by tabId. */
  labelInputs: Record<string, TabLabelInputs>;

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
  /** Set the OSC-emitted title for a tab. `null` clears it. */
  setTabTitle: (worktreeId: string, tabId: string, title: string | null) => void;
  /** Set the foreground process command for a tab. `null` = no process. */
  setTabProcess: (worktreeId: string, tabId: string, process: string | null) => void;
  /** Set the CWD for a tab. `null` = unknown. */
  setTabCwd: (worktreeId: string, tabId: string, cwd: string | null) => void;
}

export const useTabStore = create<TabState>((set, get) => ({
  tabs: {},
  activeTabId: {},
  disconnectedTabs: new Set<string>(),
  labelInputs: {},

  ensureDefaultTabs: (worktreeId) => {
    const state = get();
    const existing = state.tabs[worktreeId] ?? [];
    const hadServer = existing.some((t) => t.type === "server");
    if (hadServer) {
      console.log(`[tabStore] ensureDefaultTabs called for ${worktreeId} — has server tab`);
    }

    // Migrate old "changes" tabs to "diff" type (from persisted sessions)
    const migrated = existing.map((t) =>
      (t.type as string) === "changes"
        ? { ...t, type: "diff" as TabType, label: t.label === "Changes" ? "Diff" : t.label }
        : t,
    );

    const validTypes = new Set(["claude", "codex", "gemini", "shell", "server", "diff"]);
    const cleaned = migrated.filter((t) => validTypes.has(t.type));
    const hadStale = cleaned.length !== migrated.length;

    const hasAgent = cleaned.some((t) => isAgentTab(t));
    const hasShell = cleaned.some((t) => t.type === "shell");

    if (hasAgent && hasShell && !hadStale) return;

    const defaultAgent = getDefaultAgent();
    const tabs = [...cleaned];
    let agentTabId = state.activeTabId[worktreeId];

    if (!hasAgent) {
      const labelMap: Record<string, string> = { claude: "Claude", codex: "Codex", gemini: "Gemini" };
      const agentTab: WorkspaceTab = {
        id: `${worktreeId}:${defaultAgent}:${crypto.randomUUID().slice(0, 8)}`,
        type: defaultAgent,
        label: labelMap[defaultAgent] ?? "Claude",
      };
      tabs.unshift(agentTab);
      agentTabId = agentTab.id;
    }

    if (!hasShell) {
      const shellTab: WorkspaceTab = {
        id: `${worktreeId}:shell:${crypto.randomUUID().slice(0, 8)}`,
        type: "shell",
        label: "Terminal",
      };
      const lastAgentIdx = tabs.reduce((acc, t, i) => (isAgentTab(t) ? i : acc), -1);
      tabs.splice(lastAgentIdx + 1, 0, shellTab);
    }

    if (hadServer && !tabs.some((t) => t.type === "server")) {
      console.warn(`[tabStore] ensureDefaultTabs DROPPED server tab for ${worktreeId}!`, { existing: existing.map(t => t.type), cleaned: tabs.map(t => t.type) });
    }
    set({
      tabs: { ...state.tabs, [worktreeId]: tabs },
      activeTabId: {
        ...state.activeTabId,
        [worktreeId]: state.activeTabId[worktreeId] ?? agentTabId,
      },
    });
  },

  addTab: (worktreeId, type) =>
    set((state) => {
      const existing = state.tabs[worktreeId] ?? [];
      const count = existing.filter((t) => t.type === type).length;
      const labelMap: Record<string, string> = {
        claude: "Claude",
        codex: "Codex",
        gemini: "Gemini",
        shell: "Terminal",
        diff: "Diff",
        server: "Server",
      };
      const base = labelMap[type] ?? type;
      const label = count > 0 ? `${base} ${count + 1}` : base;
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
      if (tabToRemove.type === "server") {
        console.warn(`[tabStore] removing server tab ${tabId} from ${worktreeId}`, new Error().stack);
      }
      const filtered = existing.filter((t) => t.id !== tabId);
      // Don't allow removing the last tab
      if (filtered.length === 0) return state;
      // Don't allow removing the last agent or shell tab
      if (
        (isAgentTab(tabToRemove) && !filtered.some((t) => isAgentTab(t))) ||
        (tabToRemove.type === "shell" && filtered.filter((t) => t.type === "shell").length === 0)
      )
        return state;
      const newActiveId =
        state.activeTabId[worktreeId] === tabId
          ? (filtered[0]?.id ?? "")
          : state.activeTabId[worktreeId];
      const { [tabId]: _removed, ...restInputs } = state.labelInputs;
      return {
        tabs: { ...state.tabs, [worktreeId]: filtered },
        activeTabId: { ...state.activeTabId, [worktreeId]: newActiveId },
        labelInputs: restInputs,
      };
    }),

  setActiveTabId: (worktreeId, tabId) =>
    set((state) => ({
      activeTabId: { ...state.activeTabId, [worktreeId]: tabId },
    })),

  restoreTabs: (worktreeId, tabs, activeTabId) => {
    for (const t of tabs) {
      const prefix = t.id.split(":", 1)[0];
      if (prefix && prefix !== worktreeId) {
        console.warn(
          `[tabStore] restoreTabs prefix mismatch: worktree=${worktreeId} tab.id=${t.id}`,
        );
      }
    }
    const existing = useTabStore.getState().tabs[worktreeId] ?? [];
    const hadServer = existing.some((t) => t.type === "server");
    const hasServer = tabs.some((t) => t.type === "server");
    if (hadServer && !hasServer) {
      console.warn(`[tabStore] restoreTabs is DROPPING server tab for ${worktreeId}`, new Error().stack);
    }
    set((state) => ({
      tabs: { ...state.tabs, [worktreeId]: tabs },
      activeTabId: { ...state.activeTabId, [worktreeId]: activeTabId },
    }));
  },

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
      const existing = state.tabs[worktreeId] ?? [];
      if (existing.some((t) => t.type === "server")) {
        console.warn(`[tabStore] removeWorktreeTabs is DROPPING server tab for ${worktreeId}`, new Error().stack);
      }
      const idsToRemove = new Set(existing.map((t) => t.id));
      const restInputs: Record<string, TabLabelInputs> = {};
      for (const [k, v] of Object.entries(state.labelInputs)) {
        if (!idsToRemove.has(k)) restInputs[k] = v;
      }
      const { [worktreeId]: _tabs, ...restTabs } = state.tabs;
      const { [worktreeId]: _activeTab, ...restActiveTabId } = state.activeTabId;
      return {
        tabs: restTabs,
        activeTabId: restActiveTabId,
        labelInputs: restInputs,
      };
    }),

  clearStore: () =>
    set({
      tabs: {},
      activeTabId: {},
      disconnectedTabs: new Set<string>(),
      labelInputs: {},
    }),

  setTabTitle: (worktreeId, tabId, title) =>
    set((state) => applyLabelInput(state, worktreeId, tabId, { titleFromOsc: title })),

  setTabProcess: (worktreeId, tabId, process) =>
    set((state) => applyLabelInput(state, worktreeId, tabId, { foregroundProcess: process })),

  setTabCwd: (worktreeId, tabId, cwd) =>
    set((state) => applyLabelInput(state, worktreeId, tabId, { cwd })),
}));
