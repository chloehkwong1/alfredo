---
title: What's new — recent Alfredo releases
keywords: [whats new, changelog, release notes, updates, new features, latest]
ui_path: N/A — full notes at github.com/chloehkwong1/alfredo/releases
---

Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

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

Check the releases page for older versions and full detail.
