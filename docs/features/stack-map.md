---
title: Stack map — see and manage a whole stack at a glance
keywords: [stack map, stack glyph, pos/total, restack stack, stack popover, conflict resolve, native stack, github stack, managed by github, push now, needs push, stack colours, hue, amber]
ui_path: Sidebar → stack glyph (e.g. "2/4") on a stacked worktree row
---

Any worktree that's part of a stack shows a small **pos/total** glyph
next to its name — e.g. "2/4" for the second branch in a four-deep
stack; the base worktree shows "1/4". Hover it to highlight every
worktree in that stack across the sidebar; click it to open the
**stack map**, a popover listing every member from tip down to the
base branch. Forked stacks — two children sharing one parent — render
as a tree, and the glyph shows honest depth/size for the branch you're
on. When two or more stacks coexist in the sidebar, each stack's
chips get their own colour tint so you can tell the stacks apart at a
glance.

Each member is tagged with its current state: up to date, N behind,
rebasing…, conflict on rebase, paused — uncommitted changes,
restacked · push failed, restacked · push to update PR, restack
queued (waiting for a busy agent), rebased outside Alfredo — restack
manually, restacked by GitHub, or merged. States needing your action
render red, benign states grey, and everything in flux amber — the
same amber as the "!" the chip shows, so the popover always names
what lit it. Error states always win over a "merged ✓" tag. Below the
list, a **last action** line traces what Alfredo most recently did to
the stack (e.g. a deferred restack that ran after the agent went
idle), so a rebase that happened in the background is never a
mystery.

Click any member in the popover to jump straight to it. The footer's
**Sync stack with main** action syncs the root with `origin/main`,
then restacks the whole stack in one go. When a member is restacked
locally but not yet pushed, a **Push \<branch\>** action appears —
one click force-pushes it (with lease) to update its PR. When a
member has hit a conflict, two extra actions appear:

- **Have Claude resolve** — re-runs the conflicted rebase leaving the
  conflict in the tree (not aborted), then hands that worktree's agent
  session a ready-made resolution prompt.
- **Retry restack** — re-runs the rebase from scratch, for when the
  parent has already moved past the conflict.

Members of a **native GitHub Stack** show the same N/M chip (beside
the PR pill) and the popover switches to a GitHub-parity roster: a
"Stack #N" header marked **Managed by GitHub**, every member in stack
order — including siblings with no local worktree — and the base
branch. GitHub owns the PR-side restacking, but the popover still
carries local actions: a **Restack now** button rebases the branch
onto its local parent (GitHub only restacks around merges — hover a
"N behind" state for the tooltip explaining this), the same **Push
\<branch\>** action appears for locally-restacked members, conflict
members get **Have Claude resolve** / **Retry restack**, and the last
local sync is traced in the footer (see the rebasing-and-stacks doc
for the sync contract).
