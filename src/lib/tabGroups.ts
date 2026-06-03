import { isAgentTab } from "../types";
import type { AgentState, TabType, WorkspaceTab } from "../types";

export type TabGroupId = "agents" | "terminals" | "server" | "files";

export const GROUP_ORDER: readonly TabGroupId[] = [
  "agents",
  "terminals",
  "server",
  "files",
] as const;

export const GROUP_LABELS: Record<TabGroupId, string> = {
  agents: "Agents",
  terminals: "Terminals",
  server: "Server",
  files: "Files",
};

const TYPE_TO_GROUP: Partial<Record<TabType, TabGroupId>> = {
  claude: "agents",
  codex: "agents",
  gemini: "agents",
  shell: "terminals",
  server: "server",
  diff: "files",
  // notes intentionally omitted — pinned, outside the group system
};

/** Returns the group a tab belongs to, or null for notes (pinned, not grouped). */
export function getGroupForTab(tab: WorkspaceTab): TabGroupId | null {
  return TYPE_TO_GROUP[tab.type] ?? null;
}

/** Filters `tabs` to those in `group`, preserving original order. */
export function getTabsInGroup(tabs: WorkspaceTab[], group: TabGroupId): WorkspaceTab[] {
  return tabs.filter((t) => getGroupForTab(t) === group);
}

/**
 * Derives the active group from the active tab id. Falls back to "agents"
 * when the active tab is notes, missing, or doesn't map to a group — agents
 * is always the visible default because `ensureDefaultTabs` guarantees one.
 */
export function getActiveGroup(
  activeTabId: string | undefined,
  tabs: WorkspaceTab[],
): TabGroupId {
  const active = tabs.find((t) => t.id === activeTabId);
  if (active) {
    const g = getGroupForTab(active);
    if (g) return g;
  }
  return "agents";
}

export type GroupActivityStatus = "waitingForInput" | "stale" | "busy";

// Priority order — lower index = higher priority.
const STATUS_PRIORITY: GroupActivityStatus[] = ["waitingForInput", "stale", "busy"];

function maxPriority(a: GroupActivityStatus | null, b: GroupActivityStatus | null): GroupActivityStatus | null {
  if (a === null) return b;
  if (b === null) return a;
  return STATUS_PRIORITY.indexOf(a) <= STATUS_PRIORITY.indexOf(b) ? a : b;
}

/**
 * Roll session statuses up to per-group dots, then summarise non-active groups
 * into a single `activeDot` for the group switcher button.
 *
 * Only agent tabs contribute — shell, server, and diff have no activity signal.
 *
 * `staleBusyByTabId` maps tab id → true when the worktree owning that tab is
 * flagged staleBusy. Mirrors the existing PaneTabBar SortableTab logic
 * (busy + staleBusy collapses to "stale").
 */
export function summarizeGroupActivity(
  tabs: WorkspaceTab[],
  statuses: Record<string, AgentState>,
  activeGroup: TabGroupId,
  staleBusyByTabId: Record<string, boolean>,
): {
  activeDot: GroupActivityStatus | null;
  perGroup: Record<TabGroupId, GroupActivityStatus | null>;
} {
  const perGroup: Record<TabGroupId, GroupActivityStatus | null> = {
    agents: null,
    terminals: null,
    server: null,
    files: null,
  };

  for (const tab of tabs) {
    if (!isAgentTab(tab)) continue;
    const group = getGroupForTab(tab);
    if (!group) continue;
    const raw = statuses[tab.id];
    let status: GroupActivityStatus | null = null;
    if (raw === "waitingForInput") status = "waitingForInput";
    else if (raw === "busy") status = staleBusyByTabId[tab.id] ? "stale" : "busy";
    perGroup[group] = maxPriority(perGroup[group], status);
  }

  let activeDot: GroupActivityStatus | null = null;
  for (const g of GROUP_ORDER) {
    if (g === activeGroup) continue;
    activeDot = maxPriority(activeDot, perGroup[g]);
  }
  return { activeDot, perGroup };
}
