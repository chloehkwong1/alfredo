import type { KanbanColumn, Worktree } from "../types";
import { setWorktreeColumns, runArchiveScript } from "../api";
import { stopServerAndReleasePort } from "./portReclaim";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { usePrStore, type ColumnOverride } from "../stores/prStore";

/** Everything a move destroyed that Undo has to put back. Only rows whose repo
 *  actually persisted appear — a rolled-back row is already where it started. */
export interface BulkMoveUndo {
  /** Rows to move back, keyed by the column each one came from. */
  byPriorColumn: Map<KanbanColumn, Worktree[]>;
  /** Rows that lost their pin to the store's unpin-on-entering-done rule. */
  unpinned: string[];
}

export interface BulkResult {
  moved: number;
  failedRepos: string[];
  undo: BulkMoveUndo;
}

/** The store has no "set pinned" — toggling is the only way in, so read fresh
 *  each time and skip rows that are already pinned. */
function repin(ids: Iterable<string>) {
  for (const id of ids) {
    const { pinnedWorktrees, togglePinWorktree } = useWorkspaceStore.getState();
    if (!pinnedWorktrees.has(id)) togglePinWorktree(id);
  }
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
  const { setManualColumn: prSetManualColumn, restoreColumnOverride } = usePrStore.getState();
  // Captured before the first optimistic write: setManualColumn replaces the
  // Set rather than mutating it, so this keeps the pre-move membership and the
  // diff below tells us which rows the store's unpin rule actually touched.
  const pinnedBefore = useWorkspaceStore.getState().pinnedWorktrees;

  // Optimistic first: the rows jump immediately, and registering the manual
  // override stops the next PR sync from stomping the move. The third argument
  // is the column the row is leaving — prStore stores it as autoColumnWhenSet,
  // which is what later decides whether PR sync may reclaim the row. The drag
  // path passes originColumnRef.current here for the same reason.
  //
  // Prior columns and prior overrides are snapshotted per row so a failed
  // repo's optimistic writes can be undone exactly, not approximated.
  const priorColumns = new Map<string, KanbanColumn>();
  const priorOverrides = new Map<string, ColumnOverride | undefined>();
  for (const wt of worktrees) {
    const priorColumn = wt.column;
    priorColumns.set(wt.id, priorColumn);
    priorOverrides.set(wt.id, usePrStore.getState().columnOverrides[wt.id]);
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
      // move, so the rows must not keep showing a column it never persisted,
      // nor keep an override or lose a pin on the strength of that write.
      for (const wt of group) {
        const prior = priorColumns.get(wt.id) ?? wt.column;
        setManualColumn(wt.id, prior);
        restoreColumnOverride(wt.id, priorOverrides.get(wt.id));
      }
      repin(group.filter((wt) => pinnedBefore.has(wt.id)).map((wt) => wt.id));
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

  // Diff the pinned set rather than re-deriving the store's unpin rule here, so
  // Undo stays correct if that rule ever changes.
  const pinnedAfter = useWorkspaceStore.getState().pinnedWorktrees;
  const byPriorColumn = new Map<KanbanColumn, Worktree[]>();
  const unpinned: string[] = [];
  for (const wt of succeeded) {
    if (pinnedBefore.has(wt.id) && !pinnedAfter.has(wt.id)) unpinned.push(wt.id);
    const prior = priorColumns.get(wt.id);
    if (prior === undefined || prior === column) continue;
    const group = byPriorColumn.get(prior);
    if (group) group.push(wt);
    else byPriorColumn.set(prior, [wt]);
  }

  return { moved, failedRepos, undo: { byPriorColumn, unpinned } };
}

/** Reverses a bulk move: the rows go back to the columns they came from and the
 *  pins the move dropped are restored. One call per distinct prior column, not
 *  per row — bulkMoveToColumn already fans out per repo, so this keeps Undo
 *  from re-taking each repo's config lock once a row.
 *
 *  Not a full inverse: a move into Done also stops each row's dev server and
 *  frees its port, and nothing here restarts them. */
export async function undoBulkMove(undo: BulkMoveUndo): Promise<void> {
  for (const [prior, group] of undo.byPriorColumn) {
    await bulkMoveToColumn(group, prior);
  }
  // After the moves: Undo never targets Done, so the unpin rule can't fire
  // again and strip what we just put back.
  repin(undo.unpinned);
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
