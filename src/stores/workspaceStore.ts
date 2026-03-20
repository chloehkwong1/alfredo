import { create } from "zustand";
import type { KanbanColumn, PrStatusWithColumn, Worktree } from "../types";

interface WorkspaceState {
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  view: "board" | "terminal";
  /** Tracks manual column overrides (from drag). Keyed by worktree id. */
  columnOverrides: Record<string, KanbanColumn>;
  /** Tracks the last-known PR state per worktree, so we can detect state changes. */
  lastPrState: Record<string, string>;
  /** Whether branch mode is active (from config). */
  branchMode: boolean;
  /** The currently checked-out branch name (branch mode only). */
  activeBranch: string | null;
  /** Tracks which worktrees the user has "seen" while idle/waiting. */
  seenWorktrees: Set<string>;

  addWorktree: (worktree: Worktree) => void;
  removeWorktree: (id: string) => void;
  updateWorktree: (id: string, patch: Partial<Worktree>) => void;
  setColumn: (id: string, column: KanbanColumn) => void;
  setManualColumn: (id: string, column: KanbanColumn) => void;
  setActiveWorktree: (id: string | null) => void;
  setView: (view: "board" | "terminal") => void;
  setWorktrees: (worktrees: Worktree[]) => void;
  applyPrUpdates: (prs: PrStatusWithColumn[]) => void;
  setBranchMode: (enabled: boolean) => void;
  setActiveBranch: (branchName: string | null) => void;
  markWorktreeSeen: (id: string) => void;
}

// Demo data so the board isn't empty on first render
const DEMO_WORKTREES: Worktree[] = [
  {
    id: "wt-1",
    name: "feat-auth-flow",
    path: "/tmp/alfredo/worktrees/feat-auth-flow",
    branch: "feat/auth-flow",
    prStatus: null,
    agentStatus: "notRunning",
    column: "inProgress",
    isBranchMode: false,
  },
  {
    id: "wt-2",
    name: "fix-sidebar-crash",
    path: "/tmp/alfredo/worktrees/fix-sidebar-crash",
    branch: "fix/sidebar-crash",
    prStatus: {
      number: 142,
      state: "open",
      title: "Fix sidebar crash on rapid navigation",
      url: "https://github.com/org/repo/pull/142",
      draft: true,
      merged: false,
      branch: "fix/sidebar-crash",
    },
    agentStatus: "idle",
    column: "draftPr",
    isBranchMode: false,
  },
  {
    id: "wt-3",
    name: "refactor-api-layer",
    path: "/tmp/alfredo/worktrees/refactor-api-layer",
    branch: "refactor/api-layer",
    prStatus: {
      number: 138,
      state: "open",
      title: "Refactor API layer to use tanstack-query",
      url: "https://github.com/org/repo/pull/138",
      draft: false,
      merged: false,
      branch: "refactor/api-layer",
    },
    agentStatus: "waitingForInput",
    column: "openPr",
    isBranchMode: false,
  },
];

/**
 * Compute a stable key representing the PR "state" for override-clearing purposes.
 * When this key changes, manual overrides are cleared.
 */
function prStateKey(pr: PrStatusWithColumn): string {
  if (pr.merged) return "merged";
  if (pr.draft) return "draft";
  return "open";
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  worktrees: DEMO_WORKTREES,
  activeWorktreeId: null,
  view: "board",
  columnOverrides: {},
  lastPrState: {},
  branchMode: false,
  activeBranch: null,
  seenWorktrees: new Set<string>(),

  addWorktree: (worktree) =>
    set((state) => ({ worktrees: [...state.worktrees, worktree] })),

  removeWorktree: (id) =>
    set((state) => ({
      worktrees: state.worktrees.filter((wt) => wt.id !== id),
      activeWorktreeId:
        state.activeWorktreeId === id ? null : state.activeWorktreeId,
    })),

  updateWorktree: (id, patch) =>
    set((state) => {
      // When agent starts working, clear the "seen" flag
      const newSeen = new Set(state.seenWorktrees);
      if (patch.agentStatus === "busy") {
        newSeen.delete(id);
      }
      return {
        worktrees: state.worktrees.map((wt) =>
          wt.id === id ? { ...wt, ...patch } : wt,
        ),
        seenWorktrees: newSeen,
      };
    }),

  setColumn: (id, column) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) =>
        wt.id === id ? { ...wt, column } : wt,
      ),
    })),

  /** Manual column override from drag-and-drop. Persisted until PR state changes. */
  setManualColumn: (id, column) =>
    set((state) => ({
      columnOverrides: { ...state.columnOverrides, [id]: column },
      worktrees: state.worktrees.map((wt) =>
        wt.id === id ? { ...wt, column } : wt,
      ),
    })),

  setActiveWorktree: (id) => set({ activeWorktreeId: id }),

  setView: (view) => set({ view }),

  setWorktrees: (worktrees) => set({ worktrees }),

  /**
   * Apply PR status updates from the background sync loop.
   * Matches PRs to worktrees by branch name.
   * Auto-assigns columns unless a manual override is active.
   * Clears manual overrides when the PR state changes.
   */
  applyPrUpdates: (prs) =>
    set((state) => {
      // Index PRs by branch for quick lookup
      const prByBranch = new Map<string, PrStatusWithColumn>();
      for (const pr of prs) {
        prByBranch.set(pr.branch, pr);
      }

      const newOverrides = { ...state.columnOverrides };
      const newLastPrState = { ...state.lastPrState };

      const worktrees = state.worktrees.map((wt) => {
        const pr = prByBranch.get(wt.branch);

        if (!pr) {
          // No PR for this branch — keep existing state
          return wt;
        }

        const currentStateKey = prStateKey(pr);
        const previousStateKey = state.lastPrState[wt.id];

        // If PR state changed, clear any manual override
        if (previousStateKey && previousStateKey !== currentStateKey) {
          delete newOverrides[wt.id];
        }

        newLastPrState[wt.id] = currentStateKey;

        // Build updated PR status (without autoColumn, which is store-only)
        const prStatus = {
          number: pr.number,
          state: pr.state,
          title: pr.title,
          url: pr.url,
          draft: pr.draft,
          merged: pr.merged,
          branch: pr.branch,
        };

        // Use manual override if still active, otherwise auto-assign
        const column = newOverrides[wt.id] ?? pr.autoColumn;

        return { ...wt, prStatus, column };
      });

      return {
        worktrees,
        columnOverrides: newOverrides,
        lastPrState: newLastPrState,
      };
    }),

  markWorktreeSeen: (id) =>
    set((state) => ({
      seenWorktrees: new Set(state.seenWorktrees).add(id),
    })),

  setBranchMode: (enabled) => set({ branchMode: enabled }),

  setActiveBranch: (branchName) => set({ activeBranch: branchName }),
}));
