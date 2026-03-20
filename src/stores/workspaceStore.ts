import { create } from "zustand";
import type {
  Annotation,
  KanbanColumn,
  PrStatusWithColumn,
  Worktree,
} from "../types";

interface WorkspaceState {
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  /** Tracks manual column overrides (from drag). Keyed by worktree id. */
  columnOverrides: Record<string, KanbanColumn>;
  /** Tracks the last-known PR state per worktree, so we can detect state changes. */
  lastPrState: Record<string, string>;
  /** Tracks which worktrees the user has "seen" while idle/waiting. */
  seenWorktrees: Set<string>;
  /** Active tab per worktree (terminal or changes). Keyed by worktreeId. */
  activeTab: Record<string, "terminal" | "changes">;
  /** Inline annotations per worktree. Keyed by worktreeId. */
  annotations: Record<string, Annotation[]>;
  /** Whether the sidebar is collapsed. */
  sidebarCollapsed: boolean;

  addWorktree: (worktree: Worktree) => void;
  removeWorktree: (id: string) => void;
  updateWorktree: (id: string, patch: Partial<Worktree>) => void;
  setColumn: (id: string, column: KanbanColumn) => void;
  setManualColumn: (id: string, column: KanbanColumn) => void;
  setActiveWorktree: (id: string | null) => void;
  setWorktrees: (worktrees: Worktree[]) => void;
  applyPrUpdates: (prs: PrStatusWithColumn[]) => void;
  markWorktreeSeen: (id: string) => void;
  setActiveTab: (worktreeId: string, tab: "terminal" | "changes") => void;
  addAnnotation: (annotation: Annotation) => void;
  removeAnnotation: (worktreeId: string, annotationId: string) => void;
  clearAnnotations: (worktreeId: string) => void;
  toggleSidebar: () => void;
}

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
  worktrees: [],
  activeWorktreeId: null,
  columnOverrides: {},
  lastPrState: {},
  seenWorktrees: new Set<string>(),
  activeTab: {},
  annotations: {},
  sidebarCollapsed: false,

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

  setActiveTab: (worktreeId, tab) =>
    set((state) => ({
      activeTab: { ...state.activeTab, [worktreeId]: tab },
    })),

  addAnnotation: (annotation) =>
    set((state) => ({
      annotations: {
        ...state.annotations,
        [annotation.worktreeId]: [
          ...(state.annotations[annotation.worktreeId] || []),
          annotation,
        ],
      },
    })),

  removeAnnotation: (worktreeId, annotationId) =>
    set((state) => ({
      annotations: {
        ...state.annotations,
        [worktreeId]: (state.annotations[worktreeId] || []).filter(
          (a) => a.id !== annotationId,
        ),
      },
    })),

  clearAnnotations: (worktreeId) =>
    set((state) => ({
      annotations: {
        ...state.annotations,
        [worktreeId]: [],
      },
    })),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
