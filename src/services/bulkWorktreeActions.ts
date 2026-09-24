import type { KanbanColumn, Worktree } from "../types";
import { setWorktreeColumns, runArchiveScript } from "../api";
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
  const succeeded: Worktree[] = [];
  let moved = 0;

  for (const [repoPath, group] of groupByRepo(worktrees)) {
    const assignments: Record<string, KanbanColumn> = {};
    for (const wt of group) assignments[wt.name] = column;
    try {
      await setWorktreeColumns(repoPath, assignments);
      moved += group.length;
      succeeded.push(...group);
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
    // Only for worktrees whose repo actually persisted the move — a rolled-back
    // row's column reverted above, so stopping its server and freeing its port
    // here would strand it looking unchanged but with a dead server and no port.
    await Promise.allSettled(
      succeeded.map((wt) => stopServerAndReleasePort(wt, "bulk-move")),
    );
  }

  return { moved, failedRepos };
}

export interface BulkArchiveResult {
  archived: number;
  /** Worktree ids where either the repo archive script or the server-stop /
   *  port-release step failed. They are still archived — a failing stage
   *  must not strand the row on the board. */
  failures: string[];
}

export async function bulkArchive(worktrees: Worktree[]): Promise<BulkArchiveResult> {
  const { archiveWorktree } = useWorkspaceStore.getState();
  // A Set so a worktree that fails both stages is still reported as one
  // failure, not two — the toast count must match the number of affected rows.
  const failedIds = new Set<string>();

  // allSettled, not a bare loop: one failing archive script must not abort
  // the rest of the batch.
  await Promise.allSettled(
    worktrees.map(async (wt) => {
      try {
        await runArchiveScript(wt.repoPath, wt.path);
      } catch (e) {
        console.warn("[bulk] archive script failed:", wt.id, e);
        failedIds.add(wt.id);
      }
      try {
        await stopServerAndReleasePort(wt, "archive");
      } catch (e) {
        console.warn("[bulk] server stop / port release failed:", wt.id, e);
        failedIds.add(wt.id);
      }
    }),
  );

  for (const wt of worktrees) archiveWorktree(wt.id);

  return { archived: worktrees.length, failures: [...failedIds] };
}
