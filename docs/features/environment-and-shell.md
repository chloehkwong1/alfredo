---
title: Environment variables and shell in worktree terminals
keywords: [env, environment, shell, path, terminal, pty, claude not found, command not found, colors, zshrc, bashrc, login shell, direnv]
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

Agent tabs also receive every variable your login shell exports.
Alfredo starts your shell once per app run (`$SHELL -li`), captures
its environment, and seeds each new Claude, Codex or Gemini tab with
any variable Alfredo's own process doesn't already have — so an
`OPENAI_API_KEY=sk-...` or `NODE_OPTIONS=--max-old-space-size=8192`
exported from `.zshrc` reaches the agent. If you edit your rc files,
restart Alfredo to pick up the change. A shell that takes more than
five seconds to start, or exits with an error, is skipped and the
agent gets Alfredo's own environment instead. Variables that depend
on the terminal itself, such as `GPG_TTY`, are not seeded.

What Alfredo does **not** do: apply directory-scoped environments
such as direnv's `.envrc`. Those hook your prompt rather than shell
startup, so put repo-specific variables in the repo's setup scripts
(`export FOO=...`) or on the run script line directly.
