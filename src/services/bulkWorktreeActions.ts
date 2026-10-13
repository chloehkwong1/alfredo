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
  /** Rows that were pinned before the move. Undo re-pins all of them, not
   *  just the ones the move unpinned: undoing a move *out of* Done targets
   *  Done, and that replay would otherwise unpin a row the original move
   *  never touched. */
  pinnedBefore: string[];
  /** The prStore override each moved row held *before* the move, or undefined
   *  where it held none. Undo replays a move, and a move always writes a fresh
   *  override, so Undo has to put these back explicitly — see
   *  `restoreColumnOverride`. */
  priorOverrides: Map<string, ColumnOverride | undefined>;
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
    const bucket = grouped.get(wt.repoPath);
    if (bucket) bucket.push(wt);
    else grouped.set(wt.repoPath, [wt]);
  }
  return grouped;
}

export async function bulkMoveToColumn(
  worktrees: Worktree[],
  column: KanbanColumn,
  /** Undo passes false: a move into Done stops each row's dev server and frees
   *  its port, and undoing a move *out of* Done targets Done, so leaving this
   *  on would have Undo destroy servers the original move never touched. */
  { stopServersOnDone = true }: { stopServersOnDone?: boolean } = {},
): Promise<BulkResult> {
  const { setManualColumn } = useWorkspaceStore.getState();
  const { setManualColumn: prSetManualColumn, restoreColumnOverride } = usePrStore.getState();
  // Captured before the first optimistic write: setManualColumn replaces the
  // Set rather than mutating it, so this keeps the pre-move membership for
  // the rollback and Undo paths below.
  const pinnedBefore = useWorkspaceStore.getState().pinnedWorktrees;

  // Optimistic first: the rows jump immediately, and registering the manual
  // override stops the next PR sync from stomping the move. `wt.column` is the
  // column the row is leaving — callers must pass it as such (the drag path
  // restores the dragged row's origin before calling, because handleDragOver
  // has already previewed the drop in the store). prStore stores it as
  // autoColumnWhenSet, which is what later decides whether PR sync may reclaim
  // the row.
  //
  // Prior overrides are snapshotted per row so a failed repo's optimistic
  // writes can be undone exactly, not approximated.
  const priorOverrides = new Map<string, ColumnOverride | undefined>();
  for (const wt of worktrees) {
    priorOverrides.set(wt.id, usePrStore.getState().columnOverrides[wt.id]);
    setManualColumn(wt.id, column);
    prSetManualColumn(wt.id, column, wt.column);
    // Entering Done drops the pin. setManualColumn applies the same rule from
    // the store's view of the previous column, which is wrong whenever the
    // store already shows the target (the drag preview), so decide it here
    // from the origin the caller gave us. No-op when the store already did it.
    if (column === "done" && wt.column !== "done") {
      const { pinnedWorktrees, togglePinWorktree } = useWorkspaceStore.getState();
      if (pinnedWorktrees.has(wt.id)) togglePinWorktree(wt.id);
    }
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
        setManualColumn(wt.id, wt.column);
        restoreColumnOverride(wt.id, priorOverrides.get(wt.id));
      }
      repin(group.filter((wt) => pinnedBefore.has(wt.id)).map((wt) => wt.id));
    }
  }

  if (column === "done" && stopServersOnDone) {
    // Only for worktrees whose repo actually persisted the move — a rolled-back
    // row's column reverted above, so stopping its server and freeing its port
    // here would strand it looking unchanged but with a dead server and no port.
    await Promise.allSettled(
      succeeded.map((wt) => stopServerAndReleasePort(wt, "bulk-move")),
    );
  }

  const byPriorColumn = new Map<KanbanColumn, Worktree[]>();
  const pinnedIds: string[] = [];
  // Every persisted row, not just the ones that changed column: the move wrote
  // an override for all of them, so Undo has to unwind all of them.
  const undoOverrides = new Map<string, ColumnOverride | undefined>();
  for (const wt of succeeded) {
    if (pinnedBefore.has(wt.id)) pinnedIds.push(wt.id);
    undoOverrides.set(wt.id, priorOverrides.get(wt.id));
    if (wt.column === column) continue;
    const group = byPriorColumn.get(wt.column);
    if (group) group.push(wt);
    else byPriorColumn.set(wt.column, [wt]);
  }

  return { moved, failedRepos, undo: { byPriorColumn, pinnedBefore: pinnedIds, priorOverrides: undoOverrides } };
}

/** Reverses a bulk move: the rows go back to the columns they came from, the
 *  overrides the move wrote are unwound, and the pins it dropped are restored.
 *  One call per distinct prior column, not per row — bulkMoveToColumn already
 *  fans out per repo, so this keeps Undo from re-taking each repo's config
 *  lock once a row.
 *
 *  Not a full inverse: a move into Done also stops each row's dev server and
 *  frees its port, and nothing here restarts them. Undo does not stop any
 *  server itself, though — undoing a move out of Done targets Done, and a row
 *  that had a server running before the move must still have it after. */
export async function undoBulkMove(undo: BulkMoveUndo): Promise<void> {
  // bulkMoveToColumn reads each row's *current* column off the object it is
  // handed, so hand it live rows — the snapshots in byPriorColumn still carry
  // the pre-move column, which is the column Undo is moving *to*, and a
  // rollback on a failed undo would "restore" the row there. A row that has
  // since left the board has nothing to go back to.
  const live = useWorkspaceStore.getState().worktrees;
  for (const [prior, group] of undo.byPriorColumn) {
    const rows = group.flatMap((wt) => live.find((w) => w.id === wt.id) ?? []);
    if (rows.length === 0) continue;
    await bulkMoveToColumn(rows, prior, { stopServersOnDone: false });
  }
  // After the moves, which each wrote a fresh override over the top.
  const { restoreColumnOverride } = usePrStore.getState();
  for (const [id, override] of undo.priorOverrides) {
    restoreColumnOverride(id, override);
  }
  // After the moves too: a row moved back into Done would otherwise hit the
  // unpin rule and lose the pin we just restored.
  repin(undo.pinnedBefore);
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
