---
title: Restacking a stacked worktree (parent branches)
keywords: [rebase, restack, stack, stacked, parent, base branch, force-with-lease, create branch from, detach]
ui_path: Sidebar → right-click a stacked worktree → Restack now / Create branch from this / Detach from stack
---

Alfredo tracks a **baseline** for every stacked worktree — the parent
commit it last replayed from — and restacks with `git rebase --onto`
instead of a plain rebase. A child only ever replays its own commits, so
restacking survives the parent being amended, force-pushed, or
squash-merged, instead of the duplicate-commit pileups a plain rebase
used to produce.

Right-click a stacked worktree and the rebase item now reads **Restack
now** (it says "Rebase onto \<branch\>" only for worktrees with no stack
parent set). You don't have to trigger it yourself: a background pass
watches every stacked worktree's local branch tip, and once a parent's
tree is clean and its agent is idle, restacks the child automatically.
A whole stack cascades in one pass, in dependency order, so rebasing a
grandparent ripples down through its children without manual restacks
at each level. Any branch with an upstream is force-pushed with
`--force-with-lease` after a successful restack; a rejected lease shows
as **restacked · push failed** instead of silently diverging from the
remote.

If a restack hits a conflict, the branch's status sticks at **conflict
on rebase** until it's resolved — Alfredo won't keep retrying a rebase
it already knows will fail. Open the stack map (the stack glyph on the
worktree row) to resolve it; see "Stack map" in this doc set.

**Create branch from this** starts a new stacked child from the current
worktree. **Detach from stack** (shown once a stack parent is set)
drops the parent relationship, so future restacks target the repo's
default branch again.
