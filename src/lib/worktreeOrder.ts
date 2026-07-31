import type { KanbanColumn, Worktree } from "../types";

/** Persisted manual card order: repoPath → column → worktree names, top-first. */
export type WorktreeOrderMap = Record<string, Partial<Record<KanbanColumn, string[]>>>;

/**
 * Display order for one kanban column's cards — slot-permutation semantics.
 *
 * Every card first gets a default slot from the global key: created epoch
 * (falling back to last-commit epoch, then 0) newest-first, tiebroken by
 * branch then repoPath so the result is fully deterministic regardless of
 * input order. Then, per repo with a persisted list for this column, that
 * repo's listed cards are permuted among *their own* slots to match the
 * saved order. Unlisted cards (new arrivals, whole repos with no saved
 * order, stale names) keep their default slots untouched — so a drag in one
 * repo never moves another repo's cards, and a brand-new card lands at its
 * creation-order slot. Pinned-first grouping happens downstream in
 * StatusGroup.
 */
export function sortColumnWorktrees(
  worktrees: Worktree[],
  column: KanbanColumn,
  orderByRepo: WorktreeOrderMap,
): Worktree[] {
  const base = worktrees.slice().sort((a, b) => {
    const aEpoch = a.createdAtEpoch ?? a.lastCommitEpoch ?? 0;
    const bEpoch = b.createdAtEpoch ?? b.lastCommitEpoch ?? 0;
    if (aEpoch !== bEpoch) return bEpoch - aEpoch;
    const byBranch = a.branch.localeCompare(b.branch);
    if (byBranch !== 0) return byBranch;
    return a.repoPath.localeCompare(b.repoPath);
  });

  const result = base.slice();
  const repoPaths = new Set(base.map((wt) => wt.repoPath));
  for (const repoPath of repoPaths) {
    const list = orderByRepo[repoPath]?.[column];
    if (!list || list.length === 0) continue;
    const rank = new Map(list.map((name, i) => [name, i]));
    const slots: number[] = [];
    const listed: Worktree[] = [];
    base.forEach((wt, idx) => {
      if (wt.repoPath === repoPath && rank.has(wt.name)) {
        slots.push(idx);
        listed.push(wt);
      }
    });
    listed.sort((a, b) => rank.get(a.name)! - rank.get(b.name)!);
    slots.forEach((slot, i) => {
      result[slot] = listed[i];
    });
  }
  return result;
}

/**
 * The names to persist after a drag: one repo's cards in one column, in the
 * order of the `worktrees` list passed in — which must already be in display
 * order (comparator-sorted, with any drag move applied).
 */
export function columnNameOrder(
  worktrees: Worktree[],
  column: KanbanColumn,
  repoPath: string,
): string[] {
  return worktrees
    .filter((wt) => wt.repoPath === repoPath && wt.column === column)
    .map((wt) => wt.name);
}
