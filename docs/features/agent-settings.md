---
title: Agent settings — default agent, skip permissions, launch flags
keywords: [agent, claude, codex, gemini, default agent, skip permissions, dangerously skip permissions, bypass permissions, launch flags, model, effort, permission mode, output style, /model]
ui_path: Sidebar → ⚙ Settings → Agent tab
---

The **Agent** tab of the global Settings dialog sets defaults for new
agent sessions. It deliberately mirrors as little of Claude's own
configuration as possible: model, effort, permission mode and output
style are set inside Claude itself (`/model`, `/permissions`,
`/output-style`, or the `--effort` flag) and Claude remembers them
for new sessions automatically. Alfredo never overrides them, so new
Claude options work without an Alfredo update.

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

A repo can adjust both Claude settings via `claudeDefaults` in its
per-repo Alfredo config; Repository Settings exposes the flags box.

Alfredo versions before 0.23 had Model, Effort, Permission Mode,
Style and Verbose pickers here, plus per-worktree chips in the status
bar. Those are gone; any value you had set is dropped and Claude's own
persisted config takes over. If you had **Bypass Permissions**
selected, the new Skip permission checks switch stays on.
