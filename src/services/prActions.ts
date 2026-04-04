import type { CheckRun, WorkflowRunLog } from "../types";
import { rerunFailedChecks as apiRerunFailedChecks, getWorkflowLog } from "../api";
import { getAgentSessionInfo, writeToSession } from "./agentMessenger";
import { sessionManager } from "./sessionManager";

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
 * agent session for the given worktree.
 * Returns true if the prompt was successfully sent.
 */
export async function fixFailingChecks(
  worktreeId: string,
  repoPath: string,
  failedCheckRuns: CheckRun[],
): Promise<boolean> {
  // Collect unique check suite IDs
  const suiteIds = new Set<number>();
  for (const run of failedCheckRuns) {
    if (run.checkSuiteId != null) {
      suiteIds.add(run.checkSuiteId);
    }
  }

  if (suiteIds.size === 0) return false;

  // Fetch workflow logs for each suite
  const allLogs: WorkflowRunLog[] = [];
  const logResults = await Promise.allSettled(
    [...suiteIds].map((id) => getWorkflowLog(repoPath, id)),
  );
  for (const result of logResults) {
    if (result.status === "fulfilled") {
      allLogs.push(...result.value);
    }
  }

  // Build prompt
  let prompt = "\nThe following CI checks are failing on this branch. Please investigate and fix:\n\n";
  if (allLogs.length > 0) {
    for (const log of allLogs) {
      prompt += `### ${log.jobName} / ${log.stepName}\n\`\`\`\n${log.logExcerpt}\n\`\`\`\n\n`;
    }
  } else {
    // Fallback: list failing check names without logs
    for (const run of failedCheckRuns) {
      prompt += `- ${run.name} (${run.conclusion})\n`;
    }
    prompt += "\nNo log excerpts were available. Please check the CI output.\n";
  }

  return sendToAgent(worktreeId, prompt);
}

/**
 * Build a merge conflict resolution prompt and send it to the agent.
 * Returns true if the prompt was successfully sent.
 */
export async function fixMergeConflicts(
  worktreeId: string,
  baseBranch: string,
): Promise<boolean> {
  const prompt =
    `\nThis branch has merge conflicts with \`${baseBranch}\`. ` +
    `Please fetch the latest changes from \`${baseBranch}\`, identify the conflicts, ` +
    `resolve them intelligently, and commit the resolution.\n`;

  return sendToAgent(worktreeId, prompt);
}

/**
 * Send a text prompt to the active Claude Code session for a worktree.
 * Looks up the Claude tab's session; if no session exists, returns false
 * (the caller should spawn one).
 */
function sendToAgent(worktreeId: string, prompt: string): boolean {
  const { sessionKey } = getAgentSessionInfo(worktreeId);

  const session = sessionManager.getSession(sessionKey);
  if (!session || !session.sessionId) return false;

  writeToSession(session.sessionId, prompt).catch(console.error);
  return true;
}
