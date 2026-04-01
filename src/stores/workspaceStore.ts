import { create } from "zustand";
import type {
  Annotation,
  DiffViewMode,
  KanbanColumn,
  Worktree,
} from "../types";

interface WorkspaceState {
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  /** Tracks which worktrees the user has "seen" while idle/waiting. */
  seenWorktrees: Set<string>;
  /** Inline annotations per worktree. Keyed by worktreeId. */
  annotations: Record<string, Annotation[]>;
  /** Diff view mode per worktree. Keyed by worktreeId. */
  diffViewMode: Record<string, DiffViewMode>;
  /** Changes panel tab per worktree. Keyed by worktreeId. */
  changesViewMode: Record<string, "changes" | "commits" | "pr">;
  /** Whether the changes panel is collapsed per worktree. Keyed by worktreeId. */
  changesPanelCollapsed: Record<string, boolean>;
  /** Whether to show PR comments inline in the diff view. Keyed by worktreeId. */
  showPrComments: Record<string, boolean>;
  setShowPrComments: (worktreeId: string, show: boolean) => void;
  /** Whether the sidebar is collapsed. */
  sidebarCollapsed: boolean;
  /** Number of days after merging before a worktree is auto-archived. */
  archiveAfterDays: number;
  /** Number of days after archiving before a worktree is auto-deleted. 0 = never. */
  deleteAfterDays: number;
  /** Tracks the currently running dev server, if any. */
  runningServer: { worktreeId: string; sessionId: string; tabId: string } | null;

