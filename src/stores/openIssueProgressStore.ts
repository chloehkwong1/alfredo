import { create } from "zustand";

export interface OpenIssueStatus {
  /** Worktree being created — the overlay only shows while this is the active
   *  worktree, so browsing other worktrees isn't blocked. */
  worktreeId: string;
  /** Issue identifier (or branch, when there's no identifier) being opened. */
  label: string;
  /** Short repo name the worktree is being created in. */
  repo: string;
}

interface OpenIssueProgressState {
  status: OpenIssueStatus | null;
  start: (status: OpenIssueStatus) => void;
  stop: () => void;
}

/**
 * Drives the {@link OpenIssueOverlay}. `openIssueInRepo` calls `start()` when a
 * Linear issue begins opening (worktree create → Claude boot → prompt paste) and
 * `stop()` once the prompt lands or the flow bails.
 */
export const useOpenIssueProgress = create<OpenIssueProgressState>((set) => ({
  status: null,
  start: (status) => set({ status }),
  stop: () => set({ status: null }),
}));
