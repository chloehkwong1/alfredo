import { create } from "zustand";
import type {
  CheckRun,
  KanbanColumn,
  PrDetailedStatus,
  PrPanelState,
  PrStatusWithColumn,
  Worktree,
} from "../types";
import { releaseWorktreePort } from "../api";

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
  jumpToComment: Record<string, ((path: string, line: number) => void) | null>;
  columnOverrides: Record<string, ColumnOverride>;
  /** Last autoColumn computed by Rust for each worktree — used to snapshot overrides. */
  lastAutoColumn: Record<string, KanbanColumn>;

  setCheckRuns: (worktreeId: string, runs: CheckRun[]) => void;
  setPrDetail: (worktreeId: string, detail: PrDetailedStatus) => void;
  setPrPanelState: (worktreeId: string, panelState: PrPanelState) => void;
  toggleReviewedFile: (worktreeId: string, filePath: string) => void;
  clearReviewedFiles: (worktreeId: string) => void;
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

  toggleReviewedFile: (worktreeId, filePath) =>
    set((state) => {
      const current = state.reviewedFiles[worktreeId] ?? new Set<string>();
      const next = new Set(current);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.add(filePath);
      }
      return { reviewedFiles: { ...state.reviewedFiles, [worktreeId]: next } };
    }),

  clearReviewedFiles: (worktreeId) =>
    set((state) => ({
      reviewedFiles: { ...state.reviewedFiles, [worktreeId]: new Set<string>() },
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
      const { [id]: _jumpToComment, ...restJumpToComment } = state.jumpToComment;
      const { [id]: _override, ...restOverrides } = state.columnOverrides;
      const { [id]: _auto, ...restAutoColumn } = state.lastAutoColumn;
      return {
        checkRuns: restCheckRuns,
        prDetail: restPrDetail,
        prSummary: restPrSummary,
        prPanelState: restPrPanelState,
        reviewedFiles: restReviewedFiles,
        jumpToComment: restJumpToComment,
        columnOverrides: restOverrides,
        lastAutoColumn: restAutoColumn,
      };
    }),

  clearStore: () => set(INITIAL_STATE),

  applyPrUpdates: (prs, worktrees) => {
    const state = get();

    // Index PRs by repoPath+branch for multi-repo disambiguation
    const prByKey = new Map<string, PrStatusWithColumn>();
    for (const pr of prs) {
      prByKey.set(`${pr.repoPath}::${pr.branch}`, pr);
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
      };

      // Use manual override if still active, otherwise auto-assign
      const column = newOverrides[wt.id]?.column ?? pr.autoColumn;

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

      // Mirror the backend's "release port on Done" contract for auto-column
      // transitions (PR merged → autoColumn flips to "done"). set_worktree_column
      // only fires on manual drag/menu actions, so without this the port stays
      // pinned in app.json forever once a PR auto-completes. The non-done guard
      // also prevents a double-fire after a manual drag-to-Done (frontend column
      // is already "done" by the next sync tick).
      if (wt.column !== "done" && column === "done") {
        releaseWorktreePort(wt.repoPath, wt.name).catch((e) => {
          console.warn("[pr-store] Failed to release port on auto-Done:", wt.name, e);
        });
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
        merged: pr.merged,
        closed: pr.state === "closed" && !pr.merged,
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
