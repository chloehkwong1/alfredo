import { useState, useEffect, useRef } from "react";
import { getActiveBranch, getWorktreeDiffStats } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { RepoEntry } from "../types";

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
): BranchRepoState[] {
  const [states, setStates] = useState<BranchRepoState[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  const branchRepoPaths = repos
    .filter((r) => r.mode === "branch" && selectedRepos.includes(r.path))
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
      for (const r of results) {
        if (r.branch != null) {
          updateWorktree(r.id, { branch: r.branch, additions: r.additions, deletions: r.deletions });
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
