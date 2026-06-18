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
 * last-focused working view — a session or diff, never the pinned Notes anchor
 * — falling back to the first such tab. From anything else, return the
 * active/last agent. Undefined if no target exists.
 */
export function tabSwitchTarget(
  tabs: WorkspaceTab[],
  activeTabId: string | undefined,
  lastFocusedAgentTabId: string | undefined,
  lastFocusedNonAgentTabId: string | undefined,
): string | undefined {
  const active = tabs.find((t) => t.id === activeTabId);
  if (active && isAgentTab(active)) {
    // Notes is a pinned anchor and sorts first, so it must be excluded — but
    // diffs are valid targets, so this is not `isSessionTab`.
    const isReturnTarget = (t: WorkspaceTab) =>
      !isAgentTab(t) && t.type !== "notes";
    const remembered = tabs.find(
      (t) => t.id === lastFocusedNonAgentTabId && isReturnTarget(t),
    );
    return (remembered ?? tabs.find(isReturnTarget))?.id;
  }
  return pinnedAgentTab(tabs, activeTabId, lastFocusedAgentTabId)?.id;
}
