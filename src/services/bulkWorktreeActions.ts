import type { KanbanColumn, Worktree } from "../types";
import { setWorktreeColumns } from "../api";
import { stopServerAndReleasePort } from "./portReclaim";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { usePrStore } from "../stores/prStore";

export interface BulkResult {
  moved: number;
  failedRepos: string[];
}

/** One column can hold rows from several repos, and each repo has its own
 *  config file, so every bulk action fans out per repo. */
export function groupByRepo(worktrees: Worktree[]): Map<string, Worktree[]> {
  const grouped = new Map<string, Worktree[]>();
  for (const wt of worktrees) {
    const key = wt.repoPath ?? "";
    const bucket = grouped.get(key);
    if (bucket) bucket.push(wt);
    else grouped.set(key, [wt]);
  }
  return grouped;
}

export async function bulkMoveToColumn(
  worktrees: Worktree[],
  column: KanbanColumn,
): Promise<BulkResult> {
  const { setManualColumn } = useWorkspaceStore.getState();
  const prSetManualColumn = usePrStore.getState().setManualColumn;

  // Optimistic first: the rows jump immediately, and registering the manual
  // override stops the next PR sync from stomping the move. The third argument
  // is the column the row is leaving — prStore stores it as autoColumnWhenSet,
  // which is what later decides whether PR sync may reclaim the row. The drag
  // path passes originColumnRef.current here for the same reason.
  //
  // Prior columns are captured per-worktree so a failed repo's optimistic
  // writes can be rolled back below — without this, rows would keep showing
  // the new column even though the backend never agreed to the move.
  const priorColumns = new Map<string, KanbanColumn>();
  for (const wt of worktrees) {
    const priorColumn = wt.column;
    priorColumns.set(wt.id, priorColumn);
    setManualColumn(wt.id, column);
    prSetManualColumn(wt.id, column, priorColumn);
  }

  const failedRepos: string[] = [];
  let moved = 0;

  for (const [repoPath, group] of groupByRepo(worktrees)) {
    const assignments: Record<string, KanbanColumn> = {};
    for (const wt of group) assignments[wt.name] = column;
    try {
      await setWorktreeColumns(repoPath, assignments);
      moved += group.length;
    } catch (e) {
      console.error("[bulk] move failed for", repoPath, e);
      failedRepos.push(repoPath);
      // Roll back this repo's optimistic writes — the backend rejected the
      // move, so the rows must not keep showing a column it never persisted.
      for (const wt of group) {
        const prior = priorColumns.get(wt.id) ?? wt.column;
        setManualColumn(wt.id, prior);
        prSetManualColumn(wt.id, prior, column);
      }
    }
  }

  if (column === "done") {
    await Promise.allSettled(
      worktrees.map((wt) => stopServerAndReleasePort(wt, "bulk-move")),
    );
  }

  return { moved, failedRepos };
}
