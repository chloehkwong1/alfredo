---
title: Rebasing a worktree and managing stacks (parent branches)
keywords: [rebase, stack, stacked, parent, base branch, create branch from, detach, dependent branch]
ui_path: Sidebar → right-click worktree → Rebase onto … / Create branch from this / Detach from stack
---

Alfredo's right-click menu has three stack-related actions:

- **Rebase onto _main_** (or onto the worktree's stack parent, if set)
  — runs `git rebase` under the hood, replaying this branch's commits
  on top of the target. If the worktree has a stack parent, the
  menu item says "Rebase onto \<parent-name\>" instead of the default
  branch.
- **Create branch from this** — opens the new-worktree dialog with
  the current worktree pre-selected as the base. The new worktree
  becomes a stacked child, so rebasing it later targets this branch
  by default.
- **Detach from stack** — only appears on worktrees that have a
  stack parent. Removes the parent relationship so the worktree
  becomes independent and future rebases target the repo's default
  branch again.

Stacks are just a recorded parent-child link between worktrees —
there's no separate "stack manager" surface. If a rebase hits
conflicts, resolve them in the worktree terminal like any manual
`git rebase`.
