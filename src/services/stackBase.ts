import { changeStackBase, getCommitsBehindMain, getWorktreeDiffStats } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { isTerminalPr } from "../lib/prStatus";
import type { Worktree } from "../types";

/** Change a worktree's stack base and update the sidebar optimistically —
 *  the shared core of the Change-base dialog and the adopt-stack cue.
 *  Throws when the backend change_stack_base fails; the behind-count and
 *  diff-stat probes are fire-and-forget. */
export async function applyStackBaseChange(
  worktree: Worktree,
  nextParent: string | null,
  opts: { expectNoRebase?: boolean } = {},
): Promise<void> {
  await changeStackBase(worktree.repoPath, worktree.name, nextParent, opts.expectNoRebase ?? false);

  // Re-read the live store AFTER the backend call: a concurrent writer
  // (stack:parent-merged handler, detach) may have changed stackParent during
  // the await, and the stackChildren surgery below must run against current
  // facts, not the caller's render-time snapshot. The snapshot is only a
  // fallback for a worktree missing from the store entirely — when the live
  // row exists, its stackParent wins even when that value is null (`??` here
  // would resurrect the stale snapshot exactly when a concurrent writer
  // legitimately cleared it).
  const store = useWorkspaceStore.getState();
  const live = store.worktrees.find((w) => w.id === worktree.id);
  const prevParent = (live ? live.stackParent : worktree.stackParent) ?? null;

  // Optimistically update child + both parents' stackChildren so the
  // sidebar reflects the new shape without waiting for the next
  // list_worktrees refresh or stack-status poll.
  store.updateWorktree(worktree.id, {
    stackParent: nextParent,
    stackRebaseStatus: null,
  });
  // Parent lookups must be scoped to this worktree's repo: the store holds
  // every repo's worktrees in one array, and branch names collide across
  // repos (detectAdoptableParent keys by `${repoPath}::${branch}` for the
  // same reason).
  const findParent = (branch: string) =>
    store.worktrees.find((w) => w.repoPath === worktree.repoPath && w.branch === branch);
  if (prevParent && prevParent !== nextParent) {
    const oldParent = findParent(prevParent);
    if (oldParent) {
      store.updateWorktree(oldParent.id, {
        stackChildren: (oldParent.stackChildren ?? []).filter((id) => id !== worktree.id),
      });
    }
  }
  if (nextParent && nextParent !== prevParent) {
    const newParent = findParent(nextParent);
    if (newParent) {
      const existing = newParent.stackChildren ?? [];
      if (!existing.includes(worktree.id)) {
        store.updateWorktree(newParent.id, {
          stackChildren: [...existing, worktree.id],
        });
      }
    }
  }

  // Populate the "· N behind" indicator now instead of waiting on the
  // next poll. Best-effort: log on failure, the poll will fill it in.
  if (nextParent && nextParent !== prevParent) {
    getCommitsBehindMain(worktree.path, nextParent)
      .then((count) => {
        // Guard against an older response landing after the parent has
        // been changed again — only write if our nextParent is still current.
        const current = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktree.id);
        if (current?.stackParent !== nextParent) return;
        useWorkspaceStore.getState().updateWorktree(worktree.id, {
          stackRebaseStatus: count === 0 ? { kind: "upToDate" } : { kind: "behind", count },
        });
      })
      .catch((e) => console.warn("[change-base] commits-behind probe failed:", e));
  }

  // Re-scope the +/- diff badge to the new base now, instead of waiting for
  // the next agent busy→idle transition. Fire on any real parent change
  // (including clearing back to the default branch). Skip when a live PR
  // exists — that badge is driven by the GitHub PR diff (getPrFiles in
  // usePty), which the local stack parent must not override. A terminal
  // (possibly stale) hydrated prStatus doesn't count as "a PR exists" here —
  // usePty falls back to the local diff for it too, so this refresh must run.
  if (nextParent !== prevParent && !(worktree.prStatus?.number && !isTerminalPr(worktree.prStatus))) {
    getWorktreeDiffStats(worktree.path, nextParent)
      .then(([additions, deletions]) => {
        // Drop a stale response if the parent changed again meanwhile.
        const current = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktree.id);
        if (current?.stackParent !== nextParent) return;
        useWorkspaceStore.getState().updateWorktree(worktree.id, { additions, deletions });
      })
      .catch((e) => console.warn("[change-base] diff-stats refresh failed:", e));
  }
}
