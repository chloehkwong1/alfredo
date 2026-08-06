import { describe, it, expect, beforeEach, vi } from "vitest";

// applyPrUpdates fires fire-and-forget calls into ../api (setWorktreeColumn /
// clearWorktreeColumn for the auto-Done persistence below).
// Mock the module so we can assert on those without a Tauri backend.
vi.mock("../api", () => ({
  setWorktreeColumn: vi.fn(() => Promise.resolve()),
  clearWorktreeColumn: vi.fn(() => Promise.resolve()),
}));

// Auto-Done also stops the dev server and frees its port. Mocked out here both
// to assert the call and to keep sessionManager (xterm) out of this test's graph.
vi.mock("../services/portReclaim", () => ({
  stopServerAndReleasePort: vi.fn(() => Promise.resolve()),
}));

import { usePrStore } from "./prStore";
import { setWorktreeColumn, clearWorktreeColumn } from "../api";
import { stopServerAndReleasePort } from "../services/portReclaim";
import type { KanbanColumn, NativeStackInfo, NativeStackMember, PrStatusWithColumn, Worktree } from "../types";

// id and name are deliberately DIFFERENT so a regression that swaps the
// column key (wt.name) for the port key (wt.id) is caught — column_overrides
// is name-keyed (config_manager.rs), while stopServerAndReleasePort is
// id-keyed (it reads wt.id for both runningServers and port_assignments).
const WT_ID = "/repo::feature-1";
const WT_NAME = "feature-1";

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: WT_ID,
    name: WT_NAME,
    path: "/path/feature-1",
    branch: "feature-1",
    repoPath: "/repo",
    prStatus: null,
    agentStatus: "notRunning",
    column: "inProgress",
    isBranchMode: false,
    additions: null,
    deletions: null,
    ...overrides,
  };
}

function makePr(overrides: Partial<PrStatusWithColumn> = {}): PrStatusWithColumn {
  return {
    number: 1,
    state: "closed",
    title: "Some PR",
    url: "https://github.com/x/y/pull/1",
    draft: false,
    merged: true,
    branch: "feature-1",
    repoPath: "/repo",
    autoColumn: "done" as KanbanColumn,
    checkRuns: [],
    reviews: [],
    comments: null,
    reviewRequested: false,
    ...overrides,
  };
}

// Seed the store's prSummary so applyPrUpdates can read the PREVIOUS tick's
// terminal state (the persist fires only on the non-terminal -> terminal edge).
function seedPrevSummary(merged: boolean, closed: boolean) {
  usePrStore.setState((s) => ({
    prSummary: {
      ...s.prSummary,
      [WT_ID]: { merged, closed },
    },
  }));
}

beforeEach(() => {
  usePrStore.getState().clearStore();
  vi.mocked(setWorktreeColumn).mockClear();
  vi.mocked(clearWorktreeColumn).mockClear();
  vi.mocked(stopServerAndReleasePort).mockClear();
});

