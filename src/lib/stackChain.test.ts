import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { collectStackIdentities, computeStackChain, computeStackHues, detectAdoptableParent, STACK_HUE_COUNT } from "./stackChain";
import { LIGHT_THEMES } from "./themeMeta";
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

  // A merged member's sticky needsPush can never heal (its upstream head is
  // deleted), and the popover already renders it as muted "merged ✓" with no
  // Push button — so it must not light the chip's amber "!" either, or the
  // chip points at nothing actionable forever.
  it("ignores leftover statuses on merged members when flagging attention", () => {
    const mergedB = {
      ...b,
      prStatus: { merged: true } as Worktree["prStatus"],
      stackRebaseStatus: { kind: "needsPush" as const },
    };
    expect(computeStackChain([a, mergedB, c], "a")!.needsAttention).toBe(false);
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
    // n1 roots a local chain but is itself a native member of stack-a, so the
    // whole chain keys off the native id — a partially-converted stack must
    // stay ONE identity, not split into chain-half and native-half.
    expect(ids.get("n1")).toBe("native:stack-a");
    expect(ids.get("cv")).toBe("native:stack-a");
    expect(ids.get("n2")).toBe("native:stack-a");
    expect(ids.get("n3")).toBe("native:stack-b");
  });

  it("computeStackHues gives coexisting stacks distinct hues and skips unstacked rows", () => {
    const r1 = wt({ id: "r1", branch: "feat/r1" });
    const c1 = wt({ id: "c1", branch: "feat/c1", stackParent: "feat/r1" });
    const r2 = wt({ id: "r2", branch: "feat/r2" });
    const c2 = wt({ id: "c2", branch: "feat/c2", stackParent: "feat/r2" });
    const hues = computeStackHues([r1, c1, r2, c2, lone]);
    expect(hues.get("r1")).toBe(hues.get("c1"));
    expect(hues.get("r2")).toBe(hues.get("c2"));
    expect(hues.get("r1")).not.toBe(hues.get("r2"));
    expect(hues.has("x")).toBe(false);
    for (const h of hues.values()) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(STACK_HUE_COUNT);
    }
  });

  it("computeStackHues returns empty when fewer than 2 stacks have a visible member", () => {
    const r1 = wt({ id: "r1", branch: "feat/r1" });
    const c1 = wt({ id: "c1", branch: "feat/c1", stackParent: "feat/r1" });
    // Second stack exists but is entirely archived — must not activate hues.
    const r2 = wt({ id: "r2", branch: "feat/r2", archived: true });
    const c2 = wt({ id: "c2", branch: "feat/c2", stackParent: "feat/r2", archived: true });
    expect(computeStackHues([r1, c1]).size).toBe(0);
    expect(computeStackHues([r1, c1, r2, c2]).size).toBe(0);
  });

  it("computeStackHues keeps a chain whole across an archived middle member", () => {
    const root = wt({ id: "r", branch: "feat/root" });
    const mid = wt({ id: "m", branch: "feat/mid", stackParent: "feat/root", archived: true });
    const leaf = wt({ id: "l", branch: "feat/leaf", stackParent: "feat/mid" });
    const other = wt({ id: "o1", branch: "feat/o1" });
    const otherChild = wt({ id: "o2", branch: "feat/o2", stackParent: "feat/o1" });
    const hues = computeStackHues([root, mid, leaf, other, otherChild]);
    // Root and leaf stay one stack (identity resolves through the archived
    // member), and archived rows themselves get no hue entry.
    expect(hues.get("r")).toBe(hues.get("l"));
    expect(hues.get("r")).not.toBe(hues.get("o1"));
    expect(hues.has("m")).toBe(false);
  });

  it("computeStackHues wraps past the palette deterministically", () => {
    const wts = Array.from({ length: STACK_HUE_COUNT + 1 }, (_, i) => [
      wt({ id: `r${String(i).padStart(2, "0")}`, branch: `feat/r${String(i).padStart(2, "0")}` }),
      wt({ id: `c${i}`, branch: `feat/c${i}`, stackParent: `feat/r${String(i).padStart(2, "0")}` }),
    ]).flat();
    const hues = computeStackHues(wts);
    expect(hues.get(`r${String(STACK_HUE_COUNT).padStart(2, "0")}`)).toBe(hues.get("r00"));
  });

  it("CSS palettes define exactly STACK_HUE_COUNT slots (base + every light theme)", () => {
    // fs, not a `?raw` import — the tailwind vite plugin intercepts CSS
    // imports in the test pipeline; cwd-relative because import.meta.url is
    // not a file: URL under vitest's jsdom environment.
    const css = (name: string) => readFileSync(join(process.cwd(), "src/styles", name), "utf8");
    const themeCss = css("theme.css");
    const themesCss = css("themes.css");
    const slots = (s: string) => s.match(/--stack-hue-\d+\s*:/g) ?? [];
    // Base palette: one definition per slot.
    expect(new Set(slots(themeCss)).size).toBe(STACK_HUE_COUNT);
    expect(slots(themeCss).length).toBe(STACK_HUE_COUNT);
    // Each light theme block overrides the full palette with light-tuned
    // values — a new light theme that skips this ships illegible chips.
    expect(slots(themesCss).length).toBe(LIGHT_THEMES.size * STACK_HUE_COUNT);
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

describe("detectAdoptableParent", () => {
  const pr = (over: Partial<NonNullable<Worktree["prStatus"]>> = {}) =>
    ({
      number: 9, state: "open", title: "t", url: "u", draft: false,
      merged: false, branch: "feat/child", baseBranch: "feat/parent",
      author: "chloe", ...over,
    }) as Worktree["prStatus"];
  const parent = wt({ id: "p", branch: "feat/parent" });
  const child = wt({ id: "c", branch: "feat/child", prStatus: pr() });
  const detect = (worktrees: Worktree[], id = "c", def: string | null = "main", user: string | null = "chloe") =>
    detectAdoptableParent(worktrees, id, def, user);

  it("returns the base branch when it matches a sibling worktree", () => {
    expect(detect([parent, child])).toBe("feat/parent");
  });

  it("returns null when a stack parent is already recorded", () => {
    const stacked = { ...child, stackParent: "feat/parent" };
    expect(detect([parent, stacked])).toBeNull();
  });

  it("returns null without a PR, or with a terminal PR", () => {
    expect(detect([parent, wt({ id: "c", branch: "feat/child" })])).toBeNull();
    expect(detect([parent, { ...child, prStatus: pr({ merged: true }) }])).toBeNull();
    expect(detect([parent, { ...child, prStatus: pr({ state: "closed" }) }])).toBeNull();
  });

  it("returns null for native GitHub Stack members", () => {
    const native: NativeStackInfo = { id: "s", number: 1, position: 1, size: 2, members: [] };
    expect(detect([parent, { ...child, prStatus: pr({ nativeStack: native }) }])).toBeNull();
  });

  it("returns null for review-request pulls of someone else's PR", () => {
    expect(detect([parent, { ...child, prStatus: pr({ reviewRequested: true }) }])).toBeNull();
  });

  it("ownership gate: null when the PR author differs, is missing, or the username is unknown", () => {
    expect(detect([parent, { ...child, prStatus: pr({ author: "colleague" }) }])).toBeNull();
    expect(detect([parent, { ...child, prStatus: pr({ author: undefined }) }])).toBeNull();
    expect(detect([parent, child], "c", "main", null)).toBeNull();
    // Case-insensitive: GitHub logins are case-preserving but not case-sensitive.
    expect(detect([parent, child], "c", "main", "Chloe")).toBe("feat/parent");
  });

  it("returns null while the worktree has any live stack-rebase status", () => {
    const conflicted = { ...child, stackRebaseStatus: { kind: "conflict" as const } };
    expect(detect([parent, conflicted])).toBeNull();
  });

  it("returns null when the base is the default branch or default is unresolved", () => {
    const mainWt = wt({ id: "m", branch: "main" });
    const onMain = { ...child, prStatus: pr({ baseBranch: "main" }) };
    expect(detect([mainWt, onMain])).toBeNull();
    expect(detect([parent, child], "c", null)).toBeNull();
  });

  it("returns null when no sibling has the base branch, or it is in another repo / still creating", () => {
    expect(detect([child])).toBeNull();
    const otherRepo = wt({ id: "p2", branch: "feat/parent", repoPath: "/tmp/other" });
    expect(detect([otherRepo, child])).toBeNull();
    const creating = { ...parent, creating: true };
    expect(detect([creating, child])).toBeNull();
  });

  it("returns null when the only sibling with the branch is archived or branch-mode", () => {
    expect(detect([{ ...parent, archived: true }, child])).toBeNull();
    expect(detect([{ ...parent, isBranchMode: true }, child])).toBeNull();
  });

  it("returns null when the parent's own PR is terminal (merged-but-kept branch)", () => {
    const parentPr = pr({ number: 8, branch: "feat/parent", baseBranch: "main" });
    const merged = { ...parent, prStatus: { ...parentPr!, merged: true } };
    expect(detect([merged, child])).toBeNull();
    const closed = { ...parent, prStatus: { ...parentPr!, state: "closed" as const } };
    expect(detect([closed, child])).toBeNull();
    // A parent with a live PR (or no PR at all) still qualifies.
    const open = { ...parent, prStatus: parentPr };
    expect(detect([open, child])).toBe("feat/parent");
  });
});
