import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { PrUpdatePayload, StackRebaseStatus, StackPendingAction } from "../types";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { usePrStore } from "../stores/prStore";
import { useToastStore } from "../stores/toastStore";
import { getPrFiles, setSyncRepoPaths, runArchiveScript } from "../api";
import { stopServerAndReleasePort } from "../services/portReclaim";
import { shouldAutoArchive } from "../lib/autoArchive";
import { lifecycleManager } from "../services/lifecycleManager";
import { resolveStackConflict } from "../services/stackConflictHandoff";

/** Worktree name → the id of its open conflict toast. A rebase conflict blocks
 *  the whole stack, so the toast never times out — which means something has to
 *  take it down. These entries let a resolution (or a repeat conflict on the
 *  same branch) replace the bar instead of stacking identical ones up. */
const conflictToastIds = new Map<string, string>();

function dismissConflictToast(worktreeName: string) {
  const id = conflictToastIds.get(worktreeName);
  if (!id) return;
  conflictToastIds.delete(worktreeName);
  useToastStore.getState().dismiss(id);
}

/**
 * Listens for `github:pr-update` events from the Rust background sync loop
 * and applies PR status updates to the workspace store.
 * Also auto-archives Done worktrees whose PRs were merged more than
 * `archiveAfterDays` ago.
 */
