import type { CheckRun } from "../types";
import { rerunFailedChecks as apiRerunFailedChecks } from "../api";
import { ensureAgentSession, writeToSession, focusAgentTab } from "./agentMessenger";

/**
 * Rerun all failed CI checks by calling the GitHub API for each unique check suite.
 * Returns the number of check suites rerun.
 */
export async function rerunFailedChecks(
  repoPath: string,
  failedCheckRuns: CheckRun[],
): Promise<number> {
  const suiteIds = new Set<number>();
  for (const run of failedCheckRuns) {
    if (run.checkSuiteId != null) {
      suiteIds.add(run.checkSuiteId);
    }
  }

  const results = await Promise.allSettled(
    [...suiteIds].map((id) => apiRerunFailedChecks(repoPath, id)),
  );

  return results.filter((r) => r.status === "fulfilled").length;
}

/**
 * Send failing check metadata to the agent and let it investigate.
 * The agent fetches logs itself via `gh run view`, which avoids log
 * extraction bugs and lets it pick the right skill (rerun, debug, etc.).
 */
export async function fixFailingChecks(
  worktreeId: string,
  repoPath: string,
  failedCheckRuns: CheckRun[],
): Promise<boolean> {
  const checkList = failedCheckRuns
    .map((run) => `- **${run.name}** (job ${run.id}, ${run.conclusion}) — ${run.htmlUrl}`)
    .join("\n");

  const prompt =
    `\nThe following CI checks are failing on this branch:\n\n` +
    `${checkList}\n\n` +
    `Diagnose each one first:\n` +
    `- If it looks transient (flaky test, timeout, infra/network error), rerun it with \`gh run rerun <id> --failed\`.\n` +
    `- If it's a real failure (lint, type error, broken test, build error), read the logs with \`gh run view\` / \`gh run view --log-failed\`, find the root cause, propose the fix, and confirm with me before changing code.\n\n` +
    `Do not blanket-fix. Triage first.\n`;

  return sendToAgent(worktreeId, repoPath, prompt);
}

/**
 * Send a prompt to the agent to rebase onto the base branch, resolve any
 * conflicts, and force-push — all in one shot.
 */
export async function mergeAndFix(
  worktreeId: string,
  repoPath: string,
  baseBranch: string,
): Promise<boolean> {
  const prompt =
    `\nThis branch has a merge conflict with \`${baseBranch}\`.\n\n` +
    `Rebase onto \`${baseBranch}\` and resolve conflicts. Only force-push with \`--force-with-lease\` if you are **certain** each conflict resolution is correct — i.e. you understand both sides of the conflict and the intended behavior.\n\n` +
    `If any conflict is ambiguous (overlapping logic changes, unclear intent, renamed/moved code, or you'd be guessing), STOP and ask me before resolving. Do not push a guess.\n`;

  const sent = await sendToAgent(worktreeId, repoPath, prompt);
  if (sent) focusAgentTab(worktreeId);
  return sent;
}

/**
 * Send a text prompt to the agent session for a worktree.
 * Auto-spawns a session if none exists.
 */
async function sendToAgent(
  worktreeId: string,
  repoPath: string,
  prompt: string,
): Promise<boolean> {
  try {
    const session = await ensureAgentSession(worktreeId, repoPath);
    if (!session?.sessionId) return false;
    await writeToSession(session.sessionId, prompt);
    return true;
  } catch (e) {
    console.error("Failed to send to agent:", e);
    return false;
  }
}
