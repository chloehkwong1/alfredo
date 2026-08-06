/**
 * Helpers for moving per-worktree state from one worktree id to another.
 *
 * Worktree ids are `${repoPath}::${branch}` (git_manager.rs `worktree_id`), so
 * a plain `git checkout` inside a worktree gives the same directory a new id.
 * Every store that keys state by worktree id has to follow, or the state is
 * stranded under a key nothing looks up again — tabs disappear from the UI
 * while their PTY keeps running.
 */

/** Move `oldId`'s entry to `newId`. Returns the same object when there's nothing to move. */
export function rekeyRecord<T>(
  record: Record<string, T>,
  oldId: string,
  newId: string,
): Record<string, T> {
  if (!(oldId in record)) return record;
  const { [oldId]: moved, ...rest } = record;
  return { ...rest, [newId]: moved };
}

/** Set equivalent of `rekeyRecord`: membership follows the worktree to its new id. */
export function rekeySet(set: Set<string>, oldId: string, newId: string): Set<string> {
  if (!set.has(oldId)) return set;
  const next = new Set(set);
  next.delete(oldId);
  next.add(newId);
  return next;
}

/** A worktree whose id changed while its directory stayed put. */
export interface WorktreeRekey {
  oldId: string;
  newId: string;
}
