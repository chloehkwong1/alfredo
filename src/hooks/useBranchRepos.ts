import { useState, useEffect, useRef } from "react";
import { getActiveBranch, getWorktreeDiffStats } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { usePrStore } from "../stores/prStore";
import type { RepoEntry, Worktree } from "../types";

export interface BranchRepoState {
  /** Stable ID derived from repo path */
  id: string;
  repoPath: string;
  branch: string | null;
  additions: number | null;
  deletions: number | null;
}

const POLL_INTERVAL = 5_000;

function repoId(path: string): string {
  return `branch::${path}`;
}

export function useBranchRepos(
  repos: RepoEntry[],
  selectedRepos: string[],
  showMainCardRepos: string[] = [],
): BranchRepoState[] {
  const [states, setStates] = useState<BranchRepoState[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  const mainCardSet = new Set(showMainCardRepos);
  const branchRepoPaths = repos
    .filter(
      (r) =>
        selectedRepos.includes(r.path) &&
        (r.mode === "branch" || (r.mode === "worktree" && mainCardSet.has(r.path))),
    )
    .map((r) => r.path);

  useEffect(() => {
    if (branchRepoPaths.length === 0) {
      setStates([]);
      return;
    }

    async function poll() {
      const results = await Promise.all(
        branchRepoPaths.map(async (path) => {
          const [branch, diffStats] = await Promise.all([
            getActiveBranch(path).catch(() => null),
            getWorktreeDiffStats(path).catch(
              () => [null, null] as [number | null, number | null],
            ),
          ]);
          return {
            id: repoId(path),
            repoPath: path,
            branch,
            additions: diffStats[0],
            deletions: diffStats[1],
          };
        }),
      );
      setStates(results);

      // Sync branch & diff stats back to the workspace store so TerminalView
      // and ChangesPanel stay current when the user switches branches externally.
      const updateWorktree = useWorkspaceStore.getState().updateWorktree;
      const removeWorktreeState = usePrStore.getState().removeWorktreeState;
      const currentWorktrees = useWorkspaceStore.getState().worktrees;
      for (const r of results) {
        if (r.branch == null) continue;
        // Pinned-main synthetics can flip branches under us when the user
        // checks out a different branch externally. PR data in workspaceStore
        // and prStore is keyed by worktree id, not branch, so the stale
        // payload from the prior branch hangs on (`applyPrUpdates` skips
        // worktrees with no matching PR rather than clearing them). Reset
        // PR-shaped fields on transition so the next github sync repopulates
        // from scratch — or leaves the card empty if the new branch has no PR.
        const existing = currentWorktrees.find((w) => w.id === r.id);
        // Only treat this as a stale-PR-clearing transition when there's
        // actually prior PR data to clear — avoids a no-op clear on first
        // mount where the pinned-main fallback branch ("main") may not
        // match the actual checked-out branch.
        const branchChanged =
          existing != null && existing.branch !== r.branch && existing.prStatus != null;
        const patch: Partial<Worktree> = {
          branch: r.branch,
          additions: r.additions,
          deletions: r.deletions,
        };
        if (branchChanged) {
          patch.prStatus = null;
          patch.column = "inProgress";
        }
        updateWorktree(r.id, patch);
        if (branchChanged) {
          removeWorktreeState(r.id);
        }
      }
    }

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchRepoPaths.join(",")]);

  return states;
}

export { repoId };