  addWorktree: (worktree: Worktree) => void;
  replaceWorktree: (tempId: string, realWorktree: Worktree) => void;
  failWorktree: (tempId: string, error: string) => void;
  removeWorktree: (id: string) => void;
  archiveWorktree: (id: string) => void;
  unarchiveWorktree: (id: string) => void;
  updateWorktree: (id: string, patch: Partial<Worktree>) => void;
  setManualColumn: (id: string, column: KanbanColumn) => void;
  moveWorktreeToFront: (id: string) => void;
  reorderWorktrees: (reordered: Worktree[]) => void;
  setActiveWorktree: (id: string | null) => void;
  setWorktrees: (worktrees: Worktree[]) => void;
  applyWorktreePatches: (patches: Map<string, Partial<Worktree>>) => void;
  markWorktreeSeen: (id: string) => void;
  addAnnotation: (annotation: Annotation) => void;
  editAnnotation: (worktreeId: string, annotationId: string, newText: string) => void;
  removeAnnotation: (worktreeId: string, annotationId: string) => void;
  clearAnnotations: (worktreeId: string) => void;
  setDiffViewMode: (worktreeId: string, mode: DiffViewMode) => void;
  setChangesViewMode: (worktreeId: string, mode: "changes" | "commits" | "pr") => void;
  setChangesPanelCollapsed: (worktreeId: string, collapsed: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setWorktreesForRepo: (repoPath: string, worktrees: Worktree[]) => void;
  clearWorktreesForRepo: (repoPath: string) => void;
  clearStore: () => void;
  setRunningServer: (server: { worktreeId: string; sessionId: string; tabId: string } | null) => void;
}

/**
 * Compute the best "last activity" timestamp for a worktree by taking the max of:
 * - Last commit epoch on the branch (from git)
 * - PR updatedAt (from GitHub API) — not used here since PR updates come via prStore
 * - Agent state changes (tracked as Date.now() when agent status changes)
 * - Previous lastActivityAt (preserves prior PR-driven updates)
 */
function withActivityTimestamps(
  incoming: Worktree[],
  existing: Worktree[],
): Worktree[] {
  const existingMap = new Map(existing.map((w) => [w.id, w]));
  return incoming.map((wt) => {
    const prev = existingMap.get(wt.id);

    // Candidates for "last activity" — take the max of all available signals
    const candidates: number[] = [];
    if (wt.lastCommitEpoch) candidates.push(wt.lastCommitEpoch);
    if (prev?.lastActivityAt) candidates.push(prev.lastActivityAt);

    // Agent status change counts as activity
    if (prev && prev.agentStatus !== wt.agentStatus) {
      candidates.push(Date.now());
    }

    const lastActivityAt = candidates.length > 0 ? Math.max(...candidates) : wt.lastCommitEpoch;

    return { ...wt, lastActivityAt };
  });
}

/**
 * Merge fresh git worktree data with existing enriched state (PR status, column, agent status, archived).
 * Used by both setWorktrees and setWorktreesForRepo to avoid duplicating this logic.
 */
function mergeWorktreeState(fresh: Worktree[], existing: Worktree[]): Worktree[] {
  const existingMap = new Map(existing.map((wt) => [wt.id, wt]));
  const merged = fresh.map((wt) => {
    const old = existingMap.get(wt.id);
    if (old) {
      return {
        ...wt,
        prStatus: old.prStatus,
        column: old.column,
        agentStatus: old.agentStatus,
        channelAlive: old.channelAlive,
        staleBusy: old.staleBusy,
        archived: old.archived,
        archivedAt: old.archivedAt,
        claudeSessionId: old.claudeSessionId,
        linearTicketUrl: old.linearTicketUrl,
        linearTicketIdentifier: old.linearTicketIdentifier,
        justCreated: old.justCreated,
        stackParent: wt.stackParent !== undefined ? wt.stackParent : old.stackParent,
        stackChildren: wt.stackChildren !== undefined ? wt.stackChildren : old.stackChildren,
        stackRebaseStatus: wt.stackRebaseStatus !== undefined ? wt.stackRebaseStatus : old.stackRebaseStatus,
      };
    }
    return wt;
  });
  // Preserve creating/errored placeholders — they don't exist on disk yet.
  // Exclude any whose ID already appears in the fresh data (creation completed between refreshes).
  const freshIds = new Set(fresh.map((wt) => wt.id));
  const placeholders = existing.filter((wt) => (wt.creating || wt.createError) && !freshIds.has(wt.id));
  return [...withActivityTimestamps(merged, existing), ...placeholders];
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  worktrees: [],
  activeWorktreeId: null,
  seenWorktrees: new Set<string>(),
  annotations: {},
  diffViewMode: {},
  changesViewMode: {},
  changesPanelCollapsed: {},
  showPrComments: {},
  sidebarCollapsed: false,
  archiveAfterDays: 2,
  deleteAfterDays: 7,
  runningServer: null,

  addWorktree: (worktree) =>
    set((state) => ({ worktrees: [...state.worktrees, worktree] })),

  replaceWorktree: (tempId, realWorktree) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) =>
        wt.id === tempId
          ? { ...realWorktree, creating: undefined, createError: undefined, justCreated: true }
          : wt,
      ),
    })),

  failWorktree: (tempId, error) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) =>
        wt.id === tempId
          ? { ...wt, creating: undefined, createError: error }
          : wt,
      ),
    })),

  removeWorktree: (id) =>
    set((state) => {
      const { [id]: _annotations, ...restAnnotations } = state.annotations;
      const newSeen = new Set(state.seenWorktrees);
      newSeen.delete(id);
      return {
        worktrees: state.worktrees.filter((wt) => wt.id !== id),
        activeWorktreeId: state.activeWorktreeId === id ? null : state.activeWorktreeId,
        annotations: restAnnotations,
        seenWorktrees: newSeen,
        runningServer: state.runningServer?.worktreeId === id ? null : state.runningServer,
      };
    }),

  archiveWorktree: (id) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) =>
        wt.id === id ? { ...wt, archived: true, archivedAt: Date.now() } : wt,
      ),
    })),

  unarchiveWorktree: (id) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) =>
        wt.id === id ? { ...wt, archived: false, archivedAt: undefined } : wt,
      ),
    })),

  updateWorktree: (id, patch) =>
    set((state) => {
      // When agent starts working, clear the "seen" flag
      const newSeen = new Set(state.seenWorktrees);
      if (patch.agentStatus === "busy") {
        newSeen.delete(id);
      }
      return {
        worktrees: state.worktrees.map((wt) => {
          if (wt.id !== id) return wt;
          // Update lastActivityAt when agent status changes
          const activityPatch =
            patch.agentStatus && patch.agentStatus !== wt.agentStatus
              ? { lastActivityAt: Date.now() }
              : {};
          return { ...wt, ...patch, ...activityPatch };
        }),
        seenWorktrees: newSeen,
      };
    }),

  setManualColumn: (id, column) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) =>
        wt.id === id ? { ...wt, column } : wt,
      ),
    })),

  moveWorktreeToFront: (id) =>
    set((state) => {
      const idx = state.worktrees.findIndex((wt) => wt.id === id);
      if (idx <= 0) return state;
      const item = state.worktrees[idx];
      const rest = [...state.worktrees.slice(0, idx), ...state.worktrees.slice(idx + 1)];
      return { worktrees: [item, ...rest] };
    }),

  reorderWorktrees: (reordered) => set({ worktrees: reordered }),

  setActiveWorktree: (id) =>
    set((state) => ({
      activeWorktreeId: id,
      worktrees: state.worktrees.map((wt) =>
        wt.id === id && wt.justCreated ? { ...wt, justCreated: undefined } : wt,
      ),
    })),

  setWorktrees: (freshWorktrees) =>
    set((state) => ({
      worktrees: mergeWorktreeState(freshWorktrees, state.worktrees),
    })),

  applyWorktreePatches: (patches) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) => {
        const patch = patches.get(wt.id);
        return patch ? { ...wt, ...patch } : wt;
      }),
    })),

  markWorktreeSeen: (id) =>
    set((state) => ({
      seenWorktrees: new Set(state.seenWorktrees).add(id),
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

  editAnnotation: (worktreeId, annotationId, newText) =>
    set((state) => ({
      annotations: {
        ...state.annotations,
        [worktreeId]: (state.annotations[worktreeId] || []).map((a) =>
          a.id === annotationId ? { ...a, text: newText } : a,
        ),
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

  setDiffViewMode: (worktreeId, mode) =>
    set((state) => ({
      diffViewMode: { ...state.diffViewMode, [worktreeId]: mode },
    })),

  setChangesViewMode: (worktreeId, mode) =>
    set((state) => ({
      changesViewMode: { ...state.changesViewMode, [worktreeId]: mode },
    })),

  setChangesPanelCollapsed: (worktreeId, collapsed) =>
    set((state) => ({
      changesPanelCollapsed: { ...state.changesPanelCollapsed, [worktreeId]: collapsed },
    })),

  setShowPrComments: (worktreeId, show) =>
    set((s) => ({ showPrComments: { ...s.showPrComments, [worktreeId]: show } })),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed }),

  setWorktreesForRepo: (repoPath, freshWorktrees) =>
    set((state) => {
      const otherRepoWorktrees = state.worktrees.filter((wt) => wt.repoPath !== repoPath);
      const existingForRepo = state.worktrees.filter((wt) => wt.repoPath === repoPath);
      return { worktrees: [...otherRepoWorktrees, ...mergeWorktreeState(freshWorktrees, existingForRepo)] };
    }),

  clearWorktreesForRepo: (repoPath) =>
    set((state) => ({
      worktrees: state.worktrees.filter((wt) => wt.repoPath !== repoPath),
    })),

  clearStore: () =>
    set({
      worktrees: [],
      activeWorktreeId: null,
      seenWorktrees: new Set<string>(),
      annotations: {},
      diffViewMode: {},
      changesViewMode: {},
      changesPanelCollapsed: {},
      showPrComments: {},
      sidebarCollapsed: false,
      archiveAfterDays: 2,
      deleteAfterDays: 7,
      runningServer: null,
    }),

  setRunningServer: (server) => set({ runningServer: server }),
}));
