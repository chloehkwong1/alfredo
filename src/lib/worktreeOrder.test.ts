import { describe, expect, it } from "vitest";
import { columnNameOrder, sortColumnWorktrees, type WorktreeOrderMap } from "./worktreeOrder";
import type { Worktree } from "../types";

function wt(partial: Partial<Worktree> & { id: string; name: string }): Worktree {
  return {
    branch: partial.name,
    path: `/tmp/${partial.id}`,
    repoPath: "/tmp/repo",
    prStatus: null,
    agentStatus: "idle" as Worktree["agentStatus"],
    column: "inProgress" as Worktree["column"],
    isBranchMode: false,
    additions: null,
    deletions: null,
    ...partial,
  } as Worktree;
}

const names = (list: Worktree[]) => list.map((w) => w.name);
const ids = (list: Worktree[]) => list.map((w) => w.id);

describe("sortColumnWorktrees", () => {
  it("renders a fully-listed single-repo column in the exact manual order", () => {
    const cards = [
      wt({ id: "a", name: "a", createdAtEpoch: 100 }),
      wt({ id: "b", name: "b", createdAtEpoch: 200 }),
      wt({ id: "c", name: "c", createdAtEpoch: 300 }),
    ];
    const order: WorktreeOrderMap = { "/tmp/repo": { inProgress: ["c", "a", "b"] } };
    expect(names(sortColumnWorktrees(cards, "inProgress", order))).toEqual(["c", "a", "b"]);
  });

  it("slots an unlisted new card at its creation-order position (newest → top)", () => {
    const cards = [
      wt({ id: "a", name: "a", createdAtEpoch: 100 }),
      wt({ id: "b", name: "b", createdAtEpoch: 200 }),
      wt({ id: "fresh", name: "fresh", createdAtEpoch: 300 }),
    ];
    // Listed cards permute among THEIR slots; the unlisted newest card keeps
    // the top default slot instead of being hard-ranked against the list.
    const order: WorktreeOrderMap = { "/tmp/repo": { inProgress: ["a", "b"] } };
    expect(names(sortColumnWorktrees(cards, "inProgress", order))).toEqual(["fresh", "a", "b"]);
  });

  it("never moves another repo's cards when one repo has a persisted list", () => {
    const cards = [
      wt({ id: "a1", name: "a1", repoPath: "/repo-a", createdAtEpoch: 400 }),
      wt({ id: "b1", name: "b1", repoPath: "/repo-b", createdAtEpoch: 300 }),
      wt({ id: "a2", name: "a2", repoPath: "/repo-a", createdAtEpoch: 200 }),
      wt({ id: "b2", name: "b2", repoPath: "/repo-b", createdAtEpoch: 100 }),
    ];
    const order: WorktreeOrderMap = { "/repo-a": { inProgress: ["a2", "a1"] } };
    // repo-a's cards swap within slots 0 and 2; repo-b stays at slots 1 and 3.
    expect(ids(sortColumnWorktrees(cards, "inProgress", order))).toEqual(["a2", "b1", "a1", "b2"]);
  });

  it("scopes lists by repoPath — a reused name in another repo is not captured", () => {
    const cards = [
      wt({ id: "a1", name: "shared", repoPath: "/repo-a", createdAtEpoch: 400 }),
      wt({ id: "a2", name: "a2", repoPath: "/repo-a", createdAtEpoch: 300 }),
      wt({ id: "b1", name: "shared", repoPath: "/repo-b", createdAtEpoch: 200 }),
    ];
    const order: WorktreeOrderMap = { "/repo-a": { inProgress: ["a2", "shared"] } };
    // repo-a permutes slots 0/1; repo-b's "shared" keeps slot 2 untouched.
    expect(ids(sortColumnWorktrees(cards, "inProgress", order))).toEqual(["a2", "a1", "b1"]);
  });

  it("falls back createdAtEpoch → lastCommitEpoch → 0, tiebreaking by branch name", () => {
    const cards = [
      wt({ id: "z", name: "z-no-epochs" }), // → 0
      wt({ id: "c", name: "commit-only", lastCommitEpoch: 200 }),
      wt({ id: "a", name: "a-no-epochs" }), // → 0, ties with z on epoch
      // createdAtEpoch (100) must win over lastCommitEpoch (999): if the
      // fallback order were wrong this card would jump to the top.
      wt({ id: "n", name: "created", createdAtEpoch: 100, lastCommitEpoch: 999 }),
    ];
    expect(names(sortColumnWorktrees(cards, "inProgress", {}))).toEqual([
      "commit-only",
      "created",
      "a-no-epochs",
      "z-no-epochs",
    ]);
  });

  it("tiebreaks epoch+branch ties by repoPath so ordering never depends on input order", () => {
    const cards = [
      wt({ id: "b", name: "same", repoPath: "/repo-b" }),
      wt({ id: "a", name: "same", repoPath: "/repo-a" }),
    ];
    expect(ids(sortColumnWorktrees(cards, "inProgress", {}))).toEqual(["a", "b"]);
    expect(ids(sortColumnWorktrees(cards.slice().reverse(), "inProgress", {}))).toEqual(["a", "b"]);
  });

  it("ignores stale persisted names without crashing or leaving phantom slots", () => {
    const cards = [
      wt({ id: "a", name: "a", createdAtEpoch: 200 }),
      wt({ id: "b", name: "b", createdAtEpoch: 100 }),
    ];
    const order: WorktreeOrderMap = { "/tmp/repo": { inProgress: ["ghost", "b", "deleted", "a"] } };
    const sorted = sortColumnWorktrees(cards, "inProgress", order);
    expect(names(sorted)).toEqual(["b", "a"]);
    expect(sorted).toHaveLength(2);
  });

  it("only reads the given column's list", () => {
    const cards = [
      wt({ id: "a", name: "a", createdAtEpoch: 100 }),
      wt({ id: "b", name: "b", createdAtEpoch: 200 }),
    ];
    const order: WorktreeOrderMap = { "/tmp/repo": { needsReview: ["a", "b"] } };
    // inProgress has no persisted list → default newest-first rule.
    expect(names(sortColumnWorktrees(cards, "inProgress", order))).toEqual(["b", "a"]);
  });

  it("pins the drag-active card before its store-order successor, not at its comparator slot", () => {
    // Store order after handleDragOver's splice: active sits directly before
    // the card the pointer is over (b). Its epoch (500, newest) would slot it
    // at the top — rendering there mid-drag makes dnd-kit oscillate (#185).
    const cards = [
      wt({ id: "a", name: "a", createdAtEpoch: 300 }),
      wt({ id: "active", name: "active", createdAtEpoch: 500 }),
      wt({ id: "b", name: "b", createdAtEpoch: 100 }),
    ];
    expect(ids(sortColumnWorktrees(cards, "inProgress", {}, "active"))).toEqual(["a", "active", "b"]);
  });

  it("pins the drag-active card at the end when it was appended to the column", () => {
    const cards = [
      wt({ id: "a", name: "a", createdAtEpoch: 300 }),
      wt({ id: "b", name: "b", createdAtEpoch: 100 }),
      wt({ id: "active", name: "active", createdAtEpoch: 500 }),
    ];
    expect(ids(sortColumnWorktrees(cards, "inProgress", {}, "active"))).toEqual(["a", "b", "active"]);
  });

  it("keeps slot-permuting the other cards while the active card is pinned", () => {
    const cards = [
      wt({ id: "x", name: "x", createdAtEpoch: 300 }),
      wt({ id: "active", name: "active", createdAtEpoch: 100 }),
      wt({ id: "y", name: "y", createdAtEpoch: 200 }),
    ];
    const order: WorktreeOrderMap = { "/tmp/repo": { inProgress: ["y", "x"] } };
    // x/y permute per the persisted list; active renders before its store
    // successor y regardless of the permutation.
    expect(ids(sortColumnWorktrees(cards, "inProgress", order, "active"))).toEqual(["active", "y", "x"]);
  });

  it("ignores a dragActiveId that is not in the column", () => {
    const cards = [
      wt({ id: "a", name: "a", createdAtEpoch: 100 }),
      wt({ id: "b", name: "b", createdAtEpoch: 200 }),
    ];
    expect(names(sortColumnWorktrees(cards, "inProgress", {}, "elsewhere"))).toEqual(["b", "a"]);
  });

  it("is deterministic — shuffling input order never changes the output", () => {
    const cards = [
      wt({ id: "a1", name: "a1", repoPath: "/repo-a", createdAtEpoch: 500 }),
      wt({ id: "a2", name: "a2", repoPath: "/repo-a", createdAtEpoch: 300 }),
      wt({ id: "b1", name: "b1", repoPath: "/repo-b", createdAtEpoch: 400 }),
      wt({ id: "b2", name: "b2", repoPath: "/repo-b" }), // no epochs → 0
      wt({ id: "tie1", name: "tie", repoPath: "/repo-a" }),
      wt({ id: "tie2", name: "tie", repoPath: "/repo-b" }),
    ];
    const order: WorktreeOrderMap = { "/repo-a": { inProgress: ["a2", "a1"] } };
    const expected = ids(sortColumnWorktrees(cards, "inProgress", order));
    const shuffles = [
      [1, 0, 3, 2, 5, 4],
      [5, 4, 3, 2, 1, 0],
      [2, 5, 0, 3, 1, 4],
    ];
    for (const perm of shuffles) {
      const shuffled = perm.map((i) => cards[i]);
      expect(ids(sortColumnWorktrees(shuffled, "inProgress", order))).toEqual(expected);
    }
  });
});

describe("columnNameOrder", () => {
  it("returns only the given repo's names for the column, in display order", () => {
    const display = [
      wt({ id: "b2", name: "b2", repoPath: "/repo-b" }),
      wt({ id: "a2", name: "a2", repoPath: "/repo-a" }),
      wt({ id: "other", name: "other", repoPath: "/repo-a", column: "needsReview" as Worktree["column"] }),
      wt({ id: "a1", name: "a1", repoPath: "/repo-a" }),
    ];
    expect(columnNameOrder(display, "inProgress", "/repo-a")).toEqual(["a2", "a1"]);
  });

  it("returns an empty list when the repo has no cards in the column", () => {
    const display = [wt({ id: "b1", name: "b1", repoPath: "/repo-b" })];
    expect(columnNameOrder(display, "inProgress", "/repo-a")).toEqual([]);
  });
});
