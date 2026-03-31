import { create } from "zustand";
import type {
  CheckRun,
  KanbanColumn,
  PrDetailedStatus,
  PrPanelState,
  PrStatusWithColumn,
  Worktree,
} from "../types";

interface PrState {
  checkRuns: Record<string, CheckRun[]>;
  prDetail: Record<string, PrDetailedStatus>;
  prSummary: Record<string, {
    failingCheckCount?: number;
    pendingCheckCount?: number;
    unresolvedCommentCount?: number;
    reviewDecision?: string | null;
    mergeable?: boolean | null;
  }>;
  prPanelState: Record<string, PrPanelState>;
  reviewedFiles: Record<string, Set<string>>;
  jumpToComment: Record<string, ((path: string, line: number) => void) | null>;
  lastPrState: Record<string, string>;
  columnOverrides: Record<string, { column: KanbanColumn; githubStateWhenSet: string }>;

  setCheckRuns: (worktreeId: string, runs: CheckRun[]) => void;
  setPrDetail: (worktreeId: string, detail: PrDetailedStatus) => void;
  setPrPanelState: (worktreeId: string, panelState: PrPanelState) => void;
  toggleReviewedFile: (worktreeId: string, filePath: string) => void;
  clearReviewedFiles: (worktreeId: string) => void;
  setJumpToComment: (worktreeId: string, fn: (path: string, line: number) => void) => void;
  clearJumpToComment: (worktreeId: string) => void;
  setManualColumn: (id: string, column: KanbanColumn, githubStateWhenSet: string) => void;
  removeWorktreeState: (id: string) => void;
  clearStore: () => void;

  /**
   * Apply PR status updates from the background sync loop.
   * Updates own state (columnOverrides, lastPrState, prSummary) and
   * returns a map of worktree patches for the workspace store to apply.
   */
  applyPrUpdates: (
    prs: PrStatusWithColumn[],
    worktrees: Worktree[],
  ) => Map<string, Partial<Worktree>>;
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

const INITIAL_STATE = {
  checkRuns: {},
  prDetail: {},
  prSummary: {},
  prPanelState: {},
  reviewedFiles: {},
  jumpToComment: {},
  lastPrState: {},
  columnOverrides: {},
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

  /** Manual column override from drag-and-drop. Persisted until PR state changes. */
  setManualColumn: (id, column, githubStateWhenSet) =>
    set((state) => ({
      columnOverrides: { ...state.columnOverrides, [id]: { column, githubStateWhenSet } },
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
      const { [id]: _prState, ...restPrState } = state.lastPrState;
      return {
        checkRuns: restCheckRuns,
        prDetail: restPrDetail,
        prSummary: restPrSummary,
        prPanelState: restPrPanelState,
        reviewedFiles: restReviewedFiles,
        jumpToComment: restJumpToComment,
        columnOverrides: restOverrides,
        lastPrState: restPrState,
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
    const newLastPrState = { ...state.lastPrState };
    const newSummary = { ...state.prSummary };
    const newCheckRuns = { ...state.checkRuns };
    const newPrDetail = { ...state.prDetail };
    const patches = new Map<string, Partial<Worktree>>();

    for (const wt of worktrees) {
      const pr = prByKey.get(`${wt.repoPath}::${wt.branch}`);
      if (!pr) continue;


      const currentStateKey = prStateKey(pr);

      // If PR state changed since the override was set, clear it
      const override = newOverrides[wt.id];
      if (override && override.githubStateWhenSet !== currentStateKey) {
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

      // Sidebar summary data
      newSummary[wt.id] = {
        failingCheckCount: pr.failingCheckCount,
        pendingCheckCount: pr.pendingCheckCount,
        unresolvedCommentCount: pr.unresolvedCommentCount,
        reviewDecision: pr.reviewDecision,
        mergeable: pr.mergeable,
      };

      // PR panel full data (only update if enrichment data is present)
      if (pr.checkRuns && pr.checkRuns.length > 0) {
        newCheckRuns[wt.id] = pr.checkRuns;
      }

      if (pr.reviews || pr.comments) {
        newPrDetail[wt.id] = {
          reviews: pr.reviews ?? [],
          comments: pr.comments ?? [],
          mergeable: pr.mergeable ?? null,
          reviewDecision: pr.reviewDecision ?? null,
        };
      }
    }

    set({
      columnOverrides: newOverrides,
      lastPrState: newLastPrState,
      prSummary: newSummary,
      checkRuns: newCheckRuns,
      prDetail: newPrDetail,
    });

    return patches;
  },
}));
