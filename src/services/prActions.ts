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
  branch: string,
  failedCheckRuns: CheckRun[],
): Promise<boolean> {
  const checkList = failedCheckRuns
    .map((run) => `- **${run.name}** (job ${run.id}, ${run.conclusion}) — ${run.htmlUrl}`)
    .join("\n");

  const prompt =
    `\nThe following CI checks are failing on this branch. Please investigate and fix:\n\n` +
    `${checkList}\n`;

  return sendToAgent(worktreeId, repoPath, branch, prompt);
}

/**
 * Send a prompt to the agent to rebase onto the base branch, resolve any
 * conflicts, and force-push — all in one shot.
 */
export async function mergeAndFix(
  worktreeId: string,
  repoPath: string,
  branch: string,
  baseBranch: string,
): Promise<boolean> {
  const prompt =
    `\nThis branch has a merge conflict with \`${baseBranch}\`.\n` +
    `Please rebase this branch onto \`${baseBranch}\`, resolve any conflicts, and force-push with \`--force-with-lease\`.\n`;

  const sent = await sendToAgent(worktreeId, repoPath, branch, prompt);
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
  branch: string,
  prompt: string,
): Promise<boolean> {
  try {
    const session = await ensureAgentSession(worktreeId, repoPath, branch);
    if (!session?.sessionId) return false;
    await writeToSession(session.sessionId, prompt);
    return true;
  } catch (e) {
    console.error("Failed to send to agent:", e);
    return false;
  }
}
