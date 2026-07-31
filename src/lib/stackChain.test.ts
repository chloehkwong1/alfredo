import { describe, expect, it } from "vitest";
import { computeStackChain } from "./stackChain";
import type { Worktree } from "../types";

function wt(partial: Partial<Worktree> & { id: string; branch: string }): Worktree {
  return {
    name: partial.branch.replace(/\//g, "-"),
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

describe("computeStackChain", () => {
  const a = wt({ id: "a", branch: "feat/a" });
  const b = wt({ id: "b", branch: "feat/b", stackParent: "feat/a" });
  const c = wt({ id: "c", branch: "feat/c", stackParent: "feat/b" });
  const lone = wt({ id: "x", branch: "fix/x" });

  it("returns null for non-stacked worktrees", () => {
    expect(computeStackChain([a, b, c, lone], "x")).toBeNull();
  });

  it("orders members root→tip and positions the queried member", () => {
    const chain = computeStackChain([c, a, b, lone], "b");
    expect(chain).not.toBeNull();
    expect(chain!.members.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(chain!.position).toBe(2);
    expect(chain!.total).toBe(3);
    expect(chain!.rootId).toBe("a");
    expect(chain!.forked).toBe(false);
    expect(chain!.members.map((m) => m.prefix)).toEqual(["└", "  └", "    └"]);
  });

  it("includes the root even though the root itself has no stackParent", () => {
    const chain = computeStackChain([a, b], "a");
    expect(chain!.members.map((m) => m.id)).toEqual(["a", "b"]);
    expect(chain!.position).toBe(1);
  });

  it("flags attention when any member has a non-upToDate status", () => {
    const cc = { ...c, stackRebaseStatus: { kind: "conflict" as const } };
    expect(computeStackChain([a, b, cc], "a")!.needsAttention).toBe(true);
    expect(computeStackChain([a, b, c], "a")!.needsAttention).toBe(false);
  });

  it("flags attention when any member has a pending stack action", () => {
    const bb = { ...b, stackPending: { mergedParent: "feat/a", blockedBy: "agentBusy" as const } };
    expect(computeStackChain([a, bb, c], "a")!.needsAttention).toBe(true);
  });

  it("survives a dangling parent (branch deleted) by rooting at the orphan", () => {
    const orphan = wt({ id: "o", branch: "feat/o", stackParent: "gone/branch" });
    const child = wt({ id: "p", branch: "feat/p", stackParent: "feat/o" });
    const chain = computeStackChain([orphan, child], "p");
    expect(chain!.members.map((m) => m.id)).toEqual(["o", "p"]);
  });

  it("does not loop on cyclic data", () => {
    const m = wt({ id: "m", branch: "feat/m", stackParent: "feat/n" });
    const n = wt({ id: "n", branch: "feat/n", stackParent: "feat/m" });
    expect(() => computeStackChain([m, n], "m")).not.toThrow();
  });

  it("includes the whole tree on a fork, with position = depth", () => {
    const root = wt({ id: "r", branch: "feat/root" });
    const left = wt({ id: "l", branch: "feat/left", stackParent: "feat/root" });
    const right = wt({ id: "rt", branch: "feat/right", stackParent: "feat/root" });
    const rightChild = wt({ id: "rc", branch: "feat/right-child", stackParent: "feat/right" });
    const all = [root, left, right, rightChild];
    // Every member sees the same tree: DFS root-first, children branch-sorted.
    const fromRight = computeStackChain(all, "rc");
    expect(fromRight!.members.map((m) => m.id)).toEqual(["r", "l", "rt", "rc"]);
    expect(fromRight!.position).toBe(3);
    expect(fromRight!.total).toBe(4);
    expect(fromRight!.forked).toBe(true);
    const fromRoot = computeStackChain(all, "r");
    expect(fromRoot!.members.map((m) => m.id)).toEqual(["r", "l", "rt", "rc"]);
    expect(fromRoot!.position).toBe(1);
    // Siblings share a depth — the chip shows the same honest "2/4" for both.
    expect(computeStackChain(all, "l")!.position).toBe(2);
    expect(computeStackChain(all, "rt")!.position).toBe(2);
  });

  it("ignores same-named branches from other repos", () => {
    const root = wt({ id: "r", branch: "feat/root" });
    const child = wt({ id: "ch", branch: "feat/child", stackParent: "feat/root" });
    // Another repo reuses both branch names and stacks on "feat/root" there.
    const otherRoot = wt({ id: "or", branch: "feat/root", repoPath: "/tmp/other" });
    const otherChild = wt({ id: "oc", branch: "feat/other-child", stackParent: "feat/root", repoPath: "/tmp/other" });
    const chain = computeStackChain([root, child, otherRoot, otherChild], "r")!;
    expect(chain.members.map((m) => m.id)).toEqual(["r", "ch"]);
    expect(chain.total).toBe(2);
    expect(chain.forked).toBe(false);
    // The other repo's stack resolves independently.
    const other = computeStackChain([root, child, otherRoot, otherChild], "oc")!;
    expect(other.members.map((m) => m.id)).toEqual(["or", "oc"]);
  });

  it("computes file-tree guide prefixes across a fork", () => {
    const root = wt({ id: "r", branch: "feat/root" });
    const left = wt({ id: "l", branch: "feat/left", stackParent: "feat/root" });
    const leftChild = wt({ id: "lc", branch: "feat/left-child", stackParent: "feat/left" });
    const right = wt({ id: "rt", branch: "feat/right", stackParent: "feat/root" });
    const chain = computeStackChain([root, left, leftChild, right], "r")!;
    expect(chain.members.map((m) => m.id)).toEqual(["r", "l", "lc", "rt"]);
    expect(chain.members.map((m) => m.prefix)).toEqual(["└", "  ├", "  │ └", "  └"]);
    expect(chain.members.map((m) => m.depth)).toEqual([1, 2, 3, 2]);
  });
});
