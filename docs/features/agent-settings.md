---
title: Agent settings — default agent, skip permissions, launch flags
keywords: [agent, claude, codex, gemini, default agent, skip permissions, dangerously skip permissions, bypass permissions, launch flags, model, effort, permission mode, output style, /model, /config]
ui_path: Sidebar → ⚙ Settings → Agent tab
---

The **Agent** tab of the global Settings dialog sets defaults for new
agent sessions. It deliberately mirrors as little of Claude's own
configuration as possible: model, effort, permission mode and output
style are set inside Claude itself and Alfredo never overrides them,
so new Claude options work without an Alfredo update.

Where Claude keeps each one:

- **Model** — `/model`. Saved to your user settings
  (`~/.claude/settings.json`), so it applies everywhere.
- **Permission mode** — `/permissions` → Default mode. Also saved to
  user settings.
- **Effort** — `/model` (effort picker), or `effortLevel` in user
  settings.
- **Output style** — `/config` → Output style. Claude saves that pick
  to the current project's `.claude/settings.local.json`, which is
  gitignored, so a fresh worktree does **not** inherit it. For a style
  that applies to every worktree, put it in your user settings
  instead: `{ "outputStyle": "Explanatory" }` in
  `~/.claude/settings.json`. Custom styles live in
  `~/.claude/output-styles/` (user) or `.claude/output-styles/`
  (project). The old `/output-style` command was removed in Claude
  Code v2.1.91.

- **Default Agent** — Claude Code, Codex, or Gemini CLI. Used when
  opening a new worktree tab.
- **Skip permission checks** (Claude only) — launches every new
  Claude tab with `--dangerously-skip-permissions`, so Claude never
  asks before edits or commands. This is the one permission setting
  that can't live inside Claude, because it has to be passed at
  launch. Sandboxed or throwaway worktrees only. Off by default.
- **Additional flags** (Claude only) — free-form CLI flags appended
  to every new Claude tab; see
  [Claude launch flags](claude-launch-flags.md).

Skip permissions and Additional flags only appear when the default
agent is Claude Code. Changes apply to new sessions — existing
sessions keep the flags they launched with.

A repo can adjust both Claude settings via `claudeDefaults` in your
personal per-repo Alfredo config (not the committed `alfredo.json`);
Repository Settings → General exposes the flags box.

Alfredo versions before 0.23 had Model, Effort, Permission Mode,
Style and Verbose pickers here, plus per-worktree chips in the status
bar. Those are gone; any value you had set there is dropped and
Claude's own settings take over. If you relied on an Alfredo picker
rather than Claude's own setting, set it once inside Claude using the
commands above. If you had **Bypass Permissions** selected in the
global picker, the new Skip permission checks switch stays on.
