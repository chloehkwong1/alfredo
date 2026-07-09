---
title: What's new — recent Alfredo releases
keywords: [whats new, changelog, release notes, updates, new features, latest]
ui_path: N/A — full notes at github.com/chloehkwong1/alfredo/releases
---

Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

**v0.19.0 — 2026-07-09**
- **Open Linear issues straight in Alfredo** — "Open in Alfredo" on a
  Linear issue spins up (or focuses) a worktree, drops the issue in as a
  prompt for the agent, and lets you pick the base branch from the repo
  picker. A centered progress overlay tracks the open, and it works even
  when Alfredo was launched cold.
- **Custom Claude launch flags** — set extra `claude` flags globally
  (Settings → Agent) or per-repo, or launch a one-off custom command
  from the new-tab menu. Alfredo keeps its notification wiring intact
  either way.
- **Worktrees open instantly** — create-time setup scripts now run in
  the background. The worktree appears right away with a "Setting up…"
  status and flips to ready when the script finishes, instead of
  blocking on spin-up.
- **Reworked tab bar** — rename any tab from its context menu, tabs sit
  in a stable three-row layout (sessions / terminals / diffs), and
  clicking an agent tab focuses its terminal.
- **Clearer agent status** — the sidebar shows "Monitoring…" while an
  agent runs a background monitor, self-heals stranded monitors, and no
  longer fires duplicate "finished" notifications during background
  subagent runs.
- **Fable 5 and Sonnet 5** are now selectable models.
- PR checks that were **cancelled, timed out, or went stale** now count
  as failing instead of showing "Checks pass", and the PR panel and
  sidebar agree on the count.
- Various fixes: Cmd/Ctrl+C copies the terminal selection instead of
  beeping; sessions survive restart more reliably (atomic resume writes,
  trusted session restore, guarded worktree deletion); stacked-worktree
  diffs no longer bleed in default-branch drift.

**v0.18.0 — 2026-06-19**
- **Two-row pane tab bar** — each pane now splits its tabs across two
  rows: your sessions (agents, terminals, dev server) on top, and a
  diffs row that slides in below only when you have a diff open and
  collapses again when you close the last one. Each row scrolls on its
  own, so a busy worktree stays scannable. A new **Close all** button on
  the far right of the diffs row clears every open diff at once.
- **Jump between the agent and your work with Cmd/Ctrl+J** — toggle
  between the agent and your last-focused session or diff (never Notes),
  then press again to jump back.
- **Origin sync banner** — when a worktree's branch is ahead of or
  behind its upstream, a banner in the Changes panel shows the gap so
  you know when to push or pull.
- **Notifications quick-toggle** — turn Alfredo's notifications on or off
  straight from the sidebar footer, without opening Settings.
- **Opus 4.8** is now selectable as a model, and the Sonnet 4.6 context
  label is corrected.
- Clearer sidebar status — it shows "Running N agents" while background
  subagents are working, and "Waiting for input" when an agent parks on
  a question.
- Various fixes: the kanban section auto-expands when a worktree arrives
  or changes column; collapsed-rail PR badges match Alfredo's design;
  long commit messages collapse by default in the Changes panel.

**v0.17.1 — 2026-05-24**
- **Changes panel no longer fails to load** — deleting an empty file
  (e.g. a Rails `.keep`) could make the Changes panel error out with
  "couldn't load changes". Uncommitted diffs are now computed natively
  so they load reliably; this also clears spurious "deleted" rows for
  files whose paths differ only in case.

**v0.17.0 — 2026-05-22**
- **Per-worktree Notes** — every worktree now has a built-in Notes tab:
  a rich-text editor with a formatting toolbar, task-list checkboxes,
  and debounced autosave, pinned leftmost as an icon tab.
- **Fixed garbled terminal text on macOS** — under heavy output the
  WebGL renderer could draw the wrong glyphs (e.g. "code" showing as
  "node"), and the garble survived scrolling. Updated xterm to pick up
  the upstream fix for texture-atlas page-merge corruption — the deeper
  cause behind the wake/DPR rebuild added in v0.16.0.
- **Rename a worktree** from the sidebar right-click menu.
- **Quote deleted lines in comments** — annotating a removed diff line
  now sends the deleted content along to Claude.
- **Stable updates never offer betas** — the stable channel refuses
  prerelease builds even if the feed serves one, and failed update
  installs/downloads now show in the log and banner instead of silently
  reverting.
- Various fixes: main tabs and chats resume on app reload; PR review
  comments anchor to the correct side (no double-render); split-view
  diff search scrolls to the active match; the annotation preview tab
  pins on submit rather than on open; setup-script errors include the
  exit code and output; orphaned worktree ports reconciled on repo load
  and released reliably on done/archive/delete; new "bear" notification
  sound.

**v0.16.0 — 2026-05-18**
- **Change a worktree's base branch** — a new dialog in the sidebar
  context menu lets you re-point a worktree at a different base (e.g.
  switch from `main` to a feature branch you're stacking on). Each
  agent row also surfaces a clickable parent-branch link.
- **Terminal rebuilds its glyph cache on wake** — the WebGL atlas
  used to corrupt after macOS sleep or a display DPR change, leaving
  terminals showing garbled text until restart. It now rebuilds
  automatically on wake and DPR change.
- **Refreshed notification sound lineup** — adds alfie, bigben,
  pacman, ahooga, honk, boing, microwave, shutter, seatbelt,
  powerup, blip, doorbell, fwump, levelup, and quack. Native macOS
  banners now go through `UNUserNotificationCenter`; sound playback
  stays in-process so custom sounds remain reliable regardless of
  bundle signing. macOS Focus / DND suppresses the banner but not
  the sound — toggle Alfredo's notifications off to silence
  everything.
- **Sticky commit header with inline prev/next nav** — in the
  Commits tab, the selected-commit header sticks to the top of the
  diff column with prev/next arrows (and `j` / `k` keyboard nav) so
  you can walk through a branch's commits without losing your place.
- **Smarter "existing PR" handling on worktree create** — clicking
  a PR row that already has a worktree skips the create flow and
  jumps straight to the existing worktree. Errors when importing a
  PR on a reused branch are now explicit instead of cryptic.
- **Atomic config writes** — `app.json`, `personal.json`,
  `alfredo.json`, and keychain JSON now write via temp-file +
  rename, so a crash mid-write can no longer leave a half-written
  file that refuses to load.
- Various fixes: settings dialogs no longer open inside the
  collapsed sidebar rail; split-diff row backgrounds align to the
  widest content; split-diff right-side line lookup is scoped to the
  right pane (was matching left-pane lines); `j` / `k` commit-nav
  direction corrected; rebase errors show the full git output and
  long branch names no longer break the layout; worktree-create
  failures surface as errors instead of being silently swallowed;
  sidebar diff stats persist across worktree refreshes; remote-
  control sessions are keyed by Claude tab so multiple tabs in one
  worktree don't collide; open PRs win over closed/merged ones on
  the same branch; markdown view-mode choice persists per file
  across remounts; annotation bubble no longer caps at 720px;
  Linear and GitHub share a bounded HTTP pool to prevent socket
  exhaustion.

Check the releases page for older versions and full detail.
