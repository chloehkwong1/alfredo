import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";

/** Stage the Linear prompt + ensure the agent tab exists so the overlay opens prefilled. */
export function stageOverlayPrompt(worktreeId: string, prompt: string) {
  useWorkspaceStore.getState().setPendingPrompt(worktreeId, prompt);
  useTabStore.getState().ensureDefaultTabs(worktreeId);
}

/** Repo default branch for new worktrees. "main" is the safe fallback the create flow uses. */
export function defaultBaseBranch(_repoPath: string): string {
  return "main";
}
