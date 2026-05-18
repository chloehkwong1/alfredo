---
title: What's new — recent Alfredo releases
keywords: [whats new, changelog, release notes, updates, new features, latest]
ui_path: N/A — full notes at github.com/chloehkwong1/alfredo/releases
---

Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

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

Check the releases page for older versions and full detail.
