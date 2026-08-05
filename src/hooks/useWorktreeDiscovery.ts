import { useEffect, useRef } from "react";
import { adoptWorktree, countWorktrees, listWorktrees } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import { lifecycleManager } from "../services/lifecycleManager";
import type { RepoEntry } from "../types";

const POLL_MS = 10_000;
/** Every Nth tick reconciles via a full listing even when counts match —
 *  covers a same-tick add+delete, which leaves the count unchanged. */
const FULL_RECONCILE_EVERY = 6;

export interface DiscoveryInput {
  /** Baseline ids from a previous tick; undefined until the first successful
   *  listing for this repo (the baseline tick must adopt nothing — at startup
   *  every existing worktree would otherwise look "new" and get re-set-up). */
  known: Set<string> | undefined;
  freshWorktrees: Array<{ id: string; path: string }>;
  /** Paths of this repo's real (non-isBranchMode) worktrees already in the
   *  store, captured before this tick's setWorktreesForRepo runs. Worktree
   *  ids are `{repo_path}::{branch}` (see git_manager.rs worktree_id), so a
   *  `git checkout -b` inside an existing worktree changes its id while the
   *  path stays put — that must not read as an external creation. Requiring
   *  path novelty (in addition to id novelty) is what tells a branch switch
   *  apart from a real `git worktree add`. */
  knownPaths: Set<string>;
}

export interface DiscoveryDecision {
  /** Ids that appeared since the baseline at a genuinely new path —
   *  externally created, to adopt. */
  adoptIds: string[];
  /** The baseline to record for the next tick. */
  nextKnown: Set<string>;
}

export function computeDiscovery({ known, freshWorktrees, knownPaths }: DiscoveryInput): DiscoveryDecision {
  const nextKnown = new Set(freshWorktrees.map((wt) => wt.id));
  if (!known) {
    return { adoptIds: [], nextKnown };
  }
  const adoptIds = freshWorktrees
    .filter((wt) => !known.has(wt.id) && !knownPaths.has(wt.path))
    .map((wt) => wt.id);
  return { adoptIds, nextKnown };
}

/** Store worktrees that vanished from disk and must be removed through the
 *  lifecycle path (PTY close, tab/layout/port/session cleanup) — a silent
 *  merge-drop would leak a running claude with no UI left to kill it.
 *  `creating` and `createError` placeholders exist only in the store, never
 *  on disk, so their absence from a listing means nothing.
 *
 *  A missing id alone does not mean the worktree is gone. Ids carry the branch
 *  (`{repo_path}::{branch}`), and the branch token is not stable: a `git
 *  checkout -b`, or a rebase that finishes on a detached HEAD (where
 *  git_manager falls back to the directory name), re-ids a worktree that never
 *  left disk. Removal is destructive — it force-deletes the directory — so it
 *  requires the path to be absent too, the mirror of the path-novelty rule
 *  `computeDiscovery` uses to tell a branch switch from a real worktree add. */
export function computeRemovals(
  storeWts: Array<{ id: string; path: string; creating?: boolean; createError?: string }>,
  freshIds: Set<string>,
  freshPaths: Set<string>,
): string[] {
  return storeWts
    .filter(
      (wt) =>
        !wt.creating && !wt.createError && !freshIds.has(wt.id) && !freshPaths.has(wt.path),
    )
    .map((wt) => wt.id);
}

