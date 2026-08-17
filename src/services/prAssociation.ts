import { setPrAssociation, getPrByNumber, findPrForBranch } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { usePrStore } from "../stores/prStore";
import { useToastStore } from "../stores/toastStore";
import type { KanbanColumn, PrStatus, PrStatusWithColumn, Worktree } from "../types";

// Worktrees already reconciled this app run (success or "no PR exists"), and
// per-worktree failure counts so an offline boot retries on later ticks
// without hammering the API forever.
const reconciled = new Set<string>();
const attempts = new Map<string, number>();
const MAX_ATTEMPTS = 3;

// Columns that mean "this worktree is tracking a real PR". The branch
// fallback (findPrForBranch) is only safe to fire for these — a plain
// toDo/inProgress/blocked worktree may sit on a branch that once had a
// closed PR (reused branch name), and firing the fallback there would
// auto-Done a card that was never associated with that PR.
const PR_TRACKING_COLUMNS: ReadonlySet<KanbanColumn> = new Set(["draftPr", "openPr", "needsReview", "done"]);

// Guards a single in-flight reconcile pass. Every `github:pr-update` emit
// (fast + enriched phases) fires reconcileStalePrs fire-and-forget, so
// without this two overlapping passes double-fetch and double-toast.
let inFlight = false;

export function _resetForTests(): void {
  reconciled.clear();
  attempts.clear();
  inFlight = false;
}

function toAssociation(pr: PrStatus) {
  return { number: pr.number, url: pr.url, title: pr.title, state: pr.state, merged: pr.merged };
}

function associationChanged(prev: PrStatus | null | undefined, next: PrStatus): boolean {
  if (!prev) return true;
  return (
    prev.number !== next.number ||
    prev.state !== next.state ||
    prev.merged !== next.merged ||
    prev.title !== next.title ||
    prev.url !== next.url
  );
}

/** Persist changed PR associations for a sync tick's patches. Call BEFORE
 *  applyWorktreePatches so the store still holds the previous prStatus. */
export function persistAssociationsFromPatches(patches: Map<string, Partial<Worktree>>): void {
  const worktrees = useWorkspaceStore.getState().worktrees;
  for (const [wtId, patch] of patches) {
    const pr = patch.prStatus;
    if (!pr) continue;
    const wt = worktrees.find((w) => w.id === wtId);
    if (!wt || !associationChanged(wt.prStatus, pr)) continue;
    setPrAssociation(wt.repoPath, wt.name, toAssociation(pr)).catch((e) =>
      console.warn("[pr-association] persist failed:", wtId, e),
    );
  }
}

function toastMessage(resolved: { number: number; merged: boolean }[]): string {
  if (resolved.length === 1) {
    const r = resolved[0];
    return `While you were away: PR #${r.number} ${r.merged ? "merged" : "closed"} — moved to Done`;
  }
  const merged = resolved.filter((r) => r.merged).length;
  const closed = resolved.length - merged;
  const parts: string[] = [];
  if (closed > 0) parts.push(`${closed} PR${closed > 1 ? "s" : ""} closed`);
  if (merged > 0) parts.push(closed > 0 ? `${merged} merged` : `${merged} PR${merged > 1 ? "s" : ""} merged`);
  return `While you were away: ${parts.join(", ")} — moved to Done`;
}

/**
 * Reconcile worktrees whose PR is absent from the sync payload (aged out of
 * the 30-closed-PR window while the app was off). Each result flows through
 * the SAME applyPrUpdates path a live sync uses, so auto-Done, the persisted
 * Done column, and the sidebar summary behave identically.
 */
export async function reconcileStalePrs(payloadPrs: PrStatusWithColumn[]): Promise<void> {
  if (inFlight) return; // an overlapping pass is already running; the next tick retries
  inFlight = true;
  try {
    await runReconcile(payloadPrs);
  } finally {
    inFlight = false;
  }
}

