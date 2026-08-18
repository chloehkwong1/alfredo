import type { Worktree } from "../types";

/** The sidebar's row-visibility rule: archived worktrees live in the archive
 *  section and branch-mode entries aren't rendered as cards. Shared so
 *  consumers that must agree with what the sidebar shows (Sidebar's own
 *  lists, the stack-hue gate) can't drift from it. */
export function isVisibleWorktree(wt: Worktree): boolean {
  return !wt.archived && !wt.isBranchMode;
}
