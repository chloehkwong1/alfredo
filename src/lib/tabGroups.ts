import type { TabType, WorkspaceTab } from "../types";

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
