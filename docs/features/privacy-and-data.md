---
title: Privacy and where Alfredo stores your data
keywords: [privacy, data, storage, telemetry, analytics, tracking, local, offline, config, app.json]
ui_path: N/A
---

Alfredo is local-first. There is no telemetry, analytics, or crash
reporting — the app does not phone home about what you do.

What Alfredo stores on disk:

- **`app.json`** — global config (repos, agent defaults, notification
  prefs, beta-channel toggle). Lives in the Tauri app data directory
  for your OS (`~/Library/Application Support/com.alfredo.app` on
  macOS).
- **Per-repo config** — repo-scoped settings (setup scripts, cleanup
  rules, display name, GitHub/Linear tokens you configured).
- **Per-worktree session files** — UI state for each worktree (open
  tabs, pane layout, scroll position) under the repo's data dir.
- **Claude conversation logs** — Alfredo reuses Claude Code's own
  `~/.claude/projects/…` files; it doesn't copy them elsewhere.

What leaves your machine, and only when you opt in:

- **GitHub API calls** for PR data, using the token you configured.
- **Linear API calls** for ticket data, using Linear OAuth.
- **Update checks** to GitHub releases.
- **Agent providers** (Claude, Codex, Gemini) make their own
  network calls — Alfredo just spawns the CLI.

To wipe Alfredo completely: delete the app data directory above.
