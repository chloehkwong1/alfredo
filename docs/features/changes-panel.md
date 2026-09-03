---
title: Changes panel — Files, Commits, PR tabs
keywords: [changes, panel, files, commits, pr, diff, changes panel, right panel, focus mode, widen panel]
ui_path: Right side of workspace → Changes panel (toggle with Cmd+I)
---

Every worktree has a **Changes** panel on the right side of the
workspace. Toggle it with **Cmd+I** or the panel icon in the status
bar. It has up to three tabs:

- **Files** — uncommitted and committed diffs in a file tree.
  Click any file to open its diff; right-click for "Open in Editor"
  and "Copy Path". An **Open in editor** button also sits on each
  file's header inside the diff view itself. The count in the tab label renders as a small
  **pill chip** next to the label. Markdown files (`.md`, `.markdown`,
  `.mdx`) get a hover-revealed Eye toggle for rendered preview — see
  [markdown rendered view](markdown-rendered-view.md).
- **Commits** — the list of commits on this branch vs. the base
  branch. Click a commit to filter the diff view to just that commit;
  click again to go back to the full branch diff. The count chip
  matches the Files tab. With a commit selected, a **sticky header**
  pins to the top of the diff column with inline **prev/next**
  arrows; `j` / `k` walk through commits from the keyboard.
  Right-click a commit row for **Drop Commit…** — after a
  confirmation it removes that commit and replays the later ones on
  top (nothing changes if a later commit depends on it). If the
  commit is already on origin, the dialog warns that dropping it
  rewrites pushed history and will need a force-push.
- **PR** — only appears once Alfredo detects a pull request for the
  branch. Shows PR title, description, merge status, reviews, and
  inline comment threads (see pr-checks doc for the checks section,
  and [PR review](pr-review.md) for submitting a review from here).

**Focus mode** widens the panel to take over the workspace while you
read a large diff. Toggle it with **⌘⇧E**, the "Focus mode — widen
this panel" button in the panel header, or the command palette. It is
remembered per worktree, and the terminal keeps running underneath.
In normal mode the panel can be dragged up to 70% of the window.

At the bottom of the panel an **origin sync banner** appears whenever
the branch is out of step with its upstream. The label reads `N ahead
of origin/<branch>`, `N behind origin/<branch>`, `A ahead · B behind
origin/<branch>`, or `No upstream branch`, and the CTA matches:
**Push** when only ahead, **Pull** when only behind (`git pull
--rebase`), **Sync** when both directions diverged (pull --rebase then
push), or **Publish** when the branch has never been pushed. The
banner hides entirely when the branch is in sync, when you're on the
pinned main card, and in branch mode. It polls every 60 seconds while
the panel is open.

Branch mode on the default branch hides the tab bar because there's
nothing to diff against — only the uncommitted file list is shown.