async function pollRepo(
  repo: string,
  knownIds: Map<string, Set<string>>,
  fullTick: boolean,
  isCancelled: () => boolean,
): Promise<void> {
  const ws = useWorkspaceStore.getState();
  // Restore gate: inserting before useSessionRestore's phase 1 completes
  // would mount terminals without resume ids (see useSessionRestore.ts:359).
  if (!ws.restoredRepos.has(repo)) return;
  const storeWts = ws.worktrees.filter((wt) => wt.repoPath === repo && !wt.isBranchMode);
  // A creation is mid-flight: its worktree hits disk before create_worktree
  // returns, and adopting it here would run setup twice. Skip the whole tick
  // (baselining it as "known" now would also permanently skip adoption).
  if (storeWts.some((wt) => wt.creating)) return;

  try {
    if (!fullTick && knownIds.has(repo)) {
      const diskCount = await countWorktrees(repo);
      // Effect re-ran (repo deselected / mode changed) while we awaited —
      // any store write now would resurrect state the newer effect owns.
      if (isCancelled()) return;
      // createError placeholders exist only in the store, never on disk.
      const storeCount = storeWts.filter((wt) => !wt.createError).length;
      if (diskCount === storeCount) return;
    }

    const fresh = await listWorktrees(repo);
    if (isCancelled()) return;
    // Re-check after the awaits: a create may have started meanwhile.
    if (
      useWorkspaceStore.getState().worktrees.some((wt) => wt.repoPath === repo && wt.creating)
    ) {
      return;
    }

    const decision = computeDiscovery({
      known: knownIds.get(repo),
      freshWorktrees: fresh.map((wt) => ({ id: wt.id, path: wt.path })),
      knownPaths: new Set(storeWts.map((wt) => wt.path)),
    });
    // Record before any async adoption work so a slow adopt_worktree can't be
    // re-triggered by the next tick.
    knownIds.set(repo, decision.nextKnown);

    // Externally-deleted worktrees go through the lifecycle path, not a
    // silent merge-drop: it closes PTY sessions (a running claude would
    // otherwise keep running with no UI to kill it), clears tab/layout/PR
    // state, releases the dev-server port, prunes the git admin entry and
    // repo-config leftovers, and deletes the session file. The backend
    // delete is best-effort and tolerates the directory already being gone.
    // Re-snapshot for removals: a UI-initiated delete that completed while we
    // awaited has already run this cleanup, and the stale snapshot would run
    // it twice.
    const currentWts = useWorkspaceStore
      .getState()
      .worktrees.filter((wt) => wt.repoPath === repo && !wt.isBranchMode);
    const freshIds = new Set(fresh.map((wt) => wt.id));
    const freshPaths = new Set(fresh.map((wt) => wt.path));
    const byId = new Map(currentWts.map((wt) => [wt.id, wt]));
    for (const removedId of computeRemovals(currentWts, freshIds, freshPaths)) {
      const gone = byId.get(removedId);
      if (!gone) continue;
      await lifecycleManager
        .removeWorktree(gone.id, repo, gone.name)
        .catch((e) => console.warn(`[worktree-discovery] cleanup failed for ${gone.path}:`, e));
      if (isCancelled()) return;
    }

    useWorkspaceStore.getState().setWorktreesForRepo(repo, fresh);

    for (const id of decision.adoptIds) {
      const wt = fresh.find((w) => w.id === id);
      if (!wt) continue;
      // Brand-new worktree: no persisted session exists, so fresh default
      // tabs + layout are correct (mirrors useSessionRestore's insert path).
      useTabStore.getState().ensureDefaultTabs(id);
      if (!useLayoutStore.getState().layout[id]) {
        const tabs = useTabStore.getState().tabs[id] ?? [];
        const activeTabId = useTabStore.getState().activeTabId[id] ?? "";
        useLayoutStore.getState().initLayout(id, tabs.map((t) => t.id), activeTabId);
      }
      // Unread badge announces the arrival in the sidebar.
      useWorkspaceStore.getState().markWorktreeUnread(id);
      // Set the flag BEFORE the invoke: if the backend's setup-complete
      // event beats the invoke response (fast scripts), its clear must win —
      // so this side only ever sets upfront and clears on "no scripts ran".
      // Repos without create scripts see the flag flash until the invoke
      // resolves false, which is quick.
      useWorkspaceStore.getState().updateWorktree(id, { setupInProgress: true });
      adoptWorktree(repo, wt.path, id)
        .then((setupInProgress) => {
          if (!setupInProgress) {
            useWorkspaceStore.getState().updateWorktree(id, { setupInProgress: false });
          }
        })
        .catch((e) => {
          console.warn(`[worktree-discovery] adopt failed for ${wt.path}:`, e);
          useWorkspaceStore.getState().updateWorktree(id, { setupInProgress: false });
        });
    }
  } catch (e) {
    // Poll failures are non-fatal; the next tick is the retry.
    console.warn(`[worktree-discovery] poll failed for ${repo}:`, e);
  }
}

/**
 * Detects worktrees created or deleted outside Alfredo (e.g. Claude running
 * `git worktree add`) and reconciles the sidebar: cheap count check every
 * POLL_MS per selected worktree-mode repo, full list reconcile on mismatch
 * or every FULL_RECONCILE_EVERY-th tick. New worktrees are adopted — default
 * tabs, unread badge, and create-time provisioning via adopt_worktree.
 */
export function useWorktreeDiscovery(
  repoPath: string | null,
  selectedRepos: string[],
  repos: RepoEntry[],
) {
  // Baselines survive effect re-runs (repo toggles) deliberately: a reselected
  // repo's worktrees are already known and must not be re-adopted.
  const knownIds = useRef(new Map<string, Set<string>>());
  const tickCount = useRef(0);
  const inFlight = useRef(false);

  const selectedReposKey = selectedRepos.join(",");
  const repoModeKey = repos.map((r) => `${r.path}:${r.mode}`).join(",");

  useEffect(() => {
    if (!repoPath) return;
    // Guards stale async work from writing after this effect is superseded:
    // clearInterval stops future ticks but not one already mid-await, and an
    // uncancelled tick would re-insert a just-deselected repo's worktrees
    // (same pattern as useSessionRestore's cancelled flag).
    let cancelled = false;
    const isCancelled = () => cancelled;
    const interval = setInterval(async () => {
      if (inFlight.current) return;
      inFlight.current = true;
      tickCount.current += 1;
      const fullTick = tickCount.current % FULL_RECONCILE_EVERY === 0;
      try {
        const reposToPoll = selectedRepos.length > 0 ? selectedRepos : [repoPath];
        const modeMap = new Map(repos.map((r) => [r.path, r.mode]));
        for (const repo of reposToPoll) {
          if (cancelled) return;
          if (modeMap.get(repo) === "branch") continue;
          await pollRepo(repo, knownIds.current, fullTick, isCancelled);
        }
      } finally {
        inFlight.current = false;
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // selectedRepos/repos are read via their stable keys; the closure values
    // are from the same render as the keys, so this is not stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, selectedReposKey, repoModeKey]);
}
