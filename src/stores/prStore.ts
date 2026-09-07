import { create } from "zustand";
import type {
  CheckRun,
  KanbanColumn,
  PrDetailedStatus,
  PrPanelState,
  PrStatusWithColumn,
  Worktree,
} from "../types";
import { setWorktreeColumn, clearWorktreeColumn } from "../api";
import { rekeyRecord } from "./rekeyWorktreeId";
import { toTerminalFlags } from "../lib/prStatus";
import { stopServerAndReleasePort } from "../services/portReclaim";

interface ColumnOverride {
  column: KanbanColumn;
  autoColumnWhenSet: KanbanColumn;
  /** Legacy overrides (pre-v0.3.5) lack autoColumnWhenSet — flag them so
   *  applyPrUpdates can migrate instead of clearing on first sync. */
  needsMigration?: boolean;
}

interface PrState {
  checkRuns: Record<string, CheckRun[]>;
  prDetail: Record<string, PrDetailedStatus>;
  prSummary: Record<string, {
    failingCheckCount?: number;
    pendingCheckCount?: number;
    unresolvedCommentCount?: number;
    reviewDecision?: string | null;
    mergeable?: boolean | null;
    requestedReviewers?: string[];
    merged: boolean;
    closed: boolean;
  }>;
  prPanelState: Record<string, PrPanelState>;
  reviewedFiles: Record<string, Set<string>>;
  /** Per-worktree viewed-state fetch result: the PR's GraphQL node id, which
   *  PR it was fetched for, and the PR's full file-path universe on GitHub.
   *  Presence (with a matching prNumber) doubles as the "already hydrated"
   *  flag, so PrFileList doesn't refire its paginated GraphQL fetch on every
   *  mount — and a late stale re-fetch can't clobber a confirmed toggle. */
  prFileMeta: Record<string, { nodeId: string; prNumber: number; prPaths: Set<string> }>;
  jumpToComment: Record<string, ((path: string, line: number) => void) | null>;
  columnOverrides: Record<string, ColumnOverride>;
  /** Last autoColumn computed by Rust for each worktree — used to snapshot overrides. */
  lastAutoColumn: Record<string, KanbanColumn>;

  setCheckRuns: (worktreeId: string, runs: CheckRun[]) => void;
  setPrDetail: (worktreeId: string, detail: PrDetailedStatus) => void;
  setPrPanelState: (worktreeId: string, panelState: PrPanelState) => void;
  /** Follow a worktree whose id changed under it (branch switch). */
  rekeyWorktree: (oldId: string, newId: string) => void;
  /** Records a single file's confirmed viewed state — an explicit target, not
   *  a blind toggle, so a hydration landing mid-mutation can't flip it the
   *  wrong way. */
  setFileReviewed: (worktreeId: string, filePath: string, reviewed: boolean) => void;
  /** Replaces the reviewed set wholesale — used to hydrate from GitHub's
   *  viewer-viewed-state on load, as opposed to a single local toggle. */
  setReviewedFiles: (worktreeId: string, filePaths: Iterable<string>) => void;
  clearReviewedFiles: (worktreeId: string) => void;
  setPrFileMeta: (worktreeId: string, meta: { nodeId: string; prNumber: number; prPaths: Set<string> }) => void;
  setJumpToComment: (worktreeId: string, fn: (path: string, line: number) => void) => void;
  clearJumpToComment: (worktreeId: string) => void;
  setManualColumn: (id: string, column: KanbanColumn, currentAutoColumn?: KanbanColumn) => void;
  removeWorktreeState: (id: string) => void;
  clearStore: () => void;

  /**
   * Apply PR status updates from the background sync loop.
   * Updates own state (columnOverrides, prSummary) and
   * returns a map of worktree patches for the workspace store to apply.
   */
  applyPrUpdates: (
    prs: PrStatusWithColumn[],
    worktrees: Worktree[],
  ) => Map<string, Partial<Worktree>>;
}

const INITIAL_STATE = {
  checkRuns: {},
  prDetail: {},
  prSummary: {},
  prPanelState: {},
  reviewedFiles: {},
  prFileMeta: {},
  jumpToComment: {},
  columnOverrides: {},
  lastAutoColumn: {},
};

