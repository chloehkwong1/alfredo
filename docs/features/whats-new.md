---
title: What's new — recent Alfredo releases
keywords: [whats new, changelog, release notes, updates, new features, latest]
ui_path: N/A — full notes at github.com/chloehkwong1/alfredo/releases
---

Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

**v0.14.1 — 2026-05-07**
- New-worktree dialog now validates branch names inline against
  git's `check-ref-format` rules — invalid characters (spaces, `~`,
  `^`, `:`, `?`, etc.) show an inline error and keep the Create
  button disabled instead of failing with a toast after the
  worktree creation kicks off.

**v0.14.0 — 2026-05-07**
- **Repo-shared `alfredo.json`** — repos can now ship a committed
  `alfredo.json` that teammates inherit (setup scripts, run script,
  archive script, port range, port env var, default agent). Personal
  settings layer on top, with badges showing inheritance and a
  **Reset to repo default** action per field. The Workspace Settings
  dialog has been split into **General / Scripts / Ports** tabs, and
  a chip in the header shows whether `alfredo.json` is tracked in
  git. On first load, any personal repo-shared values are migrated
  silently into `alfredo.json` so existing setups don't drift.
- **Dock badge for needs-attention worktrees** — the macOS dock icon
  now mirrors the live count of worktrees waiting on you (input
  needed, finished, failed checks).
- **Clickable terminal links** — URLs, `localhost[:PORT]`, absolute
  file paths (with optional `:line:col`), and email addresses are
  now highlighted and clickable in any xterm pane. Lines that wrap
  across rows are stitched back together so long links still match
  as a single unit.
- **`$ALFREDO_ROOT_PATH` and `$ALFREDO_WORKTREE_PATH`** are now
  exposed to setup/run/archive scripts and to interactive PTY
  shells, mirroring Conductor's env. Useful for `cp
  $ALFREDO_ROOT_PATH/.env .env`-style scaffolding.
- Various fixes: malformed `alfredo.json` no longer wedges the
  loading screen; over-escaped script commands healed on personal-
  config load; setup scripts run cleanly without a TTY (login shell
  drops `-i`); whitespace collapsed in pasted and executed script
  commands; **⌘⇧K** rebuilds the terminal's WebGL glyph atlas if it
  corrupts; closed-not-merged PRs stop hitting GitHub for enrichment
  after 24h; column / archive layout preserved across branch ↔
  worktree mode switches; setup scripts and port range now read the
  effective (merged) config when creating a worktree; rendered-view
  toggle in the Changes panel starts at 50% opacity until hovered.

**v0.13.0 — 2026-05-05**
- **Lifecycle rules now live in the sidebar** — hover a Done worktree
  to archive it, hover the Done group header for **Archive all**, or
  open the new gear popover to set auto-archive / auto-delete day
  counts inline. The same day-count fields now also live under
  Settings → General → **Archive & Cleanup**, applied across all
  repos. Confirm dialogs list the branches that will be removed, and
  a first-encounter nudge introduces auto-archive once you have a
  Done worktree.
- **Merged-branch diffs are stable again** — a new diff-range resolver
  anchors the Changes panel using `merge_commit_sha` from PR metadata,
  with merge-base and ancestry-path fallbacks. Pure-behind worktrees
  show an empty range instead of a misleading reverse diff, merge
  commits are filtered out of the commit list, and sidebar diff badges
  refresh for Done worktrees on boot and after a merge.
- **⌘+ / ⌘− / ⌘0 zoom** — these now zoom the whole webview by default,
  but switch to scoping the terminal font when an xterm pane is
  focused. The terminal refit is synchronous so cell geometry no
  longer briefly overflows or wraps mid-word.
- **Changes panel polish** — tab counts render as inline pill chips,
  the pinned-main card grows Files/Commits tabs, view modes split
  cleanly when the pinned main is ahead vs. behind, and the empty
  state distinguishes "no changes" from "load failed". Markdown files
  now default to Diff (the Rendered toggle moves to a hover-revealed
  Eye icon).
- **Sidebar status** — non-merged PRs that get closed on GitHub now
  show a **Cancelled** state, and long branch labels in the status
  bar middle-truncate with the full label in a tooltip.
- Various fixes: terminal copy-on-select rewritten around a deferred
  mouseup read so xterm's selection is finalised before copy, and
  now catches drags that release outside the terminal (past the
  viewport edge, onto the scrollbar, or over a sibling pane); diff
  scroll lag reduced by dropping sticky line-number gutters; dev-
  server port released when a worktree auto-Dones; auto-archive
  correctly disabled when `archiveAfterDays` is 0.

**v0.12.0 — 2026-04-29**
- **Markdown rendered view in the Changes panel** — `.md`,
  `.markdown`, and `.mdx` files now have a Diff/Rendered toggle.
  Rendered mode shows the file as styled prose and lets you tick
  GFM task-list checkboxes directly; flips write back to the
  source file (re-reading first so concurrent edits aren't
  clobbered). Newly-added markdown files default to Rendered.
- **Sidebar diff badge now matches the Changes panel** — the +/-
  counts include uncommitted tracked edits and untracked files,
  so the sidebar no longer understates the scope of an in-flight
  branch.
- **Worktree status bar spans the full width in split layouts** —
  the bottom Effort / Permissions / Output Style bar is no longer
  fragmented across panes, since those settings are worktree-wide.
- Closing the last shell or last agent tab is now allowed — fixes
  a case where the only tab in a split pane couldn't be closed.
- **Select-to-copy in terminal panes** — highlighting text in any
  terminal copies it to the clipboard on mouse release, matching
  iTerm2's "Copy on Select" behaviour.

**v0.11.1 — 2026-04-28**
- **Cancelled PRs auto-move to Done** — closing a PR on GitHub
  without merging now shows a red **Cancelled** banner in the
  Changes panel and the worktree moves to Done on the next sync,
  instead of getting stuck in "in review" with stale check status.

Check the releases page for older versions and full detail.
