---
title: Copy branch name, open Linear ticket, view PR on GitHub, click links in terminal
keywords: [copy, branch name, clipboard, linear, ticket, pr, pull request, github, open in browser, external link, terminal links, clickable, file path, localhost, mailto, email]
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

**Clickable links inside terminal panes:**

- **URLs** — `http`, `https`, `ssh`, `ftp`, `file`, and `mailto`
  links are highlighted and open in your default browser / mail
  client on click.
- **`localhost`** and **`127.0.0.1`** with an optional `:PORT` —
  click to open in your default browser. Works for any port,
  including the one your run-script is currently using.
- **File paths** — absolute paths and `~/`-prefixed paths are
  highlighted. Optional `:line` or `:line:column` suffixes are
  honoured. Click to open the path with your OS's default handler.
- **Email addresses** — click to compose in your default mail
  client.

Lines that wrap across multiple terminal rows are joined into one
logical line, so long links spanning the wrap point still match as a
single clickable unit.
