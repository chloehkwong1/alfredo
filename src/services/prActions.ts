import type { CheckRun } from "../types";
import { rerunFailedChecks as apiRerunFailedChecks, gitMerge, gitPushForceWithLease } from "../api";
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
 * Run `git merge <baseBranch>` via Tauri, then if there are conflicts,
 * send the conflict list to the agent for resolution.
 * Returns { merged, conflictedFiles } to drive banner state.
 */
export async function mergeAndFix(
  worktreeId: string,
  repoPath: string,
  branch: string,
  baseBranch: string,
): Promise<{ merged: boolean; conflictedFiles: string[] }> {
  const result = await gitMerge(repoPath, baseBranch);

  if (result.success) {
    // Auto-resolved — tell the agent chat what happened so the user sees it
    await sendToAgent(
      worktreeId, repoPath, branch,
      `\nMerged \`${baseBranch}\` into this branch — git auto-resolved all conflicts. Ready to push.\n`,
    );
    focusAgentTab(worktreeId);
    return { merged: true, conflictedFiles: [] };
  }

  // Merge produced conflicts — send to agent
  const fileList = result.conflictedFiles.map((f) => `- ${f}`).join("\n");
  const prompt =
    `\nThis branch has merge conflicts with \`${baseBranch}\`. The merge has already been started.\n` +
    `The following files have conflicts:\n${fileList}\n\n` +
    `Please resolve the conflicts in each file and commit the resolution.\n`;

  await sendToAgent(worktreeId, repoPath, branch, prompt);
  focusAgentTab(worktreeId);

  return { merged: false, conflictedFiles: result.conflictedFiles };
}

/**
 * Push with --force-with-lease via Tauri command.
 */
export async function pushForceWithLease(repoPath: string): Promise<void> {
  await gitPushForceWithLease(repoPath);
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
