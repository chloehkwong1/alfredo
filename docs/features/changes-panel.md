---
title: Changes panel — Files, Commits, PR tabs
keywords: [changes, panel, files, commits, pr, diff, changes panel, right panel]
ui_path: Right side of workspace → Changes panel (toggle with Cmd+I)
---

Every worktree has a **Changes** panel on the right side of the
workspace. Toggle it with **Cmd+I** or the panel icon in the status
bar. It has up to three tabs:

- **Files** — uncommitted and committed diffs in a file tree.
  Click any file to open its diff; right-click for "Open in Editor"
  and "Copy Path". The count in the tab label renders as a small
  **pill chip** next to the label. Markdown files (`.md`, `.markdown`,
  `.mdx`) get a hover-revealed Eye toggle for rendered preview — see
  [markdown rendered view](markdown-rendered-view.md).
- **Commits** — the list of commits on this branch vs. the base
  branch. Click a commit to filter the diff view to just that commit;
  click again to go back to the full branch diff. The count chip
  matches the Files tab.
- **PR** — only appears once Alfredo detects a pull request for the
  branch. Shows PR title, description, merge status, reviews, and
  inline comment threads (see pr-checks doc for the checks section).

Branch mode on the default branch hides the tab bar because there's
nothing to diff against — only the uncommitted file list is shown.