export function useGithubSync() {
  // Dedupe getPrFiles IPCs across pr-update emits: skip when headSha is unchanged
  // for a given PR number. Cleared/updated only on a successful fetch.
  const lastSeenHeadShaRef = useRef<Map<number, string>>(new Map());
  // Leading-edge throttle for focus-driven re-sync. First focus after idle
  // fires immediately; repeat alt-tabs within the window are coalesced away.
  const lastFocusPollAtRef = useRef<number>(0);

  useEffect(() => {
    const unlisten = listen<PrUpdatePayload>("github:pr-update", async (event) => {
      const patches = usePrStore.getState().applyPrUpdates(
        event.payload.prs,
        useWorkspaceStore.getState().worktrees,
      );
      useWorkspaceStore.getState().applyWorktreePatches(patches);

      // Update diff stats for worktrees that have PRs — use GitHub API for accuracy.
      // Skip the IPC when the PR's headSha matches the last successful fetch:
      // files haven't changed, so additions/deletions can't have either.
      for (const [wtId, patch] of patches) {
        if (patch.prStatus?.number) {
          const prNumber = patch.prStatus.number;
          const headSha = patch.prStatus.headSha;
          const lastSha = lastSeenHeadShaRef.current.get(prNumber);
          if (headSha && lastSha === headSha) continue;
          const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === wtId);
          if (wt) {
            getPrFiles(wt.repoPath, prNumber)
              .then((files) => {
                const additions = files.reduce((sum, f) => sum + f.additions, 0);
                const deletions = files.reduce((sum, f) => sum + f.deletions, 0);
                useWorkspaceStore.getState().updateWorktree(wtId, { additions, deletions });
                if (headSha) lastSeenHeadShaRef.current.set(prNumber, headSha);
              })
              .catch((e) => console.warn("[github-sync] Failed to fetch PR files for", wtId, e));
          }
        }
      }

      // Auto-archive check: batch-archive Done worktrees that have been
      // idle long enough. Use mergedAt if available, fall back to lastActivityAt
      // so worktrees without a merged PR still get cleaned up.
      // Gate on archiveAfterDays > 0 so 0 means "off" (parity with deleteAfterDays below).
      const state = useWorkspaceStore.getState();
      const now = Date.now();
      const toArchive: string[] = [];
      if (state.archiveAfterDays > 0) {
        const archiveAfterMs = state.archiveAfterDays * 24 * 60 * 60 * 1000;
        state.worktrees
          .filter((wt) =>
            shouldAutoArchive(wt, {
              now,
              archiveAfterMs,
              hasRunningServer: !!state.runningServers[wt.id],
            }),
          )
          .forEach((wt) => toArchive.push(wt.id));
      }

      if (toArchive.length > 0) {
        // Run archive scripts before marking as archived
        const worktreesToArchive = state.worktrees.filter((wt) => toArchive.includes(wt.id));
        for (const wt of worktreesToArchive) {
          try {
            await runArchiveScript(wt.repoPath, wt.path);
          } catch (e) {
            console.warn("[github-sync] Archive script failed for", wt.id, e);
          }
          await stopServerAndReleasePort(wt, "auto-archive");
        }

        useWorkspaceStore.setState((s) => ({
          worktrees: s.worktrees.map((wt) =>
            toArchive.includes(wt.id) ? { ...wt, archived: true, archivedAt: now, unarchivedAt: undefined } : wt,
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
          stackPending: null,
          lastStackAction: { action: "restacked", at: Date.now() },
        });
      }
      dismissConflictToast(worktreeName);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // stack:rebase-conflict — mark worktree status as conflict
  useEffect(() => {
    const unlisten = listen<string>("stack:rebase-conflict", (event) => {
      const worktreeName = event.payload;
      const wt = useWorkspaceStore.getState().worktrees.find((w) => w.name === worktreeName);
      if (!wt) return;
      useWorkspaceStore.getState().updateWorktree(wt.id, {
        stackRebaseStatus: { kind: "conflict" },
      });

      // The sidebar badge is easy to miss on a long list, and the stack popover
      // that holds the resolve action is two clicks away behind the glyph.
      dismissConflictToast(worktreeName);
      const id = useToastStore.getState().show({
        message: `Rebase conflict on ${wt.branch}`,
        durationMs: 0,
        action: {
          label: "Have Claude resolve",
          onClick: () => {
            conflictToastIds.delete(worktreeName);
            resolveStackConflict(wt).catch((e) => {
              console.error("Conflict handoff failed:", e);
              useToastStore.getState().show({
                message: `Handoff failed: ${e instanceof Error ? e.message : e}`,
              });
            });
          },
        },
      });
      conflictToastIds.set(worktreeName, id);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // stack:parent-merged — clear stackParent from the worktree
  useEffect(() => {
    const unlisten = listen<string>("stack:parent-merged", (event) => {
      const worktreeName = event.payload;
      const wt = useWorkspaceStore.getState().worktrees.find((w) => w.name === worktreeName);
      if (wt) {
        // A conflicted merged-parent dissolve still fires this event (the
        // stack relationship is dissolved either way — see stack_manager's
        // `DissolveFailure::Conflicted` handling), but the rebase itself was
        // aborted and the branch never moved. `stack:rebase-conflict` always
        // lands first and flips stackRebaseStatus to "conflict", so use that
        // as the signal to skip the false "moved onto main" trace. stackParent
        // and stackPending still clear — the config-level relationship really
        // is gone.
        const wasConflicted = wt.stackRebaseStatus?.kind === "conflict";
        useWorkspaceStore.getState().updateWorktree(wt.id, {
          stackParent: null,
          stackPending: null,
          ...(wasConflicted ? {} : { lastStackAction: { action: "moved onto main", at: Date.now() } }),
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
        // The poll is the authority on whether the conflict still stands: once
        // it reports anything else, a sticky bar offering to resolve it is lying.
        if (status.kind !== "conflict") dismissConflictToast(worktreeName);
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // stack:pending-update — a merged-parent restack was queued/deferred (or resolved)
  useEffect(() => {
    const unlisten = listen<{ repoPath: string; worktreeName: string; pending: StackPendingAction | null }>(
      "stack:pending-update",
      (event) => {
        const { repoPath, worktreeName, pending } = event.payload;
        // Matched on repo too: worktree names aren't unique across repos, and
        // matching on name alone can apply another repo's pending state here.
        const wt = useWorkspaceStore
          .getState()
          .worktrees.find((w) => w.name === worktreeName && w.repoPath === repoPath);
        if (wt) {
          useWorkspaceStore.getState().updateWorktree(wt.id, { stackPending: pending });
        }
      },
    );
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Surface auth errors so the user knows sync is broken for a repo
  useEffect(() => {
    const unlisten = listen<string>("github:auth-error", (event) => {
      useWorkspaceStore.getState().setGithubAuthError(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Clear auth errors for repos that successfully synced PRs
  useEffect(() => {
    const unlisten = listen<PrUpdatePayload>("github:pr-update", (event) => {
      const { githubAuthErrors, clearGithubAuthError } = useWorkspaceStore.getState();
      if (githubAuthErrors.size === 0) return;
      const syncedRepos = new Set(event.payload.prs.map((pr) => pr.repoPath));
      for (const repo of syncedRepos) {
        if (githubAuthErrors.has(repo)) clearGithubAuthError(repo);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Re-sync when the window regains focus so PR data catches up after
  // macOS App Nap or long background periods. Leading-edge throttle: the
  // defining workflow is alt-tabbing from GitHub back to Alfredo to confirm
  // a change just shipped — the first focus after idle MUST fire immediately.
  // Repeat focus flickers within 30 s coalesce into nothing.
  useEffect(() => {
    const FOCUS_THROTTLE_MS = 30_000;
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (!focused) return;
      const now = Date.now();
      if (now - lastFocusPollAtRef.current < FOCUS_THROTTLE_MS) return;
      const worktrees = useWorkspaceStore.getState().worktrees;
      const repos = [...new Set(worktrees.map((wt) => wt.repoPath))];
      if (repos.length === 0) return;
      lastFocusPollAtRef.current = now;
      const branches = worktrees.filter((wt) => !wt.archived).map((wt) => wt.branch);
      setSyncRepoPaths(repos, branches).catch((e) => console.warn('[github-sync] Failed to re-sync on focus:', e));
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
