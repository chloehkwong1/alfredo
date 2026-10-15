---
title: What's new — recent Alfredo releases
keywords: [whats new, changelog, release notes, updates, new features, latest]
ui_path: N/A — full notes at github.com/chloehkwong1/alfredo/releases
---

Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

**v0.25.0 — 2026-10-15**
- **Select several worktrees at once** — hover a row for a checkbox,
  or ⌘-click and ⇧-click to build a selection within a column. A
  selection bar offers Move (with Undo), Archive with a counted
  confirmation, Pin, Unpin and Mark read / unread. Dragging a
  selected row carries the whole selection as a deck.
- **Merge from the PR banner** — an approved, green PR shows a merge
  button using your repo's allowed methods, with a confirmation.
  Approved drafts get a one-press "Mark ready & merge"; plain drafts
  get "Mark ready for review".
- **Dev servers warm up** — after Start server, Alfredo waits for the
  port to listen and sends a throwaway request so the app (and a
  suspended Neon database) wake before your first real page load.
- **Lighter in the background** — every poll slows right down while
  the window is unfocused and catches up the moment you come back,
  cutting GitHub API and CPU use when Alfredo isn't in front.
- **Faster with many worktrees** — sidebar rows no longer re-render
  on every update, and terminal output takes a cheaper path into
  the window.
- A reused worktree directory name no longer inherits a dead card's
  column, which could hide a fresh worktree in Done and start its
  auto-archive clock.
- A stranded busy session no longer keeps your Mac awake for the
  app's lifetime, and Alfredo no longer adopts a worktree while git
  is still checking it out.
- Various fixes: rebase-conflict toasts on archived worktrees, the
  merge banner missing when GitHub capitalises the review decision,
  a render loop on the Delete dialog, and a double GitHub poll on
  focus regain.

**v0.24.0 — 2026-09-22**
- **A real composer for PR reviews** — review summaries, diff-gutter
  comments and thread replies all get a toolbar with GIF and emoji
  pickers, plus suggestion blocks that reviewers can apply in one
  click. On your own PRs the composer switches to comment-only,
  since GitHub won't let you approve your own work.
- **Wide PR overview in focus mode** — hit ⌘⇧E on the PR tab and the
  Changes panel opens a reading layout: PR hero up top, changed
  files grouped into Implementation and Tests, and a Reviewed
  checkbox per file that mirrors GitHub's native Viewed state in
  both directions.
- **Terminal appearance settings** — a new Terminal tab in Settings
  with colour scheme (Alfredo's original palette or Ghostty's
  default dark), font family, size, line height, letter spacing and
  cursor style. ⌘+ / ⌘− / ⌘0 adjust font size while a terminal has
  focus.
- **Idle Claude tabs hibernate** — a tab that's been hidden and idle
  past the threshold stops its process and releases its terminal,
  freeing a few hundred MB each. Opening it resumes the same
  conversation. Settings → Agent → Memory; 0 = never.
- **Better Codex support** — Codex lifecycle hooks mean status
  tracking now matches Claude Code, tabs follow the conversation
  name (`/rename`), and merging into `.codex/hooks.json` leaves your
  own handlers alone.
- **The dock badge now counts agent attention only.** Stack trouble
  — a rebase conflict, a branch behind its parent, a pending push —
  no longer adds to the number; the stack chip's amber "!" and the
  stack map are its surfaces. Routine drift was otherwise pinning a
  permanent badge.
- **One stack position everywhere** — native and local stack chips no
  longer disagree about a branch's position in its chain.
- Review requests land in **Needs Review** even while the PR is still
  a draft, and re-requesting a review un-archives its worktree
  instead of leaving the request invisible.
- Fixed a sidebar crash when dragging worktrees between columns.
- "Open in editor" and "Open in terminal" no longer leave zombie
  processes behind.

**v0.23.0 — 2026-09-03**
- **Review PRs from inside Alfredo** — submit a review (approve/
  request changes/comment), draft comments straight from the diff,
  reply to threads, and resolve them — without leaving the app.
- **Focus mode for the Changes panel** (⌘⇧E) — widen the diff and
  hide the sidebar while you review.
- **Agent settings simplified** — Model, Effort, Permission mode and
  Output style are gone from Alfredo's Agent tab; set them once
  inside Claude (`/model`, `/permissions`, `/config`) and every
  worktree picks them up. Skip permission checks and Additional
  flags still live in Alfredo, since Claude has no equivalent.
- PR description links (e.g. "Open on GitHub") now open correctly.

**v0.22.1 — 2026-09-02**
- **Updating from a disk image no longer fails** — if Alfredo is
  running from the mounted .dmg or a quarantined copy, "Update &
  restart" now stops before downloading and tells you to eject it and
  open Alfredo from Applications, instead of failing with "Read-only
  file system".
- "Check for updates" no longer says "You're up to date" after a
  failed install — it reports the version that's actually available,
  and shows downloading / ready states while one is in flight.
- A dismissed update banner stays dismissed on background checks.

**v0.22.0 — 2026-09-02**
- **Simpler agent status bar** — the per-worktree effort, permissions
  and output-style chips are gone from the bottom bar; set these in
  the terminal directly and Claude remembers them. The bar keeps
  Remote and Open In.
- PR descriptions render real markdown — tables, code blocks and
  formatting now display properly.
- "Open in Alfredo" prompts from Linear no longer arrive clipped —
  multi-line prompts paste atomically.
- Manual restack failures now say what actually went wrong instead of
  a generic "Restack failed" toast.
