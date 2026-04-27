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
  /** Tracks worktrees the user has manually marked as unread. */
  unreadWorktrees: Set<string>;
  /** Tracks worktrees the user has pinned to the top of their column. */
  pinnedWorktrees: Set<string>;
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
  /** Tracks running dev servers per worktree. Keyed by worktreeId. */
  runningServers: Record<string, { sessionId: string; tabId: string; port?: number; createdAt?: number }>;
  /** Repo paths where GitHub auth has failed (token missing/expired). */
  githubAuthErrors: Set<string>;
  setGithubAuthError: (repoPath: string) => void;
  clearGithubAuthError: (repoPath: string) => void;

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
  markWorktreeUnread: (id: string) => void;
  markWorktreeRead: (id: string) => void;
  togglePinWorktree: (id: string) => void;
  addAnnotation: (annotation: Annotation) => void;
  editAnnotation: (worktreeId: string, annotationId: string, newText: string) => void;
  removeAnnotation: (worktreeId: string, annotationId: string) => void;
  clearAnnotations: (worktreeId: string) => void;
  setDiffViewMode: (worktreeId: string, mode: DiffViewMode) => void;
  setChangesViewMode: (worktreeId: string, mode: "changes" | "commits" | "pr") => void;
  setChangesPanelCollapsed: (worktreeId: string, collapsed: boolean) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  /** Pass a `Worktree[]` for the common case, or a builder
   *  `(existing: Worktree[]) => Worktree[]` when the fresh list depends on
   *  the current store state (e.g. to merge in synthetic entries owned by
   *  another effect — the builder runs inside the atomic update so the
   *  read can't tear against a concurrent write). */
  setWorktreesForRepo: (
    repoPath: string,
    worktrees: Worktree[] | ((existing: Worktree[]) => Worktree[]),
  ) => void;
  clearWorktreesForRepo: (repoPath: string) => void;
  clearStore: () => void;
  setRunningServer: (worktreeId: string, server: { sessionId: string; tabId: string; port?: number; createdAt?: number } | null) => void;
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
        unarchivedAt: old.unarchivedAt,
        claudeSessionId: old.claudeSessionId,
        linearTicketUrl: old.linearTicketUrl,
        linearTicketIdentifier: old.linearTicketIdentifier,
        justCreated: old.justCreated,
        stackParent: wt.stackParent !== undefined ? wt.stackParent : old.stackParent,
        stackChildren: wt.stackChildren !== undefined ? wt.stackChildren : old.stackChildren,
        stackRebaseStatus: wt.stackRebaseStatus !== undefined ? wt.stackRebaseStatus : old.stackRebaseStatus,
        // Frontend-only: backend never persists setup script errors, so a
        // refresh would otherwise clobber an unacknowledged error.
        setupScriptError: old.setupScriptError,
      };
    }
    return wt;
  });
  // Preserve in-memory-only entries that don't exist on disk: creation
  // placeholders and branch-mode synthetics (the "main card" pin and full
  // branch-mode repos). listWorktrees never returns these, so a plain
  // refresh would otherwise silently drop them. Deliberate removal goes
  // through removeWorktree.
  const freshIds = new Set(fresh.map((wt) => wt.id));
  const placeholders = existing.filter(
    (wt) => (wt.creating || wt.createError || wt.isBranchMode) && !freshIds.has(wt.id),
  );
  return [...withActivityTimestamps(merged, existing), ...placeholders];
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  worktrees: [],
  activeWorktreeId: null,
  seenWorktrees: new Set<string>(),
  unreadWorktrees: new Set<string>(),
  pinnedWorktrees: new Set<string>(),
  annotations: {},
  diffViewMode: {},
  changesViewMode: {},
  changesPanelCollapsed: {},
  showPrComments: {},
  sidebarCollapsed: false,
  archiveAfterDays: 2,
  deleteAfterDays: 0,
  runningServers: {},
  githubAuthErrors: new Set<string>(),
  setGithubAuthError: (repoPath) =>
    set((state) => ({
      githubAuthErrors: new Set([...state.githubAuthErrors, repoPath]),
    })),
  clearGithubAuthError: (repoPath: string) =>
    set((state) => {
      const next = new Set(state.githubAuthErrors);
      next.delete(repoPath);
      return { githubAuthErrors: next };
    }),

  addWorktree: (worktree) =>
    set((state) => ({ worktrees: [...state.worktrees, worktree] })),

  replaceWorktree: (tempId, realWorktree) =>
    set((state) => ({
      worktrees: state.worktrees
        // Remove any entry with the real ID that snuck in via a concurrent listWorktrees refresh,
        // but keep the placeholder we're about to replace (tempId may equal realWorktree.id for branches).
        .filter((wt) => wt.id !== realWorktree.id || wt.id === tempId)
        .map((wt) =>
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
      const newUnread = new Set(state.unreadWorktrees);
      newUnread.delete(id);
      const newPinned = new Set(state.pinnedWorktrees);
      newPinned.delete(id);
      return {
        worktrees: state.worktrees.filter((wt) => wt.id !== id),
        activeWorktreeId: state.activeWorktreeId === id ? null : state.activeWorktreeId,
        annotations: restAnnotations,
        seenWorktrees: newSeen,
        unreadWorktrees: newUnread,
        pinnedWorktrees: newPinned,
        runningServers: (() => {
          const { [id]: _, ...rest } = state.runningServers;
          return rest;
        })(),
      };
    }),

  archiveWorktree: (id) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) =>
        wt.id === id ? { ...wt, archived: true, archivedAt: Date.now(), unarchivedAt: undefined } : wt,
      ),
    })),

  unarchiveWorktree: (id) =>
    set((state) => ({
      worktrees: state.worktrees.map((wt) =>
        wt.id === id ? { ...wt, archived: false, archivedAt: undefined, unarchivedAt: Date.now() } : wt,
      ),
    })),

  updateWorktree: (id, patch) =>
    set((state) => {
      const prev = state.worktrees.find((wt) => wt.id === id);
      // Clear "seen" only on the idle→busy transition, not on busy re-assertion.
      const newSeen = new Set(state.seenWorktrees);
      if (patch.agentStatus === "busy" && prev?.agentStatus !== "busy") {
        newSeen.delete(id);
      }
      return {
        worktrees: state.worktrees.map((wt) => {
          if (wt.id !== id) return wt;
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
    set((state) => {
      const newUnread = new Set(state.unreadWorktrees);
      if (id) newUnread.delete(id);
      const found = state.worktrees.some((w) => w.id === id);
      import("../api").then(({ debugLog }) =>
        debugLog(
          `[pin-diag] setActiveWorktree id=${id} foundInStore=${found} ids=${JSON.stringify(state.worktrees.map((w) => w.id))}`,
        ).catch(() => {}),
      );
      return {
        activeWorktreeId: id,
        unreadWorktrees: newUnread,
        worktrees: state.worktrees.map((wt) =>
          wt.id === id && wt.justCreated ? { ...wt, justCreated: undefined } : wt,
        ),
      };
    }),

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

  markWorktreeUnread: (id) =>
    set((state) => ({
      unreadWorktrees: new Set(state.unreadWorktrees).add(id),
    })),

  markWorktreeRead: (id) =>
    set((state) => {
      const next = new Set(state.unreadWorktrees);
      next.delete(id);
      return { unreadWorktrees: next };
    }),

  togglePinWorktree: (id) =>
    set((state) => {
      const next = new Set(state.pinnedWorktrees);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { pinnedWorktrees: next };
    }),

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

  setWorktreesForRepo: (repoPath, freshArg) =>
    set((state) => {
      const otherRepoWorktrees = state.worktrees.filter((wt) => wt.repoPath !== repoPath);
      const existingForRepo = state.worktrees.filter((wt) => wt.repoPath === repoPath);
      const freshWorktrees =
        typeof freshArg === "function" ? freshArg(existingForRepo) : freshArg;
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
      unreadWorktrees: new Set<string>(),
      pinnedWorktrees: new Set<string>(),
      annotations: {},
      diffViewMode: {},
      changesViewMode: {},
      changesPanelCollapsed: {},
      showPrComments: {},
      sidebarCollapsed: false,
      archiveAfterDays: 2,
      deleteAfterDays: 0,
      runningServers: {},
      githubAuthErrors: new Set<string>(),
    }),

  setRunningServer: (worktreeId, server) => set((state) => {
    if (server) {
      return { runningServers: { ...state.runningServers, [worktreeId]: server } };
    }
    const { [worktreeId]: _, ...rest } = state.runningServers;
    return { runningServers: rest };
  }),
}));
