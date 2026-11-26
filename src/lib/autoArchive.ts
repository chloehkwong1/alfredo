import type { WorktreeDirtyState } from "../api";
import type { Worktree } from "../types";

/**
 * Whether a Done worktree has been idle long enough to archive automatically.
 *
 * Age is measured from the PR merge time when there is one, falling back to
 * general activity; a worktree with neither is never auto-archived.
 */
export function shouldAutoArchive(
  wt: Worktree,
  opts: { now: number; archiveAfterMs: number; hasRunningServer: boolean },
): boolean {
  const { now, archiveAfterMs, hasRunningServer } = opts;

  if (wt.column !== "done" || wt.archived) return false;

  // A live dev server means the user is working in this worktree right now, and
  // archiving stops the server. The age check can't tell the difference on its
  // own: it reads mergedAt (frozen once merged) and lastActivityAt (written only
  // on agent-status changes), neither of which a server restart touches.
  if (hasRunningServer) return false;

  // Honour a manual unarchive for a full cycle before reconsidering.
  if (wt.unarchivedAt && now - wt.unarchivedAt < archiveAfterMs) return false;

  const refTime = wt.prStatus?.mergedAt
    ? new Date(wt.prStatus.mergedAt).getTime()
    : wt.lastActivityAt;
  return refTime != null && now - refTime >= archiveAfterMs;
}

/** Why auto-delete must leave an archived worktree alone, or null when it may
 *  delete it. Ignored files never block: every worktree has some. */
export function autoDeleteBlocker(
  check: WorktreeDirtyState | "checkFailed",
): "checkFailed" | "unsavedWork" | null {
  if (check === "checkFailed") return "checkFailed";
  return check.untracked.length + check.uncommitted.length > 0 ? "unsavedWork" : null;
}
