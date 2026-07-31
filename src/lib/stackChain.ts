import type { Worktree } from "../types";

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
  "rewrittenExternally",
]);

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

  // Walk up to the root (cycle-guarded).
  let root = self;
  const seen = new Set<string>([root.id]);
  for (let hops = 0; hops < worktrees.length; hops++) {
    const parent = root.stackParent ? byBranch.get(root.stackParent) : undefined;
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id);
    root = parent;
  }

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
      (m) => m.stackRebaseStatus != null && ATTENTION_KINDS.has(m.stackRebaseStatus.kind),
    ),
  };
}
