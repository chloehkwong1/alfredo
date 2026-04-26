---
title: Diff view — unified vs split, expanding context, commit filter
keywords: [diff, unified, split, side by side, expand, context, commit, view mode, switch view, toggle diff]
ui_path: Changes panel → Files tab → open a file; toggle mode in the status bar
---

Alfredo renders diffs either **unified** (one column with +/- lines)
or **split** (two columns, old and new side by side). Toggle modes
for the current worktree from the status bar at the bottom of the
diff. The default for new worktrees comes from Settings → General →
Default diff view.

Other diff-view controls:

- **Expand context** — small arrows between hunks reveal more lines
  of surrounding context. Click as many times as you need; the hunk
  grows until you hit the next hunk or the file boundary.
- **Commit filter** — from the Commits tab, clicking a commit scopes
  the diff view to just that commit's changes. Click it again (or
  switch back to Files) to see the full branch diff.
- **Working tree vs. committed** — uncommitted changes show above
  the committed diff. A header separates them; they can't currently
  be toggled off individually.
- **In-diff search** — ⌘F inside the Changes panel opens the diff
  search bar and highlights matches across the visible diff,
  including diffs scoped to a single commit. The shortcut is
  pane-scoped, so it won't fire if your focus is in a terminal pane
  alongside the diff.

Syntax highlighting and file icons are per-extension. Binary files
and images render as "binary diff" placeholders rather than line-by-line.
