import type { CheckRun, WorkflowRunLog } from "../types";
import { rerunFailedChecks as apiRerunFailedChecks, getWorkflowLog, gitMerge, gitPushForceWithLease } from "../api";
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
 * Fetch failure logs for failed checks, build a prompt, and send it to the
 * agent session for the given worktree. Auto-spawns a session if needed.
 * Returns true if the prompt was successfully sent.
 */
export async function fixFailingChecks(
  worktreeId: string,
  repoPath: string,
  branch: string,
  failedCheckRuns: CheckRun[],
): Promise<boolean> {
  // Collect unique check suite IDs
  const suiteIds = new Set<number>();
  for (const run of failedCheckRuns) {
    if (run.checkSuiteId != null) {
      suiteIds.add(run.checkSuiteId);
    }
  }

  // Fetch workflow logs for each suite (skip if no suite IDs)
  const allLogs: WorkflowRunLog[] = [];
  if (suiteIds.size > 0) {
    const logResults = await Promise.allSettled(
      [...suiteIds].map((id) => getWorkflowLog(repoPath, id)),
    );
    for (const result of logResults) {
      if (result.status === "fulfilled") {
        allLogs.push(...result.value);
      }
    }
  }

  // Build prompt
  let prompt = "\nThe following CI checks are failing on this branch. Please investigate and fix:\n\n";
  if (allLogs.length > 0) {
    for (const log of allLogs) {
      prompt += `### ${log.jobName} / ${log.stepName}\n\`\`\`\n${log.logExcerpt}\n\`\`\`\n\n`;
    }
  } else {
    // Fallback: list failing check names with htmlUrl so agent can check logs
    for (const run of failedCheckRuns) {
      prompt += `- ${run.name} (${run.conclusion}) — ${run.htmlUrl}\n`;
    }
    prompt += "\nNo log excerpts were available. Please check the CI output at the URLs above.\n";
  }

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
