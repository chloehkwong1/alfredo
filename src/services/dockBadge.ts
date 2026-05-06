import type { Worktree } from "../types";
import { computeEffectiveStatus, NEEDS_YOU_STATES } from "../components/sidebar/AgentItem";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { getAppConfig, setDockBadge } from "../api";

export interface BadgeCountInput {
  worktrees: Worktree[];
  seen: Set<string>;
  unread: Set<string>;
  notificationsEnabled: boolean;
}

export function computeBadgeCount(input: BadgeCountInput): number {
  if (!input.notificationsEnabled) return 0;

  let count = 0;
  for (const wt of input.worktrees) {
    if (wt.archived) continue;
    const isSeen = input.seen.has(wt.id);
    const isUnread = input.unread.has(wt.id);
    const effectiveSeen = isSeen && !isUnread;
    const status = computeEffectiveStatus(
      wt.agentStatus,
      wt.channelAlive,
      wt.staleBusy,
      effectiveSeen,
      wt.justCreated,
    );
    if (NEEDS_YOU_STATES.has(status)) count += 1;
  }
  return count;
}

let started = false;
let cachedNotificationsEnabled = false;
let lastSentCount = -1;
let pendingTimer: number | null = null;

const DEBOUNCE_MS = 150;

async function refreshConfigSnapshot(): Promise<void> {
  try {
    const cfg = await getAppConfig();
    cachedNotificationsEnabled = cfg.notifications?.enabled === true;
    scheduleSync();
  } catch {
    // If config read fails, leave the previous snapshot in place.
  }
}

function scheduleSync(): void {
  if (pendingTimer !== null) return;
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null;
    void sync();
  }, DEBOUNCE_MS);
}

async function sync(): Promise<void> {
  const { worktrees, seenWorktrees, unreadWorktrees } =
    useWorkspaceStore.getState();
  const count = computeBadgeCount({
    worktrees,
    seen: seenWorktrees,
    unread: unreadWorktrees,
    notificationsEnabled: cachedNotificationsEnabled,
  });
  if (count === lastSentCount) return;
  lastSentCount = count;
  try {
    await setDockBadge(count);
  } catch {
    // Reset so the next change re-attempts even if the IPC blipped.
    lastSentCount = -1;
  }
}

/**
 * Start the singleton dock-badge mirror. Safe to call more than once;
 * subsequent calls are no-ops.
 *
 * Subscribes to:
 *   - workspaceStore (worktrees, seen/unread sets)
 *   - the `config-changed` window event (notifications.enabled toggle)
 *
 * Always clears the OS badge on startup, so a stale badge from a previous
 * session doesn't outlive a settings change made while the app was closed.
 */
export function startDockBadgeMirror(): void {
  if (started) return;
  started = true;

  useWorkspaceStore.subscribe(scheduleSync);
  window.addEventListener("config-changed", () => {
    void refreshConfigSnapshot();
  });

  // Prime: load config, then schedule a first sync. Also force a 0 send
  // so any stale OS badge from a prior process is cleared even if the
  // computed count is also 0.
  setDockBadge(0).catch(() => {});
  void refreshConfigSnapshot();
}
