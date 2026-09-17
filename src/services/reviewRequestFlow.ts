import { createWorktreeFrom, listWorktrees } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { usePrStore } from "../stores/prStore";
import { useTabStore } from "../stores/tabStore";
import { useToastStore } from "../stores/toastStore";
import type { PrStatusWithColumn, Worktree } from "../types";

// Creations currently in flight — the 60s poll can re-deliver the same PR
// before createWorktreeFrom resolves and the placeholder lands in the store.
const inFlight = new Set<string>();

/**
 * Create worktrees for review-requested PRs that don't have one yet.
 * Mirrors openIssueFlow's create sequence (placeholder → create → replace →
 * ensureDefaultTabs) but never spawns an agent session — Claude launches on
 * first click via usePty when the terminal mounts.
 */
export async function handleReviewRequests(prs: PrStatusWithColumn[]): Promise<void> {
  for (const pr of prs) {
    const worktreeId = `${pr.repoPath}::${pr.branch}`;
    const store = useWorkspaceStore.getState();
    const existing = store.worktrees.find((wt) => wt.id === worktreeId);

    // `reviewRequested` is a level, not an edge: it stays true for as long as
    // you're a requested reviewer. Clearing the marker when the request is
    // withdrawn is what makes a later re-request register as something new —
    // without it, un-archiving below would fight every archive you perform
    // while still assigned to the PR.
    if (!pr.reviewRequested) {
      if (existing?.lastReviewRequestedAt != null) {
        store.updateWorktree(worktreeId, { lastReviewRequestedAt: undefined });
      }
      continue;
    }

    if (inFlight.has(worktreeId)) continue;

    if (existing) {
      // Already recorded this request; nothing to do until it's withdrawn.
      if (existing.lastReviewRequestedAt != null) continue;
      store.updateWorktree(worktreeId, { lastReviewRequestedAt: Date.now() });
      // A fresh request on an archived worktree is review inflow again, and
      // archived worktrees are filtered out of every column by
      // isVisibleWorktree — leaving it archived hides the request completely.
      if (existing.archived) {
        store.unarchiveWorktree(worktreeId);
        // Un-archiving alone isn't enough: a manual placement survives while
        // autoColumn is unchanged (prStore.applyPrUpdates), so a worktree
        // dragged to Done before archiving would resurface inside a collapsed
        // group — invisible again. Drop the override and seed the column the
        // way the create path below does.
        usePrStore.getState().clearManualColumn(worktreeId);
        store.updateWorktree(worktreeId, { column: pr.autoColumn ?? "needsReview" });
      }
      continue;
    }

    inFlight.add(worktreeId);
    try {
      // Store isn't ground truth during hydration; an on-disk worktree will
      // surface on its own — never re-create it (git would error anyway).
      const onDisk = await listWorktrees(pr.repoPath).catch(() => [] as Worktree[]);
      if (onDisk.some((wt) => wt.id === worktreeId)) continue;

      const placeholder: Worktree = {
        id: worktreeId,
        name: pr.branch,
        // Empty path: setup-complete buffer's path-fallback match is a no-op (id-match only)
        path: "",
        branch: pr.branch,
        prStatus: null,
        agentStatus: "notRunning",
        // autoColumn is null only on reconcile-built partial updates, never
        // on the live review-request payloads this flow consumes.
        column: pr.autoColumn ?? "needsReview",
        isBranchMode: false,
        additions: null,
        deletions: null,
        repoPath: pr.repoPath,
        creating: true,
        lastReviewRequestedAt: Date.now(),
      };
      useWorkspaceStore.getState().addWorktree(placeholder);
      try {
        const real = await createWorktreeFrom(pr.repoPath, { kind: "pullRequest", number: pr.number });
        useWorkspaceStore.getState().replaceWorktree(worktreeId, real);
        try {
          useTabStore.getState().ensureDefaultTabs(real.id);
        } catch (e) {
          console.error("[review-requests] ensureDefaultTabs failed:", e);
        }
        // Seed prStatus/column from the PR we already hold so the card sits in
        // the right column immediately instead of waiting for the next sync tick.
        useWorkspaceStore.getState().updateWorktree(worktreeId, {
          column: pr.autoColumn ?? "needsReview",
          // replaceWorktree swaps in the backend's Worktree wholesale, which
          // drops the placeholder's marker — re-stamp it here or the next poll
          // reads this as a brand-new request.
          lastReviewRequestedAt: Date.now(),
          prStatus: {
            number: pr.number,
            state: pr.state,
            title: pr.title,
            url: pr.url,
            draft: pr.draft,
            merged: pr.merged,
            branch: pr.branch,
            baseBranch: pr.baseBranch,
            headSha: pr.headSha,
            body: pr.body,
            mergedAt: pr.mergedAt,
            reviewRequested: true,
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Failed placeholder stays in the store and blocks re-creation until
        // the user dismisses it (spec: no dedicated retry loop). When the
        // placeholder is already gone, there is no tainted card to carry the
        // error — toast instead, mirroring openIssueFlow, so the failed pull
        // isn't completely silent.
        const marked = useWorkspaceStore.getState().failWorktree(worktreeId, message);
        if (!marked) {
          useToastStore.getState().show({ message: `Worktree creation failed: ${message}` });
        }
      }
    } finally {
      inFlight.delete(worktreeId);
    }
  }
}
