---
title: What's new — recent Alfredo releases
keywords: [whats new, changelog, release notes, updates, new features, latest]
ui_path: N/A — full notes at github.com/chloehkwong1/alfredo/releases
---

Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

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

**v0.20.0 — 2026-08-04**
- **Stacked PRs overhauled end-to-end** — restacks are baseline-tracked
  (`git rebase --onto`), so a child only ever replays its own commits
  and survives amended, force-pushed, or squash-merged parents. Whole
  stacks cascade automatically once parents are clean and idle; **Sync
  stack with main** pulls origin/main into the root first, then ripples
  down. Conflicts pause the stack and can be handed to that worktree's
  Claude session with a ready-made resolution prompt.
- **Stack map** — a pos/total glyph on stacked rows opens a popover
  showing the whole stack (tree-shaped for forked stacks), with
  click-to-jump, whole-stack restack, per-member state, pending
  actions, and a last-action trace. Restacks queued behind a busy
  agent show as pending in the sidebar too.
- **Worktrees created outside Alfredo now auto-appear** — create one
  from the terminal or a script and Alfredo adopts it (ports,
  sessions, the lot) within seconds; externally deleted ones
  disappear.
- **Linear: per-repo prompt template + auto-submit** — customise the
  prompt "Open in Alfredo" builds (with `{{variables}}`) in Repository
  Settings, and optionally auto-send it to Claude instead of leaving
  it in the input.
- **Release highlights on update** — after Alfredo updates, a
  what's-new dialog opens once with the highlights (this list!).
- **Sidebar cards keep their order** — no more reshuffling when agent
  status flips: pinned first, then your drag order, then creation
  order.
- **Light theme redesign** — new Paper light mode, near-white sidebar,
  and contrast raised to WCAG AA across muted text, chips, and
  statuses.
- **Drop a commit** from the Commits tab right-click menu (with a
  clear warning if it's already on origin), and **Open in editor**
  from diff file headers; file paths printed in the terminal open in
  your preferred editor at the exact line.
- **Opus 5** is now a selectable model.
- Various fixes: copied text no longer garbles non-ASCII characters
  when Alfredo launches from the Dock; moving a worktree to Done
  stops its dev server and frees the port; untracked scratch files
  (like `.claude/`) no longer silently block auto-restack; new
  branches no longer inherit the start-point's upstream; leaked
  agent sessions are reaped before file-handle exhaustion; sidebar
  status self-corrects from the Claude registry if a hook is missed.

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

Check the releases page for older versions and full detail.
