import { create } from "zustand";
import type {
  Annotation,
  DiffViewMode,
  KanbanColumn,
  Worktree,
} from "../types";

interface SetupCompletion {
  id: string;
  path: string;
  error: string | null;
}

interface WorkspaceState {
  worktrees: Worktree[];
  activeWorktreeId: string | null;
  /** Tracks which worktrees the user has "seen" while idle/waiting. */
  seenWorktrees: Set<string>;
  /** Tracks worktrees the user has manually marked as unread. */
  unreadWorktrees: Set<string>;
  /** Tracks worktrees the user has pinned to the top of their column. */
  pinnedWorktrees: Set<string>;
  /** Manual sidebar card order per repo per kanban column (worktree names,
   *  top-first). Hydrated from personal config; persisted via setWorktreeOrders. */
  worktreeOrder: Record<string, Partial<Record<KanbanColumn, string[]>>>;
  /** Hydration: replace a repo's whole per-column order map. */
  setWorktreeOrderForRepo: (
    repoPath: string,
    order: Partial<Record<KanbanColumn, string[]>>,
  ) => void;
  /** Optimistic drag update: replace one column's list for one repo. */
  setColumnOrder: (repoPath: string, column: KanbanColumn, names: string[]) => void;
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
  /** Repos whose initial session restore has completed (phase 2 done).
   *  Gates useWorktreeDiscovery — polling before restore would insert
   *  worktrees ahead of tab/session hydration. */
  restoredRepos: Set<string>;
  markRepoRestored: (repoPath: string) => void;
  /** Close the discovery gate for a deselected repo so a reselect can't be
   *  polled before its restore re-runs. */
  unmarkRepoRestored: (repoPath: string) => void;
  /** Root worktree id of the stack currently hover-peeked in the sidebar, or
   *  null. Ephemeral UI state — not persisted, reset per session. */
  peekedStackRootId: string | null;
  setPeekedStackRoot: (rootId: string | null) => void;

