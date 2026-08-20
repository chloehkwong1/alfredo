import { createWorktreeFrom, listWorktrees } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
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
    if (!pr.reviewRequested) continue;
    const worktreeId = `${pr.repoPath}::${pr.branch}`;
    if (inFlight.has(worktreeId)) continue;
    if (useWorkspaceStore.getState().worktrees.some((wt) => wt.id === worktreeId)) continue;

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
        // the user dismisses it (spec: no dedicated retry loop).
        useWorkspaceStore.getState().failWorktree(worktreeId, message);
      }
    } finally {
      inFlight.delete(worktreeId);
    }
  }
}
