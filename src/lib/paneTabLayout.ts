import type { WorkspaceTab } from "../types";
import { isAgentTab } from "../types";

/**
 * Pick the single agent tab to pin: the active tab if it is an agent, else the
 * last-focused agent, else the first agent in order, else undefined.
 */
export function pinnedAgentTab(
  tabs: WorkspaceTab[],
  activeTabId: string | undefined,
  lastFocusedAgentTabId: string | undefined,
): WorkspaceTab | undefined {
  const active = tabs.find((t) => t.id === activeTabId);
  if (active && isAgentTab(active)) return active;
  const lastFocused = tabs.find(
    (t) => t.id === lastFocusedAgentTabId && isAgentTab(t),
  );
  if (lastFocused) return lastFocused;
  return tabs.find((t) => isAgentTab(t));
}

/**
 * Split a pane's visible tabs (flat mode) into the always-pinned primaries
 * (active/last agent, then diff) and the rest, preserving the original order.
 */
export function partitionFlatTabs(
  tabs: WorkspaceTab[],
  activeTabId: string | undefined,
  lastFocusedAgentTabId: string | undefined,
): { pinned: WorkspaceTab[]; rest: WorkspaceTab[] } {
  const agent = pinnedAgentTab(tabs, activeTabId, lastFocusedAgentTabId);
  const diff = tabs.find((t) => t.type === "diff");
  const pinned = [agent, diff].filter((t): t is WorkspaceTab => t != null);
  const pinnedIds = new Set(pinned.map((t) => t.id));
  const rest = tabs.filter((t) => !pinnedIds.has(t.id));
  return { pinned, rest };
}
