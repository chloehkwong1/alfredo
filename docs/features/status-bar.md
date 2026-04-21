---
title: The status bar (branch name, diff stats, Linear, PR)
keywords: [status bar, branch, copy branch, diff stats, additions, deletions, linear ticket, pr number, annotations]
ui_path: Top of every worktree view, between the tab bar and the content
---

The thin bar at the top of each worktree view is the **status bar**.
It surfaces the key identifiers for that worktree, with a few
click-to-act buttons.

Left side:

- **Branch name** — click to copy to clipboard (shows a ✓ icon on
  success).
- **+N / -N** — uncommitted-or-branch diff stats (additions /
  deletions). Hidden when there are no changes.

Right side:

- **Linear ticket identifier** (e.g. PRO-1234) — click to open the
  ticket in your browser. Appears when the worktree has a linked
  Linear ticket.
- **PR badge** — "Draft PR #123" or "Open PR #123". Click to open
  on GitHub. Appears once Alfredo detects a PR for the branch.
- **Annotation count** — small pill with the number of inline
  diff annotations on the current worktree.

Beyond identifiers, the status bar is the quickest path to toggle
the diff view mode (Unified / Split) when you're looking at a diff —
look for the toggle near the right edge.