  addWorktree: (worktree: Worktree) => void;
  replaceWorktree: (tempId: string, realWorktree: Worktree) => void;
  /** Marks the still-creating placeholder with `createError`. Returns `true`
   *  if a placeholder was found and marked, `false` if nothing matched (e.g.
   *  the placeholder was already swapped or wiped by a concurrent refresh).
   *  Callers should surface the error themselves when this returns `false`,
   *  otherwise the failure is silent. */
  failWorktree: (tempId: string, error: string) => boolean;
  removeWorktree: (id: string) => void;
  archiveWorktree: (id: string) => void;
  unarchiveWorktree: (id: string) => void;
  updateWorktree: (id: string, patch: Partial<Worktree>) => void;
  /** Setup-complete events that arrived before their worktree was in the store
   *  (fast setup scripts emit before replaceWorktree runs). Drained on insert. */
  completedSetups: SetupCompletion[];
  markSetupComplete: (completion: SetupCompletion) => void;
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
  clearAllPins: () => void;
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
 * Resolve a fresh worktree back to its previous store entry.
 *
 * Ids are `${repoPath}::${branch}` (git_manager.rs `worktree_id`), so a plain
 * `git checkout` inside a worktree re-ids it and an id-only lookup misses —
 * silently dropping the running agent's `claudeSessionId`, its column, and its
 * Linear ticket. The directory is what actually persisted, so fall back to it.
 */
function previousWorktreeLookup(existing: Worktree[]): (wt: Worktree) => Worktree | undefined {
  const byId = new Map(existing.map((w) => [w.id, w]));
  const byPath = new Map(existing.filter((w) => w.path).map((w) => [w.path, w]));
  return (wt) => byId.get(wt.id) ?? (wt.path ? byPath.get(wt.path) : undefined);
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
  const lookup = previousWorktreeLookup(existing);
  return incoming.map((wt) => {
    const prev = lookup(wt);

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
  const lookup = previousWorktreeLookup(existing);
  const merged = fresh.map((wt) => {
    const old = lookup(wt);
    if (old) {
      return {
        ...wt,
        prStatus: old.prStatus,
        column: old.column,
        agentStatus: old.agentStatus,
        channelAlive: old.channelAlive,
        staleBusy: old.staleBusy,
        // Frontend-only count written by the reconciler — listWorktrees has no
        // such field, so a refresh would blank "Running N agents…" to undefined
        // until the next 500ms tick (same flicker the diff stats below avoid).
        runningAgents: old.runningAgents,
        archived: old.archived,
        archivedAt: old.archivedAt,
        unarchivedAt: old.unarchivedAt,
        claudeSessionId: old.claudeSessionId,
        linearTicketUrl: old.linearTicketUrl,
        linearTicketIdentifier: old.linearTicketIdentifier,
        justCreated: old.justCreated,
        // Filled by useSessionRestore / useGithubSync / usePty — listWorktrees
        // always returns null here, so preserve old values across refreshes
        // (otherwise the sidebar diff badge blanks on every focus/port event).
        additions: wt.additions ?? old.additions,
        deletions: wt.deletions ?? old.deletions,
        stackParent: wt.stackParent !== undefined ? wt.stackParent : old.stackParent,
        stackChildren: wt.stackChildren !== undefined ? wt.stackChildren : old.stackChildren,
        // `??`, not a `!== undefined` guard: listWorktrees serialises this as
        // an explicit `null` (the backend never computes it — only the stack
        // poll's events do), and `null !== undefined` meant every refresh wiped
        // a live "conflict"/"push failed" badge until the next 60s poll
        // re-emitted it. Nothing in this merge path ever clears the status
        // legitimately; the real clears go through updateWorktree.
        stackRebaseStatus: wt.stackRebaseStatus ?? old.stackRebaseStatus,
        // Event-fed like stackRebaseStatus; listWorktrees never returns it.
        stackPending: old.stackPending,
        lastStackAction: old.lastStackAction,
        // Frontend-only: backend never persists setup script errors, so a
        // refresh would otherwise clobber an unacknowledged error.
        setupScriptError: old.setupScriptError,
        // Same rationale as setupScriptError: listWorktrees reports false for
        // in-flight background setup, so a focus/port refresh must not clobber
        // the running flag. Only worktree:setup-complete clears it.
        setupInProgress: old.setupInProgress,
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
  completedSetups: [],
  activeWorktreeId: null,
  seenWorktrees: new Set<string>(),
  unreadWorktrees: new Set<string>(),
  pinnedWorktrees: new Set<string>(),
  worktreeOrder: {},
  setWorktreeOrderForRepo: (repoPath, order) =>
    set((state) => ({
      worktreeOrder: { ...state.worktreeOrder, [repoPath]: order },
    })),
  setColumnOrder: (repoPath, column, names) =>
    set((state) => ({
      worktreeOrder: {
        ...state.worktreeOrder,
        [repoPath]: { ...state.worktreeOrder[repoPath], [column]: names },
      },
    })),
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
  restoredRepos: new Set<string>(),
  markRepoRestored: (repoPath) =>
    set((state) => ({ restoredRepos: new Set(state.restoredRepos).add(repoPath) })),
  unmarkRepoRestored: (repoPath) =>
    set((state) => {
      const next = new Set(state.restoredRepos);
      next.delete(repoPath);
      return { restoredRepos: next };
    }),
  peekedStackRootId: null,
  setPeekedStackRoot: (rootId) => set({ peekedStackRootId: rootId }),

  addWorktree: (worktree) =>
    set((state) => ({ worktrees: [...state.worktrees, worktree] })),

  replaceWorktree: (tempId, realWorktree) =>
    set((state) => {
      const pending = state.completedSetups.find(
        (c) => c.id === realWorktree.id || c.path === realWorktree.path,
      );
      const resolved = pending
        ? { ...realWorktree, setupInProgress: false, setupScriptError: pending.error }
        : realWorktree;
      return {
        completedSetups: pending
          ? state.completedSetups.filter((c) => c !== pending)
          : state.completedSetups,
        worktrees: state.worktrees
          .filter((wt) => wt.id !== resolved.id || (wt.id === tempId && wt.creating))
          .map((wt) =>
            wt.id === tempId && wt.creating
              ? { ...resolved, creating: undefined, createError: undefined, justCreated: true }
              : wt,
          ),
      };
    }),

  markSetupComplete: (completion) =>
    set((state) => {
      // Only match real (non-creating) worktrees — placeholders are awaiting
      // replaceWorktree and the setup-complete event may have the placeholder's
      // path, so we must not apply early against a still-creating entry.
      const matches = (wt: Worktree) =>
        !wt.creating && (wt.id === completion.id || wt.path === completion.path);
      const target = state.worktrees.find(matches);
      if (target) {
        // Worktree already present — apply immediately, don't buffer.
        return {
          worktrees: state.worktrees.map((wt) =>
            matches(wt)
              ? { ...wt, setupInProgress: false, setupScriptError: completion.error }
              : wt,
          ),
        };
      }
      // Fired before the worktree landed — buffer for the insert path to drain.
      return { completedSetups: [...state.completedSetups, completion] };
    }),

  failWorktree: (tempId, error) => {
    let matched = false;
    set((state) => ({
      // Same `creating` guard as replaceWorktree: a concurrent listWorktrees refresh
      // can insert a real worktree with the same id; we must only taint the placeholder.
      worktrees: state.worktrees.map((wt) => {
        if (wt.id === tempId && wt.creating) {
          matched = true;
          return { ...wt, creating: undefined, createError: error };
        }
        return wt;
      }),
    }));
    return matched;
  },

  removeWorktree: (id) =>
    set((state) => {
      const { [id]: _annotations, ...restAnnotations } = state.annotations;
      const newSeen = new Set(state.seenWorktrees);
      newSeen.delete(id);
      const newUnread = new Set(state.unreadWorktrees);
      newUnread.delete(id);
      const newPinned = new Set(state.pinnedWorktrees);
      newPinned.delete(id);
      // Drop any buffered setup completion for this worktree. completedSetups is
      // drained by path in replaceWorktree, so a leftover entry from a deleted
      // worktree would otherwise be applied to a later recreate of the same
      // branch (same on-disk path).
      const removed = state.worktrees.find((wt) => wt.id === id);
      return {
        worktrees: state.worktrees.filter((wt) => wt.id !== id),
        completedSetups: state.completedSetups.filter(
          (c) => c.id !== id && (!removed || c.path !== removed.path),
        ),
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
    set((state) => {
      const prev = state.worktrees.find((wt) => wt.id === id);
      // Unpin on transition into "done" so completed work doesn't keep
      // hogging a slot at the top of the column.
      let pinnedWorktrees = state.pinnedWorktrees;
      if (column === "done" && prev?.column !== "done" && pinnedWorktrees.has(id)) {
        pinnedWorktrees = new Set(pinnedWorktrees);
        pinnedWorktrees.delete(id);
      }
      return {
        worktrees: state.worktrees.map((wt) =>
          wt.id === id ? { ...wt, column } : wt,
        ),
        pinnedWorktrees,
      };
    }),

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
    set((state) => {
      // Mirror setManualColumn: auto-Done transitions (PR merged) should
      // also unpin the worktree.
      let pinnedWorktrees = state.pinnedWorktrees;
      let pinnedDirty = false;
      for (const wt of state.worktrees) {
        const patch = patches.get(wt.id);
        if (!patch) continue;
        if (patch.column === "done" && wt.column !== "done" && pinnedWorktrees.has(wt.id)) {
          if (!pinnedDirty) {
            pinnedWorktrees = new Set(pinnedWorktrees);
            pinnedDirty = true;
          }
          pinnedWorktrees.delete(wt.id);
        }
      }
      return {
        worktrees: state.worktrees.map((wt) => {
          const patch = patches.get(wt.id);
          return patch ? { ...wt, ...patch } : wt;
        }),
        pinnedWorktrees,
      };
    }),

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

  clearAllPins: () => set({ pinnedWorktrees: new Set<string>() }),

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
      const worktrees = [
        ...otherRepoWorktrees,
        ...mergeWorktreeState(freshWorktrees, existingForRepo),
      ];
      // A worktree can leave the store without removeWorktree running: a re-id
      // (branch switch, or a rebase that finishes on a detached HEAD) gives the
      // same directory a new id, so the old row is merge-dropped here.
      // removeWorktree is the only other place that nulls the selection, so
      // without this the active id dangles and AppShell renders the main pane
      // against a worktree the store no longer holds.
      const selectionSurvives =
        !state.activeWorktreeId || worktrees.some((wt) => wt.id === state.activeWorktreeId);
      return {
        worktrees,
        activeWorktreeId: selectionSurvives ? state.activeWorktreeId : null,
      };
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
      worktreeOrder: {},
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
      completedSetups: [],
      restoredRepos: new Set<string>(),
      peekedStackRootId: null,
    }),

  setRunningServer: (worktreeId, server) => set((state) => {
    if (server) {
      return { runningServers: { ...state.runningServers, [worktreeId]: server } };
    }
    const { [worktreeId]: _, ...rest } = state.runningServers;
    return { runningServers: rest };
  }),
}));
