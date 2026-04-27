---
title: The terminal loading overlay (Starting Claude/Codex/Gemini…)
keywords: [loading, overlay, starting, slow start, sessionstart, hooks, claude-mem, queued input, typed preview, boot, blank terminal, hung]
ui_path: Worktree tab → automatic on agent start
---

When you start (or resume) an agent in a worktree tab, Alfredo shows
a centred **Starting Claude Code…** (or Codex / Gemini CLI) overlay
while the PTY warms up. It's there to make slow boots feel
intentional instead of broken.

### What you'll see

- A pulsing logo and **"Starting [agent]…"** with a seconds counter.
- After **3 seconds**, an extra hint:

  > Waiting for [agent] SessionStart hooks to finish. Long startup
  > hooks (e.g. claude-mem corpus priming) block the UI until they
  > return.

  This is a heads-up that the delay is your hook scripts, not
  Alfredo. Common culprits: `claude-mem` indexing, custom
  SessionStart hooks that pull a lot of context, or slow setup
  scripts.

- If you've started typing before the agent is ready, your input is
  shown as **Queued input** in a small mono-font box. Your
  keystrokes aren't lost — they're buffered in the kernel PTY and
  the overlay just mirrors them back so it doesn't feel like you're
  typing into a black hole.

### When it disappears

The moment the agent prints its first byte the overlay fades out
and your queued input is sent through. If you're stuck on the
overlay for >10 seconds, it's almost always a SessionStart hook
that's running long — not a hang. Open Activity Monitor and look
for hook scripts under the Alfredo process tree.

### Skipping or speeding it up

You can't skip the overlay (it tracks real PTY state, not a fixed
delay). But you can shorten it:

- **Trim SessionStart hooks** — most projects don't need
  full-corpus priming on every start.
- **Move heavy work into setup scripts** — they run once on
  worktree creation, not every time you open the tab.
- **Disable per-session telemetry hooks** if you're not using them.

### Related

- [Environment and shell in worktree terminals](environment-and-shell.md)
  — what env vars the PTY sees during boot.
- [Repository Settings → Scripts](repository-settings.md) — where
  setup scripts live (faster than SessionStart hooks for repo
  initialisation).
