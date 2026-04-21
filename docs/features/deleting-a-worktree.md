---
title: Deleting a worktree
keywords: [delete, remove, worktree, branch, trash, clean up]
ui_path: Sidebar → right-click worktree → Delete worktree…
---

Right-click a worktree and choose **Delete worktree…** (bottom of
the menu, in red). A confirmation dialog appears — Alfredo does not
delete immediately because the action removes both the git worktree
directory and the local branch.

What gets deleted:

- The worktree directory on disk.
- The local git branch (the remote branch, if any, is untouched).
- The worktree's kanban column entry, tab layout, and any per-worktree
  settings.

What does NOT get deleted:

- Any commits that were merged to another branch.
- Remote branches — push/delete those separately from the GitHub UI
  or `gh`.
- The repo itself.

If you want to keep the worktree around but get it out of the main
board, use **Archive** instead — it hides the worktree while leaving
the directory and branch intact, and Alfredo can auto-delete archived
worktrees after N days (see auto-cleanup).
