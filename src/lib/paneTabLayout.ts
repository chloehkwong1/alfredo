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

/**
 * Greedily place tabs left-to-right until they no longer fit `containerWidth`,
 * overflowing the remainder. When anything overflows, reserve `triggerWidth`
 * for the "⋯" button. Always keeps at least the first tab visible.
 */
export function splitByWidth<T>(
  tabs: T[],
  widths: number[],
  containerWidth: number,
  triggerWidth = 0,
): { visible: T[]; overflow: T[] } {
  const total = widths.reduce((a, b) => a + b, 0);
  if (total <= containerWidth) return { visible: tabs, overflow: [] };

  const budget = containerWidth - triggerWidth;
  const visible: T[] = [];
  let used = 0;
  for (let i = 0; i < tabs.length; i++) {
    const next = used + widths[i];
    if (visible.length > 0 && next > budget) break;
    visible.push(tabs[i]);
    used = next;
  }
  return { visible, overflow: tabs.slice(visible.length) };
}

/** A "session" is anything that runs in the pane as a terminal-style view —
 *  agents, shells, and the dev server. (Everything except diff and notes.) */
export function isSessionTab(t: WorkspaceTab): boolean {
  return t.type !== "diff" && t.type !== "notes";
}

/** Split a pane's tabs into the leftmost Notes singleton, the session tabs
 *  (Row 1), and the diff tabs (Row 2), each preserving original order. */
export function partitionPaneTabs(tabs: WorkspaceTab[]): {
  notes: WorkspaceTab | undefined;
  sessions: WorkspaceTab[];
  diffs: WorkspaceTab[];
} {
  return {
    notes: tabs.find((t) => t.type === "notes"),
    sessions: tabs.filter(isSessionTab),
    diffs: tabs.filter((t) => t.type === "diff"),
  };
}

/**
 * Two-way "jump to/from the agent" target. From an agent tab, return the
 * last-focused non-agent (else the first non-agent). From anything else,
 * return the active/last agent. Undefined if no target exists.
 */
export function tabSwitchTarget(
  tabs: WorkspaceTab[],
  activeTabId: string | undefined,
  lastFocusedAgentTabId: string | undefined,
  lastFocusedNonAgentTabId: string | undefined,
): string | undefined {
  const active = tabs.find((t) => t.id === activeTabId);
  if (active && isAgentTab(active)) {
    const remembered = tabs.find(
      (t) => t.id === lastFocusedNonAgentTabId && !isAgentTab(t),
    );
    return (remembered ?? tabs.find((t) => !isAgentTab(t)))?.id;
  }
  return pinnedAgentTab(tabs, activeTabId, lastFocusedAgentTabId)?.id;
}
