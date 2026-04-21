---
title: Copy branch name, open Linear ticket, view PR on GitHub
keywords: [copy, branch name, clipboard, linear, ticket, pr, pull request, github, open in browser, external link]
ui_path: Sidebar → right-click worktree → Copy Branch Name / Open in Linear / View PR on GitHub
---

Three quick-access items on the worktree right-click menu:

- **Copy Branch Name** — copies the git branch name (or the worktree
  folder name if no branch is set) to the clipboard. Useful for
  pasting into PRs, commit messages, or Slack.
- **Open in Linear** — opens the worktree's linked Linear ticket in
  your browser. Only appears if the worktree has a ticket URL
  attached (either created from a Linear issue via the
  create-worktree dialog, or auto-linked by branch name matching an
  issue identifier).
- **View PR on GitHub** — opens the pull request in your browser.
  Only appears once Alfredo has detected a PR for this branch
  (requires a GitHub token / `gh` login on the Integrations tab).

Copy PR URL is also available from the command palette when the
active worktree has a PR.
