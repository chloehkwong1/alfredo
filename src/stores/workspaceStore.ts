import { create } from "zustand";
import { useTabStore } from "./tabStore";
import { useLayoutStore } from "./layoutStore";
import { usePrStore } from "./prStore";
import { rekeyRecord, rekeySet, type WorktreeRekey } from "./rekeyWorktreeId";
import { migrateSessionFiles } from "../api";
import type {
  Annotation,
  DiffViewMode,
  KanbanColumn,
  PendingReview,
  ReviewDraftComment,
  ReviewVerdict,
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
  /** Session-scoped "adopt stack?" cue dismissals, keyed per worktree+parent
   *  so a different future base re-prompts. Deliberately not persisted. The
   *  key format is private to this store — read via isStackAdoptionDismissed,
   *  never by rebuilding the key at a call site. */
  dismissedStackAdoptions: Set<string>;
  dismissStackAdoption: (worktreeId: string, parentBranch: string) => void;
  isStackAdoptionDismissed: (worktreeId: string, parentBranch: string) => boolean;
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
  /** Whether the changes panel is focused per worktree. Keyed by worktreeId. */
  changesPanelFocused: Record<string, boolean>;
  /** Whether to show PR comments inline in the diff view. Keyed by worktreeId. */
  showPrComments: Record<string, boolean>;
  setShowPrComments: (worktreeId: string, show: boolean) => void;
  /** Pending review draft state per worktree. Keyed by worktreeId. Ephemeral, not persisted. */
  pendingReviews: Record<string, PendingReview>;
  addReviewDraftComment: (worktreeId: string, comment: ReviewDraftComment) => void;
  editReviewDraftComment: (worktreeId: string, id: string, body: string) => void;
  removeReviewDraftComment: (worktreeId: string, id: string) => void;
  setReviewVerdict: (worktreeId: string, verdict: ReviewVerdict) => void;
  setReviewBody: (worktreeId: string, body: string) => void;
  clearPendingReview: (worktreeId: string) => void;
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
  setChangesPanelFocused: (worktreeId: string, focused: boolean) => void;
  /** The one toggle path for shortcut, palette, and panel button — collapsed
   *  panels expand into focus mode rather than flipping an invisible flag. */
  toggleChangesPanelFocused: (worktreeId: string) => void;
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
 * Whether two worktree records describe the same physical worktree, as opposed
 * to a coincidence of id or path.
 *
 * Ids are `${repoPath}::${branch}`, so a branch deleted in one directory and
 * checked out in another produces an id match between different worktrees; a
 * directory removed and recreated produces a path match between different
 * worktrees. Git's admin name (`.git/worktrees/<name>`, frozen at creation)
 * survives checkouts but distinguishes directories; the admin dir's birthtime
 * survives checkouts but distinguishes a recreation at the same basename.
 * Birthtime is unavailable on some filesystems (`createdAtEpoch` is optional),
 * in which case the admin dir's inode decides — `git worktree add` recreates
 * the dir, so a recreation always changes the inode. Only when neither
 * identity signal exists does the name alone decide (the remaining gap: a
 * recreated same-name worktree would inherit the dead one's session state).
 */
function isSamePhysicalWorktree(prev: Worktree, wt: Worktree): boolean {
  if (prev.name !== wt.name) return false;
  if (prev.createdAtEpoch != null && wt.createdAtEpoch != null) {
    return prev.createdAtEpoch === wt.createdAtEpoch;
  }
  if (prev.adminDirIno != null && wt.adminDirIno != null) {
    return prev.adminDirIno === wt.adminDirIno;
  }
  return true;
}

/**
 * Resolve a fresh worktree back to its previous store entry.
 *
 * Ids are `${repoPath}::${branch}` (git_manager.rs `worktree_id`), so a plain
 * `git checkout` inside a worktree re-ids it and an id-only lookup misses —
 * silently dropping the running agent's `claudeSessionId`, its column, and its
 * Linear ticket. The directory is what actually persisted, so fall back to it.
 * Both matches are gated on physical identity: an id or path can be recycled
 * by a *different* worktree, which must not inherit this one's state.
 */
function previousWorktreeLookup(existing: Worktree[]): (wt: Worktree) => Worktree | undefined {
  const byId = new Map(existing.map((w) => [w.id, w]));
  const byPath = new Map(existing.filter((w) => w.path).map((w) => [w.path, w]));
  return (wt) => {
    const idHit = byId.get(wt.id);
    if (idHit && isSamePhysicalWorktree(idHit, wt)) return idHit;
    const pathHit = wt.path ? byPath.get(wt.path) : undefined;
    if (pathHit && isSamePhysicalWorktree(pathHit, wt)) return pathHit;
    return undefined;
  };
}

/**
 * Worktrees whose id changed while their physical identity stayed put — i.e.
 * someone ran `git checkout` inside them. Everything keyed by the old id has
 * to move. Uses the same identity-gated lookup as the merge, so the two can't
 * disagree about which old entry a fresh worktree continues: even when the old
 * id survives as a *different* worktree (the branch was picked up elsewhere),
 * the state still belongs to this directory and moves with it.
 */
function detectRekeys(fresh: Worktree[], existing: Worktree[]): WorktreeRekey[] {
  const lookup = previousWorktreeLookup(existing);
  return fresh.flatMap((wt) => {
    const prev = lookup(wt);
    if (!prev || prev.id === wt.id) return [];
    return [{ oldId: prev.id, newId: wt.id, repoPath: wt.repoPath }];
  });
}

/** Move the per-worktree state owned by *this* store onto the new ids. */
function rekeyOwnState(state: WorkspaceState, rekeys: WorktreeRekey[]): Partial<WorkspaceState> {
  if (rekeys.length === 0) return {};
  let next: Partial<WorkspaceState> = {
    annotations: state.annotations,
    diffViewMode: state.diffViewMode,
    changesViewMode: state.changesViewMode,
    changesPanelCollapsed: state.changesPanelCollapsed,
    changesPanelFocused: state.changesPanelFocused,
    showPrComments: state.showPrComments,
    pendingReviews: state.pendingReviews,
    runningServers: state.runningServers,
    seenWorktrees: state.seenWorktrees,
    unreadWorktrees: state.unreadWorktrees,
    pinnedWorktrees: state.pinnedWorktrees,
    activeWorktreeId: state.activeWorktreeId,
  };
  for (const { oldId, newId } of rekeys) {
    next = {
      annotations: rekeyRecord(next.annotations!, oldId, newId),
      diffViewMode: rekeyRecord(next.diffViewMode!, oldId, newId),
      changesViewMode: rekeyRecord(next.changesViewMode!, oldId, newId),
      changesPanelCollapsed: rekeyRecord(next.changesPanelCollapsed!, oldId, newId),
      changesPanelFocused: rekeyRecord(next.changesPanelFocused!, oldId, newId),
      showPrComments: rekeyRecord(next.showPrComments!, oldId, newId),
      pendingReviews: rekeyRecord(next.pendingReviews!, oldId, newId),
      runningServers: rekeyRecord(next.runningServers!, oldId, newId),
      seenWorktrees: rekeySet(next.seenWorktrees!, oldId, newId),
      unreadWorktrees: rekeySet(next.unreadWorktrees!, oldId, newId),
      pinnedWorktrees: rekeySet(next.pinnedWorktrees!, oldId, newId),
      // Losing this deselects the worktree the user is looking at.
      activeWorktreeId: next.activeWorktreeId === oldId ? newId : next.activeWorktreeId,
    };
  }
  return next;
}

/** Tabs, panes and PR data live in sibling stores and must follow the same ids. */
function rekeySiblingStores(rekeys: WorktreeRekey[]) {
  for (const { oldId, newId, repoPath } of rekeys) {
    useTabStore.getState().rekeyWorktree(oldId, newId);
    useLayoutStore.getState().rekeyWorktree(oldId, newId);
    usePrStore.getState().rekeyWorktree(oldId, newId);
    // The persisted session blob and resume sidecar are keyed by the same id
    // on disk. Rename them now — a Force Quit before the next 30s autosave
    // would otherwise restore nothing under the new id.
    migrateSessionFiles(repoPath, oldId, newId).catch((e) =>
      console.warn(`[workspaceStore] session-file migration failed for ${oldId} → ${newId}:`, e),
    );
  }
  if (rekeys.length > 0) {
    // Live sessions must follow the id change (sessionManager.rekeyWorktree)
    // BEFORE the autosave pass below reads them. dispatchEvent runs listeners
    // synchronously, so the ordering here is deterministic. A window event
    // rather than a direct call because importing sessionManager from this
    // store would close an import cycle (sessionManager imports this store).
    window.dispatchEvent(new CustomEvent("worktree-rekeys", { detail: rekeys }));
    // Ask useSessionAutoSave for an immediate save pass (same window-event
    // pattern as `config-changed`): the renamed blob still holds pre-switch
    // state, and 30s is a wide crash window to leave it stale.
    window.dispatchEvent(new CustomEvent("worktree-rekeyed"));
  }
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
        // Live sync data wins, but a restart-hydrated prStatus (from persisted
        // PR associations) must survive refreshes that arrive before first
        // sync. prStatusCleared marks a deliberate null (reconcile found the
        // PR dead) — without it a refresh racing the unawaited config clear
        // would re-adopt the dead association from backend hydration.
        prStatus: old.prStatus ?? (old.prStatusCleared ? null : wt.prStatus),
        prStatusCleared: old.prStatusCleared,
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

/** Single owner of the dismissal-key format. `worktreeId` itself nests
 *  `${repoPath}::${branch}` and branch names can contain `:`, so the format
 *  must never be rebuilt independently at a read site — drift between two
 *  template literals would silently stop dismissals from matching. */
const stackAdoptionKey = (worktreeId: string, parentBranch: string) =>
  `${worktreeId}:${parentBranch}`;

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  worktrees: [],
  completedSetups: [],
  activeWorktreeId: null,
  seenWorktrees: new Set<string>(),
  unreadWorktrees: new Set<string>(),
  pinnedWorktrees: new Set<string>(),
  dismissedStackAdoptions: new Set(),
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
  changesPanelFocused: {},
  showPrComments: {},
  pendingReviews: {},
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
      const { [id]: _pending, ...restPending } = state.pendingReviews;
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
        pendingReviews: restPending,
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

  setWorktrees: (freshWorktrees) => {
    const rekeys = detectRekeys(freshWorktrees, useWorkspaceStore.getState().worktrees);
    set((state) => ({
      worktrees: mergeWorktreeState(freshWorktrees, state.worktrees),
      ...rekeyOwnState(state, rekeys),
    }));
    rekeySiblingStores(rekeys);
  },

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
          if (!patch) return wt;
          // A real prStatus arriving supersedes an earlier deliberate clear.
          return patch.prStatus
            ? { ...wt, ...patch, prStatusCleared: false }
            : { ...wt, ...patch };
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

  dismissStackAdoption: (worktreeId, parentBranch) =>
    set((state) => {
      const next = new Set(state.dismissedStackAdoptions);
      next.add(stackAdoptionKey(worktreeId, parentBranch));
      return { dismissedStackAdoptions: next };
    }),

  isStackAdoptionDismissed: (worktreeId, parentBranch) =>
    get().dismissedStackAdoptions.has(stackAdoptionKey(worktreeId, parentBranch)),

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

  setChangesPanelFocused: (worktreeId, focused) =>
    set((state) => ({
      changesPanelFocused: { ...state.changesPanelFocused, [worktreeId]: focused },
    })),

  toggleChangesPanelFocused: (worktreeId) =>
    set((state) => {
      // With the panel collapsed, a bare flag flip is invisible — ⌘⇧E would
      // appear to do nothing, then resurface days later as a surprise 70%
      // layout when the panel expands. Focus is an explicit "show me the
      // changes big" intent, so expand INTO focus mode instead.
      if (state.changesPanelCollapsed[worktreeId] ?? false) {
        return {
          changesPanelCollapsed: { ...state.changesPanelCollapsed, [worktreeId]: false },
          changesPanelFocused: { ...state.changesPanelFocused, [worktreeId]: true },
        };
      }
      const focused = state.changesPanelFocused[worktreeId] ?? false;
      return {
        changesPanelFocused: { ...state.changesPanelFocused, [worktreeId]: !focused },
      };
    }),

  setShowPrComments: (worktreeId, show) =>
    set((s) => ({ showPrComments: { ...s.showPrComments, [worktreeId]: show } })),

  addReviewDraftComment: (worktreeId, comment) =>
    set((state) => {
      const EMPTY_REVIEW: PendingReview = { comments: [], verdict: "comment", body: "" };
      const current = state.pendingReviews[worktreeId] ?? EMPTY_REVIEW;
      return {
        pendingReviews: {
          ...state.pendingReviews,
          [worktreeId]: {
            ...current,
            comments: [...current.comments, comment],
          },
        },
      };
    }),

  editReviewDraftComment: (worktreeId, id, body) =>
    set((state) => {
      const existing = state.pendingReviews[worktreeId];
      if (!existing) return state;
      return {
        pendingReviews: {
          ...state.pendingReviews,
          [worktreeId]: {
            ...existing,
            comments: existing.comments.map((c) => (c.id === id ? { ...c, body } : c)),
          },
        },
      };
    }),

  removeReviewDraftComment: (worktreeId, id) =>
    set((state) => {
      const existing = state.pendingReviews[worktreeId];
      if (!existing) return state;
      return {
        pendingReviews: {
          ...state.pendingReviews,
          [worktreeId]: {
            ...existing,
            comments: existing.comments.filter((c) => c.id !== id),
          },
        },
      };
    }),

  setReviewVerdict: (worktreeId, verdict) =>
    set((state) => {
      const EMPTY_REVIEW: PendingReview = { comments: [], verdict: "comment", body: "" };
      const current = state.pendingReviews[worktreeId] ?? EMPTY_REVIEW;
      return {
        pendingReviews: {
          ...state.pendingReviews,
          [worktreeId]: { ...current, verdict },
        },
      };
    }),

  setReviewBody: (worktreeId, body) =>
    set((state) => {
      const EMPTY_REVIEW: PendingReview = { comments: [], verdict: "comment", body: "" };
      const current = state.pendingReviews[worktreeId] ?? EMPTY_REVIEW;
      return {
        pendingReviews: {
          ...state.pendingReviews,
          [worktreeId]: { ...current, body },
        },
      };
    }),

  clearPendingReview: (worktreeId) =>
    set((state) => {
      const { [worktreeId]: _removed, ...rest } = state.pendingReviews;
      return { pendingReviews: rest };
    }),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setSidebarCollapsed: (collapsed) =>
    set({ sidebarCollapsed: collapsed }),

  setWorktreesForRepo: (repoPath, freshArg) => {
    // Assigned inside the updater because `freshArg` can be a function of the
    // current per-repo list; read back after `set` to notify sibling stores.
    let rekeys: WorktreeRekey[] = [];
    set((state) => {
      const otherRepoWorktrees = state.worktrees.filter((wt) => wt.repoPath !== repoPath);
      const existingForRepo = state.worktrees.filter((wt) => wt.repoPath === repoPath);
      const freshWorktrees =
        typeof freshArg === "function" ? freshArg(existingForRepo) : freshArg;
      const worktrees = [
        ...otherRepoWorktrees,
        ...mergeWorktreeState(freshWorktrees, existingForRepo),
      ];
      // A re-id (branch switch, or a rebase finishing on a detached HEAD) gives
      // the same directory a new id, so per-worktree state has to move with it
      // — including the selection, which used to be nulled here instead.
      rekeys = detectRekeys(freshWorktrees, existingForRepo);
      const own = rekeyOwnState(state, rekeys);
      const activeWorktreeId = own.activeWorktreeId ?? state.activeWorktreeId;
      // A worktree can still leave the store without removeWorktree running
      // (deleted on disk). removeWorktree is the only other place that nulls
      // the selection, so without this the active id dangles and AppShell
      // renders the main pane against a worktree the store no longer holds.
      const selectionSurvives =
        !activeWorktreeId || worktrees.some((wt) => wt.id === activeWorktreeId);
      return {
        worktrees,
        ...own,
        activeWorktreeId: selectionSurvives ? activeWorktreeId : null,
      };
    });
    rekeySiblingStores(rekeys);
  },

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
      dismissedStackAdoptions: new Set(),
      worktreeOrder: {},
      annotations: {},
      diffViewMode: {},
      changesViewMode: {},
      changesPanelCollapsed: {},
      changesPanelFocused: {},
      showPrComments: {},
      pendingReviews: {},
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
