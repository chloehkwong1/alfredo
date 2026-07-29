---
title: Stack map — see and manage a whole stack at a glance
keywords: [stack map, stack glyph, pos/total, restack stack, stack popover, conflict resolve]
ui_path: Sidebar → stack glyph (e.g. "2/4") on a stacked worktree row
---

Any worktree that's part of a stack shows a small **pos/total** glyph
next to its name — e.g. "2/4" for the second branch in a four-deep
stack. Hover it to highlight every worktree in that stack across the
sidebar; click it to open the **stack map**, a popover listing every
member from tip down to the base branch, each tagged with its current
state: up to date, N behind, rebasing…, conflict on rebase, paused —
uncommitted changes, or restacked · push failed.

Click any member in the popover to jump straight to it. A footer button
restacks the whole stack in one go. When a member has hit a conflict,
two extra actions appear:

- **Have Claude resolve** — re-runs the conflicted rebase leaving the
  conflict in the tree (not aborted), then hands that worktree's agent
  session a ready-made resolution prompt.
- **Retry restack** — re-runs the rebase from scratch, for when the
  parent has already moved past the conflict.
