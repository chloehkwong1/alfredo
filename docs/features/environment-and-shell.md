---
title: Environment variables and shell in worktree terminals
keywords: [env, environment, shell, path, terminal, pty, claude not found, command not found, colors]
ui_path: N/A
---

Alfredo spawns each agent in its own PTY rooted at the worktree's
folder. GUI apps on macOS don't inherit your login shell's `PATH`,
so Alfredo augments it before spawning — the same augmented `PATH`
that git and `gh` commands see. That's why `claude`, `codex`, and
`gemini` work out of the box even though your shell profile never
ran.

Without this, typing `claude` (or `gh`, `pnpm`, `mise`-managed
tools) in a worktree terminal would fail with `command not found`,
even though it works from your regular Terminal.

Env vars Alfredo sets on every agent PTY:

- **`PATH`** — augmented to include common install locations so CLI
  agents resolve.
- **`TERM=xterm-256color`** and **`COLORTERM=truecolor`** — so
  agents render full colour in xterm.js.
- **`ALFREDO_SESSION_ID`**, **`ALFREDO_WORKTREE_ID`**,
  **`ALFREDO_STATE_URL`** — used by hook callbacks to report agent
  state back to Alfredo.
- **`ALFREDO_ROOT_PATH`** — absolute path of the main repo
  checkout. Useful in setup or run scripts that need to copy or
  symlink files from main (e.g. `cp $ALFREDO_ROOT_PATH/.env .env`).
  Mirrors Conductor's `$CONDUCTOR_ROOT_PATH`.
- **`ALFREDO_WORKTREE_PATH`** — absolute path of the current
  worktree. Same value as `pwd` at script start, but stable if a
  script later `cd`s elsewhere.
- **`PORT`** and **`ALFREDO_PORT`** — only when auto-assign ports
  is enabled. The `PORT` name is configurable per repo.

What Alfredo does **not** do: source your `.zshrc` / `.bashrc`.
If a tool needs an env var you set there — for example
`OPENAI_API_KEY=sk-...` exported from `.zshrc`, or
`NODE_OPTIONS=--max-old-space-size=8192` — the agent PTY won't see
it. Either add it to the repo's setup scripts (`export OPENAI_API_KEY=...`),
move it into your launch-time environment (a `~/.zprofile` that
macOS reads at login), or set it on the run script line directly.
