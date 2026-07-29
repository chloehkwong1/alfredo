---
title: Change a worktree's base branch
keywords: [change base, base branch, stack parent, rebase target, re-point, restack, parent branch, behind count, stacking]
ui_path: Sidebar → right-click a worktree → Change base branch...
---

Alfredo tracks each worktree's **base branch** — the branch it
considers its parent for rebases and the "N behind" indicator.
By default that's the repo's default branch (usually `main`), but
stacked branches need a different parent.

To change it, right-click a worktree in the sidebar and pick
**Change base branch...**. A dialog opens with:

- The **current base** at the top.
- A **filter** input — type to narrow the branch list.
- The **branch list** — click any branch to make it the new base.
  Picking the default branch detaches the worktree from its stack
  parent and treats it as a regular branch again.

Changing the base **migrates the branch immediately**: Alfredo replays
only this worktree's own commits onto the new base with
`git rebase --onto`, so history that came along from the old parent
doesn't tag along too. If the rebase hits conflicts it aborts safely —
the branch is left exactly as it was, and both the old and new base
stay visible so you can sort things out and reopen **Change base
branch...** to retry.

Once a worktree has a non-default parent, its sidebar row shows a
small **parent-branch link** next to the branch name. Clicking it
jumps to the parent worktree if it exists in the workspace, so you
can walk up a stack without scrolling. Detach from the stack via
**Detach from stack** in the same context menu.
