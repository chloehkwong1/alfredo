import type { Worktree } from "../types";
import { computeEffectiveStatus, NEEDS_YOU_STATES } from "../components/sidebar/AgentItem";

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
