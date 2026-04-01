import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PrUpdatePayload, StackRebaseStatus } from "../types";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { usePrStore } from "../stores/prStore";
import { getPrFiles, setSyncRepoPaths } from "../api";
import { lifecycleManager } from "../services/lifecycleManager";

/**
 * Listens for `github:pr-update` events from the Rust background sync loop
 * and applies PR status updates to the workspace store.
 * Also auto-archives Done worktrees whose PRs were merged more than
 * `archiveAfterDays` ago.
 */
export function useGithubSync() {
  useEffect(() => {
    const unlisten = listen<PrUpdatePayload>("github:pr-update", async (event) => {
      const patches = usePrStore.getState().applyPrUpdates(
        event.payload.prs,
        useWorkspaceStore.getState().worktrees,
      );
      useWorkspaceStore.getState().applyWorktreePatches(patches);

      // Update diff stats for worktrees that have PRs — use GitHub API for accuracy
      for (const [wtId, patch] of patches) {
        if (patch.prStatus?.number) {
          const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === wtId);
          if (wt && wt.column !== "done") {
            getPrFiles(wt.repoPath, patch.prStatus.number)
              .then((files) => {
                const additions = files.reduce((sum, f) => sum + f.additions, 0);
                const deletions = files.reduce((sum, f) => sum + f.deletions, 0);
                useWorkspaceStore.getState().updateWorktree(wtId, { additions, deletions });
              })
              .catch(() => {}); // Silently fall back to existing local stats
          }
        }
      }

      // Auto-archive check: batch-archive Done worktrees with expired mergedAt
      const state = useWorkspaceStore.getState();
      const archiveAfterMs = state.archiveAfterDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      const toArchive = state.worktrees
        .filter((wt) =>
          wt.column === "done" &&
          !wt.archived &&
          wt.prStatus?.mergedAt &&
          now - new Date(wt.prStatus.mergedAt).getTime() >= archiveAfterMs
        )
        .map((wt) => wt.id);

      if (toArchive.length > 0) {
        useWorkspaceStore.setState((s) => ({
          worktrees: s.worktrees.map((wt) =>
            toArchive.includes(wt.id) ? { ...wt, archived: true, archivedAt: now } : wt,
          ),
        }));
      }

      // Auto-delete check: remove worktrees that have been archived for too long
      const deleteAfterMs = state.deleteAfterDays * 24 * 60 * 60 * 1000;
      if (state.deleteAfterDays > 0) {
        const toDelete = state.worktrees
          .filter((wt) =>
            wt.archived &&
            wt.archivedAt &&
            now - wt.archivedAt >= deleteAfterMs
          );

        for (const wt of toDelete) {
          await lifecycleManager.removeWorktree(wt.id, wt.repoPath, wt.name).catch((e) => console.warn('[github-sync] Failed to remove worktree:', wt.name, e));
        }
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // stack:rebase-complete — mark worktree status as upToDate
  useEffect(() => {
    const unlisten = listen<string>("stack:rebase-complete", (event) => {
      const worktreeName = event.payload;
      const wt = useWorkspaceStore.getState().worktrees.find((w) => w.name === worktreeName);
      if (wt) {
        useWorkspaceStore.getState().updateWorktree(wt.id, {
          stackRebaseStatus: { kind: "upToDate" },
        });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // stack:rebase-conflict — mark worktree status as conflict
  useEffect(() => {
    const unlisten = listen<string>("stack:rebase-conflict", (event) => {
      const worktreeName = event.payload;
      const wt = useWorkspaceStore.getState().worktrees.find((w) => w.name === worktreeName);
      if (wt) {
        useWorkspaceStore.getState().updateWorktree(wt.id, {
          stackRebaseStatus: { kind: "conflict" },
        });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // stack:parent-merged — clear stackParent from the worktree
  useEffect(() => {
    const unlisten = listen<string>("stack:parent-merged", (event) => {
      const worktreeName = event.payload;
      const wt = useWorkspaceStore.getState().worktrees.find((w) => w.name === worktreeName);
      if (wt) {
        useWorkspaceStore.getState().updateWorktree(wt.id, {
          stackParent: null,
        });
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // stack:status-update — update stackRebaseStatus for a worktree
  useEffect(() => {
    const unlisten = listen<{ worktreeName: string; status: StackRebaseStatus }>(
      "stack:status-update",
      (event) => {
        const { worktreeName, status } = event.payload;
        const wt = useWorkspaceStore.getState().worktrees.find((w) => w.name === worktreeName);
        if (wt) {
          useWorkspaceStore.getState().updateWorktree(wt.id, { stackRebaseStatus: status });
        }
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Re-sync when the window regains focus so PR data catches up after
  // macOS App Nap or long background periods.
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      const worktrees = useWorkspaceStore.getState().worktrees;
      const repos = [...new Set(worktrees.map((wt) => wt.repoPath))];
      if (repos.length === 0) return;
      const branches = worktrees.filter((wt) => !wt.archived).map((wt) => wt.branch);
      setSyncRepoPaths(repos, branches).catch((e) => console.warn('[github-sync] Failed to re-sync on focus:', e));
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
