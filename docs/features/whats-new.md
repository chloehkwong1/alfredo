---
title: What's new — recent Alfredo releases
keywords: [whats new, changelog, release notes, updates, new features, latest]
ui_path: N/A — full notes at github.com/chloehkwong1/alfredo/releases
---

Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

**v0.13.0 — 2026-05-05**
- **Lifecycle rules now live in the sidebar** — hover a Done worktree
  to archive it, hover the Done group header for **Archive all**, or
  open the new gear popover to set auto-archive / auto-delete day
  counts inline. Confirm dialogs list the branches that will be
  removed, and a first-encounter nudge introduces auto-archive once
  you have a Done worktree.
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
  mouseup read so xterm's selection is finalised before copy; diff
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

**v0.11.0 — 2026-04-28**
- **Failed-check shortcuts** — each failing PR check now has an
  external-link icon to open the run on GitHub in one click; long
  failure lists scroll inside their own container so the rerun /
  fix / merge-and-fix actions stay reachable below.
- **Pinned-main fixes** — setup and archive scripts are skipped when
  they would run against the repo root (most setups would clobber
  real files), and stale PR badges clear when the pinned card swaps
  branches.
- **Cmd+F polish** — Cmd+F in the changes file sidebar now hands
  focus to the commit-diff search instead of dead-ending; the
  path/filename separator stays visible in the file list.
- Fewer false-busy flickers — the session detector mutes itself when
  hooks have already proved an agent is busy mid-turn.

**v0.10.0 — 2026-04-28**
- **Pinned main-branch card** — worktree-mode repos can pin a synthetic
  main card at the top of the sidebar for quick access without leaving
  worktree mode.
- **Repo badges** — assign a colour and 1–4 character label per repo
  from Repository Settings, with a new off-axis 6-slot palette to keep
  multi-repo sidebars scannable.
- **Default slash commands in new worktrees** — Alfredo seeds 3
  starter `.claude/commands/*.md` files when you create a worktree.
- **Port picker dropdown** — when the auto-assign range is full, pick
  a slot to take over instead of being blocked by an exhaustion
  dialog. Sticky port claims now happen lazily on **Start server**.
- **Smarter sidebar cards** — branch cards show live agent status,
  the running server port, and a **Merged** chip on shipped PRs.
  Right-click any sidebar surface to open repo settings, or convert a
  branch-mode repo to worktree mode in one click.
- **Liquid Glass app icon** on macOS 26+, plus a DEV-badged dock icon
  in debug builds.
- Effort and permission modes pull from the remote model manifest in
  Settings.
- First-run setup surfaces repo identity so multi-repo setups are
  unambiguous from the start.
- Diff toolbar and pane tab bar icons cleaned up; FileSidebar
  redesigned with path-first rows and an in-header **Discard all**.
- Cmd+F is now scoped per pane (sidebar, changes, commit-diff,
  terminal) — no more cross-pane interception.
- Various fixes: multi-Claude-tab worktrees no longer collapse onto
  one session, notifications dedupe per-worktree, nested `claude -p`
  hooks suppressed at the shell layer, xterm back-pressure prevents
  echo stall, pane shortcuts route to the focused pane, "Checks
  running" recoloured to disambiguate from agent-busy, port-range
  field accepts free typing, accurate worktree counts for unselected
  repos, "Send as feedback" routes to the on-screen tab, late PR
  review comments and cubic-style summaries surface.

Check the releases page for older versions and full detail.
