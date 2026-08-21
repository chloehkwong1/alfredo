import type { Worktree } from "../types";
import { isVisibleWorktree } from "./worktreeVisibility";
import { isTerminalPr } from "./prStatus";

export interface StackMember {
  id: string;
  /** Distance from the stack root; root = 1. Siblings share a depth. */
  depth: number;
  /** File-tree guide for the stack map, e.g. "    │ └". */
  prefix: string;
}

export interface StackChain {
  /** DFS order, root first — the stack map renders this top-down. */
  members: StackMember[];
  /** `self`'s depth from the root (root = 1); siblings legitimately share it. */
  position: number;
  /** Every branch in the stack tree, all forks included. */
  total: number;
  rootId: string;
  /** True when any branch in the stack has ≥2 children stacked on it. */
  forked: boolean;
  needsAttention: boolean;
}

const ATTENTION_KINDS = new Set([
  "conflict",
  "skippedDirty",
  "pushFailed",
  "behind",
  "rebasing",
  "needsPush",
  "rewrittenExternally",
]);

/** Follow `stackParent` edges up to the stack root (cycle-guarded). */
function resolveRoot(byBranch: Map<string, Worktree>, self: Worktree, maxHops: number): Worktree {
  let root = self;
  const seen = new Set<string>([root.id]);
  for (let hops = 0; hops < maxHops; hops++) {
    const parent = root.stackParent ? byBranch.get(root.stackParent) : undefined;
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    root = parent;
  }
  return root;
}

/**
 * Resolve the full stack tree containing `worktreeId`. `stackParent` stores a
 * *branch name*; edges resolve via each worktree's own `branch`. Null when the
 * worktree is not part of any stack.
 */
export function computeStackChain(worktrees: Worktree[], worktreeId: string): StackChain | null {
  const self = worktrees.find((w) => w.id === worktreeId);
  if (!self) return null;

  // The store's list spans every repo; stack edges resolve by bare branch
  // name, so an unscoped walk folds same-named branches from other repos
  // into the tree.
  const repoWorktrees = worktrees.filter((w) => w.repoPath === self.repoPath);

  const byBranch = new Map(repoWorktrees.map((w) => [w.branch, w]));
  const childrenOf = new Map<string, Worktree[]>();
  for (const w of repoWorktrees) {
    if (!w.stackParent) continue;
    const list = childrenOf.get(w.stackParent) ?? [];
    list.push(w);
    childrenOf.set(w.stackParent, list);
  }

  const isStacked = Boolean(self.stackParent) || (childrenOf.get(self.branch)?.length ?? 0) > 0;
  if (!isStacked) return null;

  const root = resolveRoot(byBranch, self, repoWorktrees.length);

  // DFS over the whole tree (cycle-guarded), children sorted for determinism,
  // collecting depth and file-tree guide prefixes for the stack map.
  const members: StackMember[] = [];
  const memberWts: Worktree[] = [];
  const visited = new Set<string>();
  const walk = (node: Worktree, depth: number, ancestorGuides: string, isLast: boolean) => {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    members.push({ id: node.id, depth, prefix: ancestorGuides + (isLast ? "└" : "├") });
    memberWts.push(node);
    const kids = (childrenOf.get(node.branch) ?? []).slice().sort((x, y) => x.branch.localeCompare(y.branch));
    const childGuides = ancestorGuides + (isLast ? "  " : "│ ");
    kids.forEach((kid, i) => walk(kid, depth + 1, childGuides, i === kids.length - 1));
  };
  walk(root, 1, "", true);

  const selfMember = members.find((m) => m.id === self.id);
  if (!selfMember) return null;
  return {
    members,
    position: selfMember.depth,
    total: members.length,
    rootId: root.id,
    forked: memberWts.some((w) => (childrenOf.get(w.branch)?.length ?? 0) > 1),
    needsAttention: memberWts.some(
      (m) =>
        // Merged members render muted "merged ✓" with no actions — a leftover
        // status on one (e.g. a needsPush whose deleted upstream can never
        // heal it) would light an amber "!" that points at nothing.
        !m.prStatus?.merged &&
        ((m.stackRebaseStatus != null && ATTENTION_KINDS.has(m.stackRebaseStatus.kind)) ||
          m.stackPending != null),
    ),
  };
}

/** Palette size for per-stack hue coding — keep in sync with the
 *  `--stack-hue-N` variables in theme.css. */
export const STACK_HUE_COUNT = 6;

/**
 * Hue slots for every visible stacked worktree, or an empty map when fewer
 * than 2 stacks have a visible member (single-stack sidebars keep the accent
 * tint). Identities resolve over the FULL worktree list so a chain stays one
 * stack across archived members; visibility (the sidebar's own filter) only
 * gates which stacks count and get slots. Slots are assigned sequentially
 * over sorted identities — sequential (not hashed) so coexisting stacks never
 * share a hue until the palette is exhausted; the cost is that a stack's hue
 * can shift when another stack appears or disappears.
 */