// A merged PR ages out of the 30-closed-PR sync window on busy repos. The
// auto-Done column is only held in memory unless we persist it to the per-repo
// config, so after a restart `list_worktrees` re-derives `inProgress` and the
// merged worktree pops back to "In progress". These tests pin the persistence
// AND its bidirectional clear / guards (no stale Done, no clobbered manual move).
describe("applyPrUpdates — persist auto-Done across restart", () => {
  it("persists the column under wt.name when a PR first becomes merged", () => {
    usePrStore
      .getState()
      .applyPrUpdates([makePr({ merged: true, state: "closed" })], [makeWorktree({ column: "inProgress" })]);

    expect(setWorktreeColumn).toHaveBeenCalledWith("/repo", WT_NAME, "done");
  });

  it("stops the server and frees the port on the transition into Done", () => {
    usePrStore
      .getState()
      .applyPrUpdates([makePr({ merged: true, state: "closed" })], [makeWorktree({ column: "inProgress" })]);

    expect(stopServerAndReleasePort).toHaveBeenCalledWith(
      expect.objectContaining({ id: WT_ID, repoPath: "/repo" }),
      "pr-store",
    );
  });

  it("does not re-stop the server when the worktree was already Done", () => {
    usePrStore
      .getState()
      .applyPrUpdates([makePr({ merged: true, state: "closed" })], [makeWorktree({ column: "done" })]);

    expect(stopServerAndReleasePort).not.toHaveBeenCalled();
  });

  it("persists for a closed-not-merged PR (also terminal -> Done)", () => {
    usePrStore
      .getState()
      .applyPrUpdates(
        [makePr({ merged: false, state: "closed", autoColumn: "done" })],
        [makeWorktree({ column: "inProgress" })],
      );

    expect(setWorktreeColumn).toHaveBeenCalledWith("/repo", WT_NAME, "done");
  });

  it("persists when an already-Done worktree's PR merges (approve-then-merge)", () => {
    // Worktree is already Done (teammate PR was approved while open); last
    // tick was non-terminal. The merge must still persist even though the
    // column did not change.
    seedPrevSummary(false, false);
    usePrStore
      .getState()
      .applyPrUpdates([makePr({ merged: true, state: "open" })], [makeWorktree({ column: "done" })]);

    expect(setWorktreeColumn).toHaveBeenCalledWith("/repo", WT_NAME, "done");
  });

  it("does not persist again when the PR was already terminal last tick", () => {
    seedPrevSummary(true, false);
    usePrStore.getState().applyPrUpdates([makePr({ merged: true })], [makeWorktree({ column: "done" })]);

    expect(setWorktreeColumn).not.toHaveBeenCalled();
  });

  it("does not persist over an active manual override (protects the user's placement)", () => {
    // A current manual placement: autoColumnWhenSet equals the PR's autoColumn,
    // so the migration logic keeps it instead of clearing. wt.column is mid-
    // transition (openPr) so the OLD transition-guarded persist would fire —
    // the manual-override gate must suppress it.
    usePrStore.setState((s) => ({
      columnOverrides: {
        ...s.columnOverrides,
        [WT_ID]: { column: "done", autoColumnWhenSet: "done" },
      },
    }));
    usePrStore
      .getState()
      .applyPrUpdates([makePr({ merged: true, state: "closed" })], [makeWorktree({ column: "openPr" })]);

    expect(setWorktreeColumn).not.toHaveBeenCalled();
  });

  it("does not persist a non-terminal auto-Done (open PR moved to Done by approval)", () => {
    usePrStore
      .getState()
      .applyPrUpdates(
        [makePr({ merged: false, state: "open", autoColumn: "done" })],
        [makeWorktree({ column: "inProgress" })],
      );

    expect(setWorktreeColumn).not.toHaveBeenCalled();
    expect(clearWorktreeColumn).not.toHaveBeenCalled();
  });

  it("clears the stale persisted Done when a previously-Done worktree goes live again", () => {
    // Branch reused: worktree hydrated/showing Done, but now has a live open PR.
    usePrStore
      .getState()
      .applyPrUpdates(
        [makePr({ merged: false, state: "open", autoColumn: "openPr" })],
        [makeWorktree({ column: "done" })],
      );

    expect(clearWorktreeColumn).toHaveBeenCalledWith("/repo", WT_NAME);
    expect(setWorktreeColumn).not.toHaveBeenCalled();
  });

  it("does not clear when a Done worktree keeps a live PR but the user manually placed it", () => {
    usePrStore.setState((s) => ({
      columnOverrides: {
        ...s.columnOverrides,
        [WT_ID]: { column: "done", autoColumnWhenSet: "openPr" },
      },
    }));
    usePrStore
      .getState()
      .applyPrUpdates(
        [makePr({ merged: false, state: "open", autoColumn: "openPr" })],
        [makeWorktree({ column: "done" })],
      );

    expect(clearWorktreeColumn).not.toHaveBeenCalled();
  });
});

// Native GitHub Stacks (public preview): membership rides in on each PR as
// `nativeStack` and must reach the worktree's prStatus patch — the sidebar
// chip and stack popover read `worktree.prStatus.nativeStack` directly.
describe("applyPrUpdates — native GitHub Stack membership", () => {
  const member = (number: number, position: number, branch: string): NativeStackMember => ({
    number,
    title: `PR ${number}`,
    branch,
    state: "OPEN",
    url: `https://github.com/x/y/pull/${number}`,
    position,
  });

  // Members deliberately shuffled — the patch carries the payload as-is and
  // consumers (NativeStackPopover) sort by position themselves.
  const makeNative = (overrides: Partial<NativeStackInfo> = {}): NativeStackInfo => ({
    id: "STACK_1",
    number: 42,
    position: 2,
    size: 3,
    members: [member(3, 3, "tip"), member(1, 1, "root"), member(2, 2, "feature-1")],
    ...overrides,
  });

  const openPr = (overrides: Partial<PrStatusWithColumn> = {}) =>
    makePr({ merged: false, state: "open", autoColumn: "openPr", ...overrides });

  it("carries nativeStack onto the worktree's prStatus patch", () => {
    const patches = usePrStore
      .getState()
      .applyPrUpdates([openPr({ nativeStack: makeNative() })], [makeWorktree()]);

    const prStatus = patches.get(WT_ID)?.prStatus;
    expect(prStatus?.nativeStack?.number).toBe(42);
    expect(prStatus?.nativeStack?.position).toBe(2);
    expect(prStatus?.nativeStack?.size).toBe(3);
  });

  it("patches nativeStack as null for non-members", () => {
    const patches = usePrStore.getState().applyPrUpdates([openPr()], [makeWorktree()]);
    expect(patches.get(WT_ID)?.prStatus?.nativeStack).toBeNull();
  });

  it("patches nativeStack back to null when a later sync shows the PR left the stack", () => {
    usePrStore.getState().applyPrUpdates([openPr({ nativeStack: makeNative() })], [makeWorktree()]);

    const patches = usePrStore.getState().applyPrUpdates([openPr()], [makeWorktree()]);
    expect(patches.get(WT_ID)?.prStatus?.nativeStack).toBeNull();
  });
});
