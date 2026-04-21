---
title: Renaming a worktree
keywords: [rename, label, alias, nickname]
ui_path: Sidebar → double-click worktree label (or use inline edit)
---

Worktrees are labelled with their branch name by default, but you can give
any worktree a friendlier display label without touching the branch itself.
In the sidebar, double-click the worktree's label text and an inline text
input appears in place of the name. Type the new label and press Enter to
commit, or Escape to cancel. Clicking away also commits the change.

The label only affects how the worktree is shown in Alfredo's sidebar and
tabs — the underlying git branch is untouched. To clear a custom label and
go back to the branch name, rename it to an empty string (or to the branch
name itself) and Alfredo will drop the override. Labels are stored per-repo in
your global Alfredo config, so they persist across app restarts and are
shared anywhere the same repo is viewed in Alfredo.
