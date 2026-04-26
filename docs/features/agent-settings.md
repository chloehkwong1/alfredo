---
title: Agent settings — default agent, model, effort, permissions, output style
keywords: [agent, claude, codex, gemini, model, effort, permission mode, output style, custom output style, verbose, default agent, plan mode, accept edits, bypass permissions]
ui_path: Sidebar → ⚙ Settings → Agent tab
---

The **Agent** tab of the global Settings dialog sets defaults for new
agent sessions. You can override any of these per-worktree via the
status bar at the bottom of each session.

- **Default Agent** — Claude Code, Codex, or Gemini CLI. Used when
  opening a new worktree tab.
- **Model** (Claude only) — picks which Claude model to use, or
  "Default" to let Claude Code decide.
- **Effort** (Claude only) — Low / Medium / High / XHigh / Max.
  Trades thinking time for quality.
- **Permission Mode** — Default, Accept Edits, Plan, Auto, Don't Ask,
  or Bypass Permissions. Controls how often Claude asks before
  acting.

The Model, Effort, and Permission Mode option lists are pulled from
a small `models.json` manifest hosted in the Alfredo repo (cached
locally for 24h), so when Anthropic ships a new effort level or
permission mode it can show up in Alfredo without a new release —
just by reopening the dialog.
- **Style** — output style for Claude Code. Built-in options are
  Default, Explanatory and Learning. Any Markdown file dropped into
  `~/.claude/output-styles/` (user-level) is picked up as a custom
  style; a project-level style with the same name — in the repo's
  `.claude/output-styles/` — overrides the user one. When only
  built-ins are present the picker renders as a segmented control;
  with any custom styles it switches to a dropdown.
- **Verbose output** — toggle; shows more tool activity in the pane.

Model/Effort/Permissions/Style only appear when the default agent is
Claude Code. Changes apply to new sessions — existing sessions keep
their settings.
