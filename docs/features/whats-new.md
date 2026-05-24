---
title: What's new — recent Alfredo releases
keywords: [whats new, changelog, release notes, updates, new features, latest]
ui_path: N/A — full notes at github.com/chloehkwong1/alfredo/releases
---

Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

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

**v0.15.1 — 2026-05-13**
- **No more "Too many open files" crashes** — heavy users with many
  worktrees and open GitHub PRs were hitting the macOS file-descriptor
  limit because every poll cycle built a fresh HTTP client with its own
  unbounded connection pool. We now share one bounded pool across the
  app, so socket usage stays flat regardless of how many repos or PRs
  you have open.
- **Token changes take effect without restart** — disconnecting GitHub
  or rotating your token used to require quitting Alfredo. The token
  cache now refreshes on every config save.
- **File list in the Changes panel scrolls** when it overflows the
  panel height (regression from v0.15.0).

**v0.15.0 — 2026-05-11**
- **Collapse the sidebar with ⌘B** — press ⌘B, run "Toggle sidebar"
  from the command palette, or click the `«` chevron in the sidebar
  header to hide the worktree list. A slim 32px rail with a `»`
  chevron stays visible on the left edge; click it (or press ⌘B
  again) to bring the sidebar back. State persists across restarts.
- **PRs auto-move to Done on approval** — when a PR you opened or
  one you authored gets approved, Alfredo moves the worktree to
  Done automatically. If reviewers re-request changes the worktree
  moves back to Review on its own, so the kanban stays in sync with
  GitHub state without manual dragging.
- **Done worktrees auto-unpin** — pinned worktrees lose their pin
  when they reach Done, and a new **Unpin all** button on the Done
  column header clears every pin at once.
- **Clickable relative paths in the terminal** — relative paths like
  `src/foo.tsx` or `./bin/script:42` are now linkified in PTY output
  alongside absolute paths, URLs, and `localhost` links. ⌘-click
  opens them in your editor.
- Various fixes: macOS voice mode works again (audio-input
  entitlement was missing from the bundle); live `claude` / `codex`
  / `gemini` pids are recognised as Alfredo sessions instead of
  being treated as recycled OS pids; symlinked
  `.claude/settings.local.json` hooks survive across PTY restarts;
  cross-repo worktrees with the same branch name no longer
  overwrite each other's state; the rebase banner returns on
  non-pinned worktrees; the settings chip refreshes when an
  `alfredo.json` field changes; React errors and unhandled
  rejections are piped to `alfredo.log` for postmortems; sidebar
  busy state is marked stale (rather than forced idle) when the
  hook channel goes silent; sidebar column-expand state only
  persists on drop, not mid-drag.

Check the releases page for older versions and full detail.
