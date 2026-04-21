---
title: Agent settings — default agent, model, effort, permissions, output style
keywords: [agent, claude, codex, gemini, model, effort, permission mode, output style, verbose, default agent, plan mode, accept edits, bypass permissions]
ui_path: Sidebar → ⚙ Settings → Agent tab
---

The **Agent** tab of the global Settings dialog sets defaults for new
agent sessions. You can override any of these per-worktree via the
status bar at the bottom of each session.

- **Default Agent** — Claude Code, Codex, or Gemini CLI. Used when
  opening a new worktree tab.
- **Model** (Claude only) — picks which Claude model to use, or
  "Default" to let Claude Code decide.
- **Effort** (Claude only) — Low / Medium / High / Max. Trades
  thinking time for quality.
- **Permission Mode** — Default, Accept Edits, Plan, Auto, Don't Ask,
  or Bypass. Controls how often Claude asks before acting.
- **Style** — Default / Explanatory / Learning output style.
- **Verbose output** — toggle; shows more tool activity in the pane.

Model/Effort/Permissions/Style only appear when the default agent is
Claude Code. Changes apply to new sessions — existing sessions keep
their settings.
