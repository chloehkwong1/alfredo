import type { Worktree } from "../types";

export interface StackChain {
  memberIds: string[];
  position: number;
  total: number;
  rootId: string;
  needsAttention: boolean;
}

const ATTENTION_KINDS = new Set(["conflict", "skippedDirty", "pushFailed", "behind", "rebasing"]);

/**
 * Resolve the full stack chain containing `worktreeId`, ordered root→tip.
 * `stackParent` stores a *branch name*; edges resolve via each worktree's own
 * `branch`. Null when the worktree is not part of any stack.
 */
export function computeStackChain(worktrees: Worktree[], worktreeId: string): StackChain | null {
  const self = worktrees.find((w) => w.id === worktreeId);
  if (!self) return null;

  const byBranch = new Map(worktrees.map((w) => [w.branch, w]));
  const childrenOf = new Map<string, Worktree[]>();
  for (const w of worktrees) {
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

  // Walk down from the root. Linear chains only (first child per level, sorted
  // for determinism) — forks render as separate linear chains from each fork tip.
  const memberIds: string[] = [];
  const members: Worktree[] = [];
  let cursor: Worktree | undefined = root;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id) && memberIds.length <= worktrees.length) {
    visited.add(cursor.id);
    memberIds.push(cursor.id);
    members.push(cursor);
    const kids = (childrenOf.get(cursor.branch) ?? []).slice().sort((x, y) => x.branch.localeCompare(y.branch));
    // Prefer the child on the path to `self`, else the first child.
    cursor = kids.find((k) => pathContains(k, self, byBranch, worktrees.length)) ?? kids[0];
  }

  const position = memberIds.indexOf(self.id) + 1;
  if (position === 0) return null;
  return {
    memberIds,
    position,
    total: memberIds.length,
    rootId: root.id,
    needsAttention: members.some(
      (m) => m.stackRebaseStatus != null && ATTENTION_KINDS.has(m.stackRebaseStatus.kind),
    ),
  };
}

/** True when following `self`'s parent links reaches `candidate`. */
function pathContains(
  candidate: Worktree,
  self: Worktree,
  byBranch: Map<string, Worktree>,
  maxHops: number,
): boolean {
  let cursor: Worktree | undefined = self;
  for (let hops = 0; hops <= maxHops && cursor; hops++) {
    if (cursor.id === candidate.id) return true;
    cursor = cursor.stackParent ? byBranch.get(cursor.stackParent) : undefined;
  }
  return false;
}
