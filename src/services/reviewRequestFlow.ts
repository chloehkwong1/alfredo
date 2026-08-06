import { createWorktreeFrom, listWorktrees } from "../api";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { writeToSession, focusAgentTab } from "./agentMessenger";
import { waitForAgentReady, waitForSpawnedSession } from "./openIssueFlow";
import type { PrStatusWithColumn, Worktree } from "../types";

/** What the first-open paste needs to know about a review-requested PR. */
interface PendingReviewPrompt {
  number: number;
  title: string;
  author: string | null;
  url: string;
  baseBranch: string | null;
}

// Worktrees auto-created this app run whose review prompt hasn't been pasted
// yet. In-memory on purpose: after a restart the sessions are restored and a
// surprise paste into an existing session would be worse than no paste.
const pendingReviewPrompts = new Map<string, PendingReviewPrompt>();

// Creations currently in flight — the 60s poll can re-deliver the same PR
// before createWorktreeFrom resolves and the placeholder lands in the store.
const inFlight = new Set<string>();

export function buildReviewPrompt(pr: PendingReviewPrompt): string {
  return [
    `Review PR #${pr.number}: ${pr.title}`,
    `Author: ${pr.author ?? "unknown"}`,
    pr.url,
    "",
    `This PR's branch is checked out in this worktree. Walk me through the diff against ${pr.baseBranch ?? "the base branch"} and review it: correctness first, then design, tests, and anything risky or unclear.`,
  ].join("\n");
}

/**
 * Create worktrees for review-requested PRs that don't have one yet.
 * Mirrors openIssueFlow's create sequence (placeholder → create → replace →
 * ensureDefaultTabs) but never spawns an agent session — Claude launches on
 * first click via pasteReviewPromptOnActivation.
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
        column: "needsReview",
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
        // Needs Review immediately instead of waiting for the next sync tick.
        useWorkspaceStore.getState().updateWorktree(worktreeId, {
          column: "needsReview",
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
          },
        });
        pendingReviewPrompts.set(worktreeId, {
          number: pr.number,
          title: pr.title,
          author: pr.author ?? null,
          url: pr.url,
          baseBranch: pr.baseBranch ?? null,
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

/**
 * First activation of an auto-created review worktree: the terminal mounts and
 * usePty spawns Claude (usePty stays the SOLE spawner); once the session
 * exists and boot output settles, paste the review prompt for the user to
 * edit + submit. Never auto-submits.
 */
export async function pasteReviewPromptOnActivation(worktreeId: string): Promise<void> {
  const pending = pendingReviewPrompts.get(worktreeId);
  if (!pending) return;
  const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === worktreeId);
  if (!wt || wt.creating) return; // placeholder clicked mid-create — keep pending
  pendingReviewPrompts.delete(worktreeId); // claim before awaiting — no double paste
  focusAgentTab(worktreeId);
  const session = await waitForSpawnedSession(worktreeId);
  if (!session?.sessionId) return;
  await waitForAgentReady(session);
  await writeToSession(session.sessionId, buildReviewPrompt(pending));
}