async function runReconcile(payloadPrs: PrStatusWithColumn[]): Promise<void> {
  const inPayload = new Set(payloadPrs.map((pr) => `${pr.repoPath}::${pr.branch}`));
  // Repos actually present in this payload. A repo's poll can fail
  // independently (e.g. transient rate limit) — when it does, its PRs are
  // simply absent, and every one of its worktrees would otherwise look
  // "stale" and burn its retry budget on nothing. Only treat a worktree as
  // a genuine reconcile candidate when we heard from its repo at all.
  const syncedRepos = new Set(payloadPrs.map((pr) => pr.repoPath));

  const eligible = useWorkspaceStore.getState().worktrees.filter(
    (wt) => !wt.archived && !wt.creating && !wt.isBranchMode && !reconciled.has(wt.id),
  );

  // Already-settled cards: hydrated prStatus is terminal AND the column is
  // already Done. Nothing left to reconcile — a reopened PR reappears in a
  // future payload's open set and is handled by live sync. Skip the fetch
  // entirely rather than re-confirming the same terminal state every launch.
  const alreadySettledIds = new Set(
    eligible
      .filter((wt) => wt.column === "done" && wt.prStatus && (wt.prStatus.merged || wt.prStatus.state === "closed"))
      .map((wt) => wt.id),
  );
  for (const id of alreadySettledIds) reconciled.add(id);

  const candidates = eligible.filter(
    (wt) =>
      !alreadySettledIds.has(wt.id) &&
      (attempts.get(wt.id) ?? 0) < MAX_ATTEMPTS &&
      !inPayload.has(`${wt.repoPath}::${wt.branch}`) &&
      syncedRepos.has(wt.repoPath),
  );
  if (candidates.length === 0) return;

  const resolved: { number: number; merged: boolean }[] = [];
  for (const wt of candidates) {
    attempts.set(wt.id, (attempts.get(wt.id) ?? 0) + 1);
    let pr: PrStatus | null;
    try {
      // The branch fallback (no persisted PR number) is only safe for
      // worktrees already in a PR-tracking column — a plain toDo/inProgress
      // worktree can sit on a reused branch name that once had a closed PR,
      // and firing the fallback there would auto-Done it falsely.
      if (wt.prStatus?.number) {
        pr = await getPrByNumber(wt.repoPath, wt.prStatus.number);
      } else if (PR_TRACKING_COLUMNS.has(wt.column)) {
        pr = await findPrForBranch(wt.repoPath, wt.branch);
      } else {
        reconciled.add(wt.id);
        continue;
      }
    } catch (e) {
      console.warn("[pr-association] reconcile fetch failed:", wt.id, e);
      continue; // stays un-reconciled — retried next tick, capped by MAX_ATTEMPTS
    }
    reconciled.add(wt.id);
    if (!pr) continue; // no PR for this branch — plain worktree, nothing to do

    const terminal = pr.merged || pr.state === "closed";
    const wasDone = wt.column === "done";
    // Non-terminal reconciles must not disturb an active manual column
    // override. applyPrUpdates only keeps an override when its
    // autoColumnWhenSet still matches the PR's autoColumn (prStore.ts) — so
    // passing wt.column verbatim here would look like a real auto-column
    // change and silently delete the user's manual placement. Pass the
    // override's own autoColumnWhenSet instead, so the comparison sees no
    // change and the override survives.
    const activeOverride = usePrStore.getState().columnOverrides[wt.id];
    const autoColumn = terminal ? "done" : (activeOverride ? activeOverride.autoColumnWhenSet : wt.column);
    const prWithColumn: PrStatusWithColumn = {
      ...pr,
      branch: wt.branch, // fetched-by-number PRs must key back to this worktree
      autoColumn,
      repoPath: wt.repoPath,
      checkRuns: [],
      reviews: [],
      comments: null,
      reviewRequested: false,
    };
    const patches = usePrStore.getState().applyPrUpdates(
      [prWithColumn],
      useWorkspaceStore.getState().worktrees,
    );
    useWorkspaceStore.getState().applyWorktreePatches(patches);
    setPrAssociation(wt.repoPath, wt.name, toAssociation(pr)).catch((e) =>
      console.warn("[pr-association] persist failed:", wt.id, e),
    );
    // Toast only for worktrees that actually landed in Done as a result of
    // this reconcile — an active manual override can keep a terminal PR's
    // card out of Done (autoColumn above stays non-"done" in that case), and
    // that must not be reported as "moved to Done". Read the column the
    // patch actually produced rather than re-deriving `terminal` here.
    const newColumn = patches.get(wt.id)?.column;
    if (newColumn === "done" && !wasDone) resolved.push({ number: pr.number, merged: pr.merged });
  }

  if (resolved.length > 0) {
    useToastStore.getState().show({ message: toastMessage(resolved) });
  }
}