export function computeStackHues(worktrees: Worktree[]): Map<string, number> {
  const identities = collectStackIdentities(worktrees);
  const visibleIdentities = new Map(
    worktrees
      .filter((wt) => isVisibleWorktree(wt) && identities.has(wt.id))
      .map((wt) => [wt.id, identities.get(wt.id)!]),
  );
  const distinct = [...new Set(visibleIdentities.values())].sort();
  if (distinct.length < 2) return new Map();
  const slotByIdentity = new Map(distinct.map((identity, i) => [identity, i % STACK_HUE_COUNT]));
  return new Map(
    [...visibleIdentities].map(([worktreeId, identity]) => [worktreeId, slotByIdentity.get(identity)!]),
  );
}

/** Per-array memo so N sidebar rows (and the drag overlay) share one
 *  computation per store update instead of each redoing the O(N) pass. */
const hueCache = new WeakMap<Worktree[], Map<string, number>>();
export function stackHuesFor(worktrees: Worktree[]): Map<string, number> {
  let hues = hueCache.get(worktrees);
  if (!hues) {
    hues = computeStackHues(worktrees);
    hueCache.set(worktrees, hues);
  }
  return hues;
}

/**
 * Map worktree id → stable stack identity for every stacked worktree: the
 * local chain's root worktree id when a chain exists, else the native GitHub
 * stack id. Unstacked worktrees are absent, so the number of distinct values
 * is the number of stacks on screen.
 */
export function collectStackIdentities(worktrees: Worktree[]): Map<string, string> {
  const identities = new Map<string, string>();
  const byRepo = new Map<string, Worktree[]>();
  for (const w of worktrees) {
    const list = byRepo.get(w.repoPath) ?? [];
    list.push(w);
    byRepo.set(w.repoPath, list);
  }
  for (const repoWorktrees of byRepo.values()) {
    const byBranch = new Map(repoWorktrees.map((w) => [w.branch, w]));
    const parentBranches = new Set<string>();
    for (const w of repoWorktrees) {
      if (w.stackParent) parentBranches.add(w.stackParent);
    }
    for (const w of repoWorktrees) {
      if (w.stackParent || parentBranches.has(w.branch)) {
        // A chain rooted at a native GitHub Stack member is a *partially
        // converted* native stack — key the whole chain off the native id so
        // it shares an identity with pure-native stack-mates instead of
        // splitting one stack into two identities.
        const root = resolveRoot(byBranch, w, repoWorktrees.length);
        const nativeId = root.prStatus?.nativeStack?.id;
        identities.set(w.id, nativeId != null ? `native:${nativeId}` : root.id);
      } else if (w.prStatus?.nativeStack) {
        identities.set(w.id, `native:${w.prStatus.nativeStack.id}`);
      }
    }
  }
  return identities;
}

/** Per-array index of visible, materialized worktrees by repo+branch, so N
 *  sidebar rows share one O(N) pass per store update instead of each redoing
 *  a linear sibling scan (same memo pattern as stackHuesFor). Archived and
 *  branch-mode/synthetic entries are excluded up front: neither is a parent a
 *  user can see or should adopt onto. First-encountered wins. */
const branchIndexCache = new WeakMap<Worktree[], Map<string, Worktree>>();
function branchIndexFor(worktrees: Worktree[]): Map<string, Worktree> {
  let index = branchIndexCache.get(worktrees);
  if (!index) {
    index = new Map();
    for (const wt of worktrees) {
      if (!isVisibleWorktree(wt) || wt.creating || wt.createError) continue;
      const key = `${wt.repoPath}::${wt.branch}`;
      if (!index.has(key)) index.set(key, wt);
    }
    branchIndexCache.set(worktrees, index);
  }
  return index;
}

/** A PR whose GitHub base points at a sibling worktree's branch, with no local
 *  stack relationship recorded (e.g. an agent ran `gh pr edit --base` in the
 *  terminal). Returns the adoptable parent branch, or null. Only the user's
 *  OWN PRs qualify (author must match the authenticated login — the durable
 *  ownership fact; `reviewRequested` is just a fast-path for review pulls, and
 *  a missing author fails closed). Also excluded: native GitHub Stack members
 *  (Alfredo's automation stands down for those), worktrees with any live
 *  stack-rebase status (the backend already treats those as stack-involved,
 *  e.g. change_base persisted a parent then conflicted before the store
 *  learned of it), and invisible siblings (archived / branch-mode). Detection
 *  only — adoption is always an explicit user click routed through
 *  change_base. */
export function detectAdoptableParent(
  worktrees: Worktree[],
  worktreeId: string,
  defaultBranch: string | null,
  githubUsername: string | null,
): string | null {
  if (!defaultBranch || !githubUsername) return null;
  const w = worktrees.find((x) => x.id === worktreeId);
  const pr = w?.prStatus;
  if (!w || !pr) return null;
  if (w.stackParent || isTerminalPr(pr) || pr.nativeStack || pr.reviewRequested) return null;
  if (w.stackRebaseStatus) return null;
  if (!pr.author || pr.author.toLowerCase() !== githubUsername.toLowerCase()) return null;
  const base = pr.baseBranch;
  if (!base || base === defaultBranch) return null;
  const parent = branchIndexFor(worktrees).get(`${w.repoPath}::${base}`);
  return parent && parent.id !== w.id ? base : null;
}
