import { setPrAssociation, getPrByNumber, findPrForBranch } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { usePrStore } from "../stores/prStore";
import { useToastStore } from "../stores/toastStore";
import type { PrStatus, PrStatusWithColumn, Worktree } from "../types";

// Worktrees already reconciled this app run (success or "no PR exists"), and
// per-worktree failure counts so an offline boot retries on later ticks
// without hammering the API forever.
const reconciled = new Set<string>();
const attempts = new Map<string, number>();
const MAX_ATTEMPTS = 3;

export function _resetForTests(): void {
  reconciled.clear();
  attempts.clear();
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
  const inPayload = new Set(payloadPrs.map((pr) => `${pr.repoPath}::${pr.branch}`));
  const candidates = useWorkspaceStore.getState().worktrees.filter(
    (wt) =>
      !wt.archived &&
      !wt.creating &&
      !wt.isBranchMode &&
      !reconciled.has(wt.id) &&
      (attempts.get(wt.id) ?? 0) < MAX_ATTEMPTS &&
      !inPayload.has(`${wt.repoPath}::${wt.branch}`),
  );
  if (candidates.length === 0) return;

  const resolved: { number: number; merged: boolean }[] = [];
  for (const wt of candidates) {
    attempts.set(wt.id, (attempts.get(wt.id) ?? 0) + 1);
    let pr: PrStatus | null;
    try {
      pr = wt.prStatus?.number
        ? await getPrByNumber(wt.repoPath, wt.prStatus.number)
        : await findPrForBranch(wt.repoPath, wt.branch);
    } catch (e) {
      console.warn("[pr-association] reconcile fetch failed:", wt.id, e);
      continue; // stays un-reconciled — retried next tick, capped by MAX_ATTEMPTS
    }
    reconciled.add(wt.id);
    if (!pr) continue; // no PR for this branch — plain worktree, nothing to do

    const terminal = pr.merged || pr.state === "closed";
    const wasDone = wt.column === "done";
    const prWithColumn: PrStatusWithColumn = {
      ...pr,
      branch: wt.branch, // fetched-by-number PRs must key back to this worktree
      autoColumn: terminal ? "done" : wt.column,
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
    if (terminal && !wasDone) resolved.push({ number: pr.number, merged: pr.merged });
  }

  if (resolved.length > 0) {
    useToastStore.getState().show({ message: toastMessage(resolved) });
  }
}
