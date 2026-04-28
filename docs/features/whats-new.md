---
title: What's new — recent Alfredo releases
keywords: [whats new, changelog, release notes, updates, new features, latest]
ui_path: N/A — full notes at github.com/chloehkwong1/alfredo/releases
---

Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

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

**v0.9.0 — 2026-04-22**
- **Ask Alfredo** — instant local search over Alfredo's feature docs,
  anchored to a new `?` button in the sidebar header. Folds in bug
  report, keyboard shortcuts and Claude usage as quick actions.
- **Quick-start tour** — first-launch walkthrough with pulse
  highlights, reopenable any time from the Ask Alfredo popover.
- **Smart agent tabs** — tabs now render a dynamic label from the
  agent's OSC title / foreground process / cwd, and use monochrome
  brand icons for Claude, Codex and Gemini.
- **Custom output styles** — styles in `.claude/output-styles/` are
  picked up automatically; project styles override user styles with
  the same name.
- **"Pinned only" filter** in the sidebar (appears once you have pins).
- **Rolling file logger** in release builds for post-mortem debugging.
- **Linear OAuth stability** — transient errors no longer wipe tokens.
- **Tab cycling** — ⌘⌥← / ⌘⌥→ step through tabs in order.
- **Native titlebar** on macOS now matches the selected theme.
- Various fixes: GitHub sync rate-limit handling, session-status
  flicker, config persistence, updater/Linear camelCase serialization,
  terminal font preload race that could blank the WebGL atlas.

**v0.8.1 — 2026-04-21**
- Notification sounds now play via a native Rust audio pipeline for
  more reliable playback.
- Linear search finds tickets in any state, including Backlog.
- Sidebar delete/archive target the correct repo for non-primary
  repo worktrees.
- Dock no longer bounces until focused — just the banner.
- Various state-reconciler fixes so long-running tools don't trip
  false-idle transitions.

Check the releases page for older versions and full detail.