export const usePrStore = create<PrState>((set, get) => ({
  ...INITIAL_STATE,

  setCheckRuns: (worktreeId, runs) =>
    set((state) => ({
      checkRuns: { ...state.checkRuns, [worktreeId]: runs },
    })),

  setPrDetail: (worktreeId, detail) =>
    set((s) => ({ prDetail: { ...s.prDetail, [worktreeId]: detail } })),

  setPrPanelState: (worktreeId, panelState) =>
    set((state) => ({
      prPanelState: { ...state.prPanelState, [worktreeId]: panelState },
    })),

  rekeyWorktree: (oldId, newId) =>
    set((state) => ({
      prSummary: rekeyRecord(state.prSummary, oldId, newId),
      checkRuns: rekeyRecord(state.checkRuns, oldId, newId),
      prDetail: rekeyRecord(state.prDetail, oldId, newId),
      prPanelState: rekeyRecord(state.prPanelState, oldId, newId),
      reviewedFiles: rekeyRecord(state.reviewedFiles, oldId, newId),
      prFileMeta: rekeyRecord(state.prFileMeta, oldId, newId),
      jumpToComment: rekeyRecord(state.jumpToComment, oldId, newId),
      // Without these two, applyPrUpdates finds no override under the new id
      // on the next sync and silently reverts a manual kanban placement.
      columnOverrides: rekeyRecord(state.columnOverrides, oldId, newId),
      lastAutoColumn: rekeyRecord(state.lastAutoColumn, oldId, newId),
    })),

  setFileReviewed: (worktreeId, filePath, reviewed) =>
    set((state) => {
      const next = new Set(state.reviewedFiles[worktreeId] ?? []);
      if (reviewed) {
        next.add(filePath);
      } else {
        next.delete(filePath);
      }
      return { reviewedFiles: { ...state.reviewedFiles, [worktreeId]: next } };
    }),

  setReviewedFiles: (worktreeId, filePaths) =>
    set((state) => ({
      reviewedFiles: { ...state.reviewedFiles, [worktreeId]: new Set(filePaths) },
    })),

  clearReviewedFiles: (worktreeId) =>
    set((state) => ({
      reviewedFiles: { ...state.reviewedFiles, [worktreeId]: new Set<string>() },
    })),

  setPrFileMeta: (worktreeId, meta) =>
    set((state) => ({
      prFileMeta: { ...state.prFileMeta, [worktreeId]: meta },
    })),

  setJumpToComment: (worktreeId, fn) =>
    set((state) => ({
      jumpToComment: { ...state.jumpToComment, [worktreeId]: fn },
    })),

  clearJumpToComment: (worktreeId) =>
    set((state) => ({
      jumpToComment: { ...state.jumpToComment, [worktreeId]: null },
    })),

  /**
   * Manual column override from drag-and-drop.
   * Persists until the PR's autoColumn changes (i.e., a real state transition).
   * Pass `currentAutoColumn` when `lastAutoColumn` may not be populated yet
   * (e.g., drag before first sync).
   */
  setManualColumn: (id, column, currentAutoColumn?) =>
    set((state) => ({
      columnOverrides: {
        ...state.columnOverrides,
        [id]: {
          column,
          autoColumnWhenSet: state.lastAutoColumn[id] ?? currentAutoColumn ?? column,
        },
      },
    })),

  removeWorktreeState: (id) =>
    set((state) => {
      const { [id]: _checkRuns, ...restCheckRuns } = state.checkRuns;
      const { [id]: _prDetail, ...restPrDetail } = state.prDetail;
      const { [id]: _prSummary, ...restPrSummary } = state.prSummary;
      const { [id]: _prPanelState, ...restPrPanelState } = state.prPanelState;
      const { [id]: _reviewedFiles, ...restReviewedFiles } = state.reviewedFiles;
      const { [id]: _prFileMeta, ...restPrFileMeta } = state.prFileMeta;
      const { [id]: _jumpToComment, ...restJumpToComment } = state.jumpToComment;
      const { [id]: _override, ...restOverrides } = state.columnOverrides;
      const { [id]: _auto, ...restAutoColumn } = state.lastAutoColumn;
      return {
        checkRuns: restCheckRuns,
        prDetail: restPrDetail,
        prSummary: restPrSummary,
        prPanelState: restPrPanelState,
        reviewedFiles: restReviewedFiles,
        prFileMeta: restPrFileMeta,
        jumpToComment: restJumpToComment,
        columnOverrides: restOverrides,
        lastAutoColumn: restAutoColumn,
      };
    }),

  clearStore: () => set(INITIAL_STATE),

  applyPrUpdates: (prs, worktrees) => {
    const state = get();

    // Index PRs by repoPath+branch for multi-repo disambiguation.
    // Open beats closed/merged on the same key — sync_prs returns closed PRs
    // last, so a fresh open PR on a reused branch would otherwise be overwritten
    // by an older closed PR and inherit `merged: true`.
    const prByKey = new Map<string, PrStatusWithColumn>();
    for (const pr of prs) {
      const key = `${pr.repoPath}::${pr.branch}`;
      const existing = prByKey.get(key);
      if (!existing) {
        prByKey.set(key, pr);
        continue;
      }
      const existingIsLive = existing.state === "open" && !existing.merged;
      const incomingIsLive = pr.state === "open" && !pr.merged;
      if (incomingIsLive && !existingIsLive) {
        prByKey.set(key, pr);
      } else if (incomingIsLive && existingIsLive && pr.number > existing.number) {
        prByKey.set(key, pr);
      }
    }

    const newOverrides = { ...state.columnOverrides };
    const newAutoColumn = { ...state.lastAutoColumn };
    const newSummary = { ...state.prSummary };
    const newCheckRuns = { ...state.checkRuns };
    const newPrDetail = { ...state.prDetail };
    const patches = new Map<string, Partial<Worktree>>();

    for (const wt of worktrees) {
      const pr = prByKey.get(`${wt.repoPath}::${wt.branch}`);
      if (!pr) continue;

      // autoColumn === null means "unknown" (partial update, e.g. reconcile
      // without live sync data): skip all column/override bookkeeping — only
      // the prStatus payload below applies — so a partial update can never
      // pollute lastAutoColumn or invalidate a manual override.
      if (pr.autoColumn != null) {
        newAutoColumn[wt.id] = pr.autoColumn;

        // Clear manual override when the PR's autoColumn has changed since
        // the override was set — a real state transition happened, so let
        // the new autoColumn take over. If autoColumn hasn't changed, the
        // user's manual placement persists (like Linear).
        const override = newOverrides[wt.id];
        if (override) {
          if (override.needsMigration) {
            // Legacy override from pre-v0.3.5 session — migrate by recording
            // the current autoColumn so it persists on subsequent syncs.
            newOverrides[wt.id] = { column: override.column, autoColumnWhenSet: pr.autoColumn };
          } else if (override.autoColumnWhenSet !== pr.autoColumn) {
            delete newOverrides[wt.id];
          }
        }
      }

      // Build updated PR status (without autoColumn, which is store-only)
      const prStatus = {
        number: pr.number,
        state: pr.state,
        title: pr.title,
        url: pr.url,
        draft: pr.draft,
        merged: pr.merged,
        branch: pr.branch,
        baseBranch: pr.baseBranch,
        mergedAt: pr.mergedAt,
        headSha: pr.headSha,
        body: pr.body,
        nativeStack: pr.nativeStack ?? null,
        // Ownership fact for the adopt-stack cue's foreign-PR gate — the gate
        // fails closed when this is absent, so it must ride every live sync.
        author: pr.author,
        // Sticky only within the same PR: GitHub clears requested_reviewers the
        // moment a review is submitted, and this flag gates "is this someone
        // else's PR" — it must not flip back merely because the review went in.
        // A NEW PR reusing the branch starts fresh from its own flag.
        reviewRequested:
          pr.reviewRequested ||
          (wt.prStatus?.number === pr.number && wt.prStatus?.reviewRequested === true),
      };

      // Use manual override if still active, otherwise auto-assign; with an
      // unknown auto-column, keep the worktree where it already sits.
      const column = pr.autoColumn == null
        ? wt.column
        : (newOverrides[wt.id]?.column ?? pr.autoColumn);

      // Use the PR's updatedAt as the activity timestamp when available
      const prUpdatedAtMs = pr.updatedAt ? new Date(pr.updatedAt).getTime() : undefined;

      // Pick the most recent timestamp from: PR updatedAt, last commit, or previous activity
      // No Date.now() here — we only want real timestamps, not "when we fetched"
      const candidates: number[] = [];
      if (prUpdatedAtMs && !Number.isNaN(prUpdatedAtMs)) candidates.push(prUpdatedAtMs);
      if (wt.lastCommitEpoch) candidates.push(wt.lastCommitEpoch);
      if (wt.lastActivityAt) candidates.push(wt.lastActivityAt);

      patches.set(wt.id, {
        prStatus,
        column,
        lastActivityAt: candidates.length > 0 ? Math.max(...candidates) : undefined,
      });

      // Mirror the "reclaim on Done" contract for auto-column transitions
      // (PR merged → autoColumn flips to "done"). set_worktree_column only fires
      // on manual drag/menu actions, so without this the server keeps running and
      // the port stays pinned in app.json forever once a PR auto-completes. The
      // non-done guard also prevents a double-fire after a manual drag-to-Done
      // (frontend column is already "done" by the next sync tick), which would
      // otherwise stop a server the user had just restarted in Done.
      if (wt.column !== "done" && column === "done") {
        stopServerAndReleasePort(wt, "pr-store");
      }

      // Persist (and reverse) the auto-Done column to the per-repo config so it
      // survives a restart. Without this, a restart re-derives the column purely
      // from the 30-closed-PR sync window; once a merged PR ages out there is no
      // record it was Done and the worktree pops back to "In progress".
      // Skip entirely when the user has a live manual placement (an in-memory
      // override) — that is owned by the drag handler / session restore, and
      // touching the backend column here would clobber a drag-out-of-Done.
      if (!newOverrides[wt.id]) {
        const prevSummary = state.prSummary[wt.id];
        const wasTerminal = !!(prevSummary?.merged || prevSummary?.closed);
        const isTerminal = pr.merged || pr.state === "closed";
        if (isTerminal && !wasTerminal) {
          // PR just reached a terminal state — persist Done. Fires once, on the
          // non-terminal → terminal edge, independent of whether the column was
          // already Done, so the approve-then-merge path is covered too.
          setWorktreeColumn(wt.repoPath, wt.name, "done").catch((e) => {
            console.warn("[pr-store] Failed to persist auto-Done column:", wt.id, e);
          });
        } else if (wt.column === "done" && column !== "done") {
          // Worktree was showing Done but its branch is live again (reopened, or
          // reused with a new PR) — drop the stale persisted Done so it doesn't
          // re-hydrate as Done on the next boot.
          clearWorktreeColumn(wt.repoPath, wt.name).catch((e) => {
            console.warn("[pr-store] Failed to clear stale Done column:", wt.id, e);
          });
        }
      }

      // Sidebar summary data — preserve cached enrichment values when Phase 1
      // payload arrives without them (comments/checks are fetched in Phase 2)
      const prev = state.prSummary[wt.id];
      newSummary[wt.id] = {
        failingCheckCount: pr.failingCheckCount ?? prev?.failingCheckCount,
        pendingCheckCount: pr.pendingCheckCount ?? prev?.pendingCheckCount,
        unresolvedCommentCount: pr.unresolvedCommentCount ?? prev?.unresolvedCommentCount,
        reviewDecision: pr.reviewDecision ?? prev?.reviewDecision,
        mergeable: pr.mergeable ?? prev?.mergeable,
        requestedReviewers: pr.requestedReviewers ?? prev?.requestedReviewers,
        // merged / closed always present on PrStatus — no Phase-1/2 fallback needed
        ...toTerminalFlags(pr),
      };

      // PR panel full data (only update if enrichment data is present)
      if (pr.checkRuns && pr.checkRuns.length > 0) {
        newCheckRuns[wt.id] = pr.checkRuns;
      }

      const prevDetail = newPrDetail[wt.id];
      newPrDetail[wt.id] = {
        reviews: pr.reviews ?? (prevDetail?.reviews ?? []),
        comments: pr.comments ?? (prevDetail?.comments ?? []),
        mergeable: pr.mergeable ?? (prevDetail?.mergeable ?? null),
        reviewDecision: pr.reviewDecision ?? (prevDetail?.reviewDecision ?? null),
        requestedReviewers: pr.requestedReviewers ?? (prevDetail?.requestedReviewers ?? []),
      };
    }

    set({
      columnOverrides: newOverrides,
      lastAutoColumn: newAutoColumn,
      prSummary: newSummary,
      checkRuns: newCheckRuns,
      prDetail: newPrDetail,
    });

    return patches;
  },
}));
