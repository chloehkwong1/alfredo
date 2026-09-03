---
title: What's new — recent Alfredo releases
keywords: [whats new, changelog, release notes, updates, new features, latest]
ui_path: N/A — full notes at github.com/chloehkwong1/alfredo/releases
---

Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

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

**v0.21.0 — 2026-08-28**
- **GitHub-native stacks sync themselves** — when GitHub restacks a
  stack server-side after a merge, Alfredo follows the rewrite into
  your local checkouts (only when provably safe) and drift-rebases
  members locally between merges. Local rewrites never auto-push:
  members get a "needs push" badge with an explicit **Push now**
  action, and Alfredo never pushes a branch whose PR belongs to
  someone else. Toggle in Settings (default on).
- **Review requests pull themselves in** — PRs where your review is
  requested get a worktree automatically, ready to open (default on;
  toggle in Settings).
- **GitHub-stacked PRs get a set-up offer** — a worktree whose PR is
  based on a sibling branch shows a "Stacked on X — set up?" cue that
  explains what set-up will do before doing anything.
- **Deleting a mid-stack worktree reconnects the chain** — children
  re-parent onto the deleted worktree's parent instead of stranding.
- **Four new themes** — Catppuccin Latte, Everforest Light, Gruvbox,
  GitHub Dark — and diffs re-tokenize to match the active theme.
- **Linear tickets bring their comments** — "Open in Alfredo" prompts
  now include ticket comments.
- **Memory usage tamed** — background terminals keep a slimmer
  scrollback, fixing multi-GB growth in long sessions.
- PR state survives restarts: associations persist per worktree, and
  aged-out PRs reconcile on launch with a summary toast.
- Stack chips show their 1/N position and hue-code when multiple
  stacks coexist; native-stack popovers gained restack/conflict
  actions and outcome toasts.
- Various fixes: a 19-finding pre-release review wave (stack-state
  honesty, session identity across branch checkouts, multi-line run
  scripts, updater feedback), the cross-column drag crash, and an
  attention count on collapsed sidebar groups.

**v0.20.1 — 2026-08-05**
- **Fixed: a worktree could vanish, taking uncommitted work with it** —
  a rebase that finished on a detached HEAD changed how Alfredo
  identified the worktree, so it was mistaken for one deleted outside
  the app and removed from disk. A branch change is no longer read as
  a deletion; a worktree is only removed when its directory is
  genuinely gone.
- Various fixes: the sidebar selection no longer points at a worktree
  that has left the list, which left the main pane and Changes panel
  rendering against a stale row.
