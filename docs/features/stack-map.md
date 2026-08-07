---
title: Stack map — see and manage a whole stack at a glance
keywords: [stack map, stack glyph, pos/total, restack stack, stack popover, conflict resolve, native stack, github stack, managed by github]
ui_path: Sidebar → stack glyph (e.g. "2/4") on a stacked worktree row
---

Any worktree that's part of a stack shows a small **pos/total** glyph
next to its name — e.g. "2/4" for the second branch in a four-deep
stack (the stack's base worktree is chipped **root**). Hover it to
highlight every worktree in that stack across the sidebar; click it to
open the **stack map**, a popover listing every member from tip down
to the base branch. Forked stacks — two children sharing one parent —
render as a tree, and the glyph shows honest depth/size for the branch
you're on.

Each member is tagged with its current state: up to date, N behind,
rebasing…, conflict on rebase, paused — uncommitted changes,
restacked · push failed, restack queued (waiting for a busy agent),
or merged. Error states always win over a "merged ✓" tag. Below the
list, a **last action** line traces what Alfredo most recently did to
the stack (e.g. a deferred restack that ran after the agent went
idle), so a rebase that happened in the background is never a
mystery.

Click any member in the popover to jump straight to it. The footer's
**Sync stack with main** action syncs the root with `origin/main`,
then restacks the whole stack in one go. When a member has hit a
conflict, two extra actions appear:

- **Have Claude resolve** — re-runs the conflicted rebase leaving the
  conflict in the tree (not aborted), then hands that worktree's agent
  session a ready-made resolution prompt.
- **Retry restack** — re-runs the rebase from scratch, for when the
  parent has already moved past the conflict.

Members of a **native GitHub Stack** show the same N/M chip (beside
the PR pill) and the popover switches to a GitHub-parity roster: a
"Stack #N" header marked **Managed by GitHub**, every member in stack
order — including siblings with no local worktree — and the base
branch. Alfredo's restack actions don't apply to native members;
GitHub handles restacking (see the rebasing-and-stacks doc).
