import { describe, expect, it } from "vitest";
import { assignStackHues, collectStackIdentities, computeStackChain, STACK_HUE_COUNT } from "./stackChain";
import type { NativeStackInfo, Worktree } from "../types";

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

  it("collectStackIdentities maps chain members to their root id and skips unstacked", () => {
    const ids = collectStackIdentities([c, a, b, lone]);
    expect(ids.get("a")).toBe("a");
    expect(ids.get("b")).toBe("a");
    expect(ids.get("c")).toBe("a");
    expect(ids.has("x")).toBe(false);
  });

  it("collectStackIdentities keeps same-named branches in different repos apart", () => {
    const root = wt({ id: "r", branch: "feat/root" });
    const child = wt({ id: "ch", branch: "feat/child", stackParent: "feat/root" });
    const otherRoot = wt({ id: "or", branch: "feat/root", repoPath: "/tmp/other" });
    const otherChild = wt({ id: "oc", branch: "feat/child", stackParent: "feat/root", repoPath: "/tmp/other" });
    const ids = collectStackIdentities([root, child, otherRoot, otherChild]);
    expect(ids.get("ch")).toBe("r");
    expect(ids.get("oc")).toBe("or");
    expect(new Set(ids.values()).size).toBe(2);
  });

  it("collectStackIdentities groups native-stack members by stack id, local chain winning", () => {
    const native = (id: string): NativeStackInfo => ({ id, number: 1, position: 1, size: 2, members: [] });
    const prStatus = (stackId: string) =>
      ({ number: 1, state: "OPEN", title: "t", url: "u", draft: false, merged: false, branch: "b", nativeStack: native(stackId) }) as Worktree["prStatus"];
    const nativeA1 = wt({ id: "n1", branch: "feat/n1", prStatus: prStatus("stack-a") });
    const nativeA2 = wt({ id: "n2", branch: "feat/n2", prStatus: prStatus("stack-a") });
    const nativeB = wt({ id: "n3", branch: "feat/n3", prStatus: prStatus("stack-b") });
    // Converted stack: local chain exists alongside native info → root id wins.
    const converted = wt({ id: "cv", branch: "feat/cv", stackParent: "feat/n1", prStatus: prStatus("stack-a") });
    const ids = collectStackIdentities([nativeA1, nativeA2, nativeB, converted]);
    // n1 gained a stacked child, so it roots a local chain shared with cv.
    expect(ids.get("n1")).toBe("n1");
    expect(ids.get("cv")).toBe("n1");
    // Pure native members key off the native stack id.
    expect(ids.get("n2")).toBe("native:stack-a");
    expect(ids.get("n3")).toBe("native:stack-b");
  });

  it("assignStackHues gives every stack a distinct hue up to the palette size", () => {
    const identities = new Map([
      ["w1", "root-b"], ["w2", "root-b"],
      ["w3", "root-a"],
      ["w4", "native:stack-z"],
    ]);
    const hues = assignStackHues(identities);
    // Members of the same stack share a hue; distinct stacks never collide
    // while ≤ STACK_HUE_COUNT of them coexist.
    expect(hues.get("w1")).toBe(hues.get("w2"));
    expect(new Set([hues.get("w1"), hues.get("w3"), hues.get("w4")]).size).toBe(3);
    for (const h of hues.values()) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(STACK_HUE_COUNT);
    }
  });

  it("assignStackHues is order-independent and wraps past the palette", () => {
    const forward = new Map([["w1", "a"], ["w2", "b"]]);
    const reversed = new Map([["w2", "b"], ["w1", "a"]]);
    expect(assignStackHues(forward).get("w1")).toBe(assignStackHues(reversed).get("w1"));
    const many = new Map(
      Array.from({ length: STACK_HUE_COUNT + 1 }, (_, i) => [`w${i}`, `id-${String(i).padStart(2, "0")}`] as const),
    );
    const hues = assignStackHues(many);
    expect(hues.get(`w${STACK_HUE_COUNT}`)).toBe(hues.get("w0"));
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
