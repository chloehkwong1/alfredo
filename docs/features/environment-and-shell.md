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

Env vars Alfredo sets on every agent PTY:

- **`PATH`** — augmented to include common install locations so CLI
  agents resolve.
- **`TERM=xterm-256color`** and **`COLORTERM=truecolor`** — so
  agents render full colour in xterm.js.
- **`ALFREDO_SESSION_ID`**, **`ALFREDO_WORKTREE_ID`**,
  **`ALFREDO_STATE_URL`** — used by hook callbacks to report agent
  state back to Alfredo.
- **`PORT`** and **`ALFREDO_PORT`** — only when auto-assign ports
  is enabled. The `PORT` name is configurable per repo.

What Alfredo does **not** do: source your `.zshrc` / `.bashrc`.
If a tool needs an env var you set there, either add it to the
repo's setup scripts or move it into your launch-time environment.
