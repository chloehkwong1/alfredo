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
    expect(chain!.memberIds).toEqual(["a", "b", "c"]);
    expect(chain!.position).toBe(2);
    expect(chain!.total).toBe(3);
    expect(chain!.rootId).toBe("a");
  });

  it("includes the root even though the root itself has no stackParent", () => {
    const chain = computeStackChain([a, b], "a");
    expect(chain!.memberIds).toEqual(["a", "b"]);
    expect(chain!.position).toBe(1);
  });

  it("flags attention when any member has a non-upToDate status", () => {
    const cc = { ...c, stackRebaseStatus: { kind: "conflict" as const } };
    expect(computeStackChain([a, b, cc], "a")!.needsAttention).toBe(true);
    expect(computeStackChain([a, b, c], "a")!.needsAttention).toBe(false);
  });

  it("survives a dangling parent (branch deleted) by rooting at the orphan", () => {
    const orphan = wt({ id: "o", branch: "feat/o", stackParent: "gone/branch" });
    const child = wt({ id: "p", branch: "feat/p", stackParent: "feat/o" });
    const chain = computeStackChain([orphan, child], "p");
    expect(chain!.memberIds).toEqual(["o", "p"]);
  });

  it("does not loop on cyclic data", () => {
    const m = wt({ id: "m", branch: "feat/m", stackParent: "feat/n" });
    const n = wt({ id: "n", branch: "feat/n", stackParent: "feat/m" });
    expect(() => computeStackChain([m, n], "m")).not.toThrow();
  });

  it("prefers the fork path containing the queried member and falls back to first child", () => {
    const root = wt({ id: "r", branch: "feat/root" });
    const left = wt({ id: "l", branch: "feat/left", stackParent: "feat/root" });
    const right = wt({ id: "rt", branch: "feat/right", stackParent: "feat/root" });
    const rightChild = wt({ id: "rc", branch: "feat/right-child", stackParent: "feat/right" });
    // Queried from the right tip: the chain follows the fork containing self.
    const fromRight = computeStackChain([root, left, right, rightChild], "rc");
    expect(fromRight!.memberIds).toEqual(["r", "rt", "rc"]);
    expect(fromRight!.position).toBe(3);
    // Queried from the root: no self-path below the fork → deterministic first child (sorted: feat/left).
    const fromRoot = computeStackChain([root, left, right, rightChild], "r");
    expect(fromRoot!.memberIds).toEqual(["r", "l"]);
    expect(fromRoot!.position).toBe(1);
  });
});
