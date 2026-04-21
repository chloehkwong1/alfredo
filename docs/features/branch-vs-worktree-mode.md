---
title: Branch mode vs. worktree mode — which to pick per repo
keywords: [branch mode, worktree mode, repo mode, mode, branches, worktrees, difference, switch mode]
ui_path: Sidebar footer → Repository Settings → Mode toggle (Branches / Worktrees)
---

Each repo in Alfredo runs in one of two modes. You pick when you
add the repo and can switch any time from Repository Settings.

**Worktree mode** — the full Alfredo experience. Alfredo creates a
git worktree per branch, gives each one its own agent tab and
kanban status, and lets you run many worktrees in parallel without
stepping on each other. This is the mode to use when you're
juggling multiple tasks per repo or want stacks, auto-archive, PR
flows, and the kanban board.

**Branch mode** — lightweight. The repo is a single entry in the
sidebar that follows whichever branch you're checked out on. No
kanban columns, no per-worktree tabs, no stacks. Alfredo polls the
active branch and diff stats every few seconds so the sidebar stays
in sync when you switch branches in the terminal. Pick this for
small repos where you never work on more than one thing at a time,
or for repos where creating worktrees isn't worth the overhead.

Switching modes mid-stream updates the sidebar but won't touch
your worktrees on disk.

**Heads up:** branch mode is less battle-tested than worktree mode
and may be a bit janky in places. If something looks off in branch
mode, file an issue so it can be fixed.
