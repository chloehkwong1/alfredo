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
Untracked files (agent scratch like `.claude/`) don't count as dirty —
only real uncommitted changes to tracked files pause a restack.

When a restack can't run yet because the child's agent is busy, it
queues instead of being dropped: the sidebar row shows **restack
queued — agent busy** and the stack map tags the member "restack
queued". The restack fires on its own once the agent goes idle.
A whole stack cascades in one pass, in dependency order, so rebasing a
grandparent ripples down through its children without manual restacks
at each level. Any branch with an upstream is force-pushed with
`--force-with-lease` after a successful restack; a rejected lease shows
as **restacked · push failed** instead of silently diverging from the
remote.

**Sync stack with main** (the stack map's footer action) goes one step
further than a cascade: it first syncs the stack's *root* with
`origin/main` — pulling in whatever merged while you worked — then
restacks every child in dependency order, so the whole stack lands on
current main in one action.

If a restack hits a conflict, a toast appears bottom-right and the
branch's status sticks at **conflict on rebase** until it's resolved —
Alfredo won't keep retrying a rebase it already knows will fail. Open
the stack map (the stack glyph on the worktree row) to resolve it,
including handing the conflict to that worktree's Claude session; root
sync conflicts are handed off the same way. See "Stack map" in this
doc set.

**Create branch from this** starts a new stacked child from the current
worktree. **Detach from stack** (shown once a stack parent is set)
drops the parent relationship, so future restacks target the repo's
default branch again.
