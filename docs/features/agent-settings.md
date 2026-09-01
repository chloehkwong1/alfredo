---
title: Agent settings — default agent, model, effort, permissions, output style
keywords: [agent, claude, codex, gemini, model, effort, permission mode, output style, custom output style, verbose, default agent, plan mode, accept edits, bypass permissions]
ui_path: Sidebar → ⚙ Settings → Agent tab
---

The **Agent** tab of the global Settings dialog sets defaults for new
agent sessions. A repo can adjust these via `claudeDefaults` in its
per-repo Alfredo config.

- **Default Agent** — Claude Code, Codex, or Gemini CLI. Used when
  opening a new worktree tab.
- **Model** (Claude only) — picks which Claude model to use, or
  "Default" to let Claude Code decide.
- **Effort** (Claude only) — Low / Medium / High / XHigh / Max.
  Trades thinking time for quality.
- **Permission Mode** — Controls how often Claude asks before acting.
  The same hints surface in the picker itself:
  - **Default** — asks before edits and commands. Safest for
    unfamiliar codebases.
  - **Accept Edits** — auto-accepts file edits, still asks before
    commands. Good middle ground for routine refactors.
  - **Plan** — read-only exploration, no edits or commands. Use when
    you want Claude to investigate without touching anything.
  - **Auto** — Claude decides which permissions to grant; may still
    ask for risky tools.
  - **Don't Ask** — runs all tools without asking. Use with caution
    on trusted code.
  - **Bypass Permissions** — no checks at all. Sandboxed
    environments only (e.g. ephemeral worktrees).

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
