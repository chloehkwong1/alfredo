---
title: Creating a new worktree (from a branch, PR, or Linear ticket)
keywords: [create, new worktree, new branch, from branch, from pr, from ticket, linear, pull request, cmd+n]
ui_path: Sidebar → + button (or Cmd+N) → pick a tab
---

Hit the **+** button at the top of the sidebar — or **Cmd+N** from
anywhere — to open the **New Worktree** dialog. It has four tabs:

- **Linear Issues** — lists Linear tickets assigned to you (if
  Integrations → Linear is connected). Pick one and the new worktree
  inherits the ticket's identifier as the branch name and attaches
  the ticket link.
- **PRs** — lists open GitHub pull requests in the repo. Pick one and
  Alfredo checks out the PR's branch into a new worktree.
- **Branches** — lists existing local branches. Use this when you
  want a worktree for a branch you've already created in the terminal.
- **New Branch** — the blank slate. Type a branch name and pick the
  base (defaults to the repo's default branch).

If you right-click an existing worktree and pick **Create branch from
this**, the dialog opens pre-locked to New Branch with that worktree
as the base — handy for building stacks.
