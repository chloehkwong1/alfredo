import { prepareConflictHandoff } from "../api";
import { ensureAgentSession, writeToSession, focusAgentTab } from "./agentMessenger";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { Worktree } from "../types";

/**
 * Hand a conflicted restack to the worktree's own Claude session: the backend
 * leaves the conflicted rebase in place, and the resolution prompt is pasted
 * into the agent tab we then jump to.
 *
 * The prompt is written WITHOUT a trailing newline, matching the PR
 * merge-conflict path (`prActions.mergeAndFix`): submitting it immediately
 * hides the handoff inside an already-running turn, so the user is left in the
 * tab with no idea where the instruction went. Pasted, it sits in the input
 * where they can read, edit, and send it.
 *
 * Throws so callers can surface the failure in whatever surface they own.
 */
export async function resolveStackConflict(worktree: Worktree): Promise<void> {
  const prompt = await prepareConflictHandoff(worktree.repoPath, worktree.name);
  if (prompt === "__no_conflict__") return;

  const session = await ensureAgentSession(worktree.id, worktree.repoPath, worktree.branch);
  if (!session?.sessionId) {
    throw new Error("worktree has no live agent session — reopen its terminal first");
  }
  await writeToSession(session.sessionId, prompt);

  useWorkspaceStore.getState().setActiveWorktree(worktree.id);
  focusAgentTab(worktree.id);
}
