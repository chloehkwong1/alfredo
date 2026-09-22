---
title: Agent settings — default agent, skip permissions, launch flags, tab hibernation
keywords: [agent, claude, codex, gemini, default agent, skip permissions, dangerously skip permissions, bypass permissions, launch flags, model, effort, permission mode, output style, /model, /config, hibernate, hibernation, idle tabs, memory, ram, reclaim memory]
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
- **Permission mode** — `/permissions`. Also saved to user settings.
- **Effort** — `/model` (effort picker), or `effortLevel` in user
  settings.
- **Output style** — `/config` → Output style. Claude saves that pick
  to the current project's `.claude/settings.local.json`, which is
  gitignored, so a fresh worktree does **not** inherit it. For a style
  that applies to every worktree, put it in your user settings
  instead: `{ "outputStyle": "Explanatory" }` in
  `~/.claude/settings.json`. Custom styles live in
  `~/.claude/output-styles/` (user) or `.claude/output-styles/`
  (project). The old `/output-style` command is deprecated and just
  points you at `/config`.

What Alfredo itself still controls:

- **Default Agent** — Claude Code, Codex, or Gemini CLI. Used when
  opening a new worktree tab.
- **Skip permission checks** (Claude only) — launches every new
  Claude tab with `--dangerously-skip-permissions`, so Claude never
  asks before edits or commands. This is the one permission setting
  that can't live inside Claude, because it has to be passed at
  launch. Global only — it applies to every repo. Sandboxed or
  throwaway worktrees only. Off by default.
- **Additional flags** (Claude only) — free-form CLI flags appended
  to every new Claude tab; see
  [Claude launch flags](claude-launch-flags.md).

Skip permissions and Additional flags only appear when the default
agent is Claude Code. Changes apply to new sessions — existing
sessions keep the flags they launched with.

A repo can replace the global launch flags with its own via
Repository Settings → General (stored as `claudeDefaults.extraFlags`
in your personal per-repo Alfredo config, not the committed
`alfredo.json`). Skip permissions has no per-repo override.

## Memory — hibernating idle tabs

**Hibernate idle Claude tabs after** (minutes) sits under the
**Memory** heading on the same tab. A Claude tab that has been both
hidden and idle for that long has its process stopped and its
terminal released, freeing a few hundred MB per tab. Opening the tab
again resumes the same conversation, so hibernation costs you nothing
but the moment it takes to come back.

Both conditions are required — the tab you're looking at is never
hibernated, and neither is a hidden one whose agent is still working,
waiting on an answer, or running a subagent. Defaults to 30 minutes;
set it to **0** to disable hibernation entirely.

**Claude tabs only.** Hibernation needs a resume id to bring the same
conversation back, so Codex and Gemini tabs are never hibernated, and
neither are plain shell tabs, which hold live state. A session being
driven from the phone remote is also left alone.

This matters most with many worktrees open at once: each live Claude
tab is a 200–300 MB process plus a resident terminal instance, held
indefinitely even when you walked away hours ago.

Alfredo versions before 0.23 had Model, Effort, Permission Mode,
Style and Verbose pickers here, plus per-worktree chips in the status
bar. Those are gone; any value you had set there is dropped and
Claude's own settings take over. If you relied on an Alfredo picker
rather than Claude's own setting, set it once inside Claude using the
commands above. If you had **Bypass Permissions** selected in the
global picker, the new Skip permission checks switch stays on.
