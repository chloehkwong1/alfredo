---
title: Switching the default agent provider
keywords: [switch agent, change agent, default agent, agent provider, switch claude to codex, swap provider]
ui_path: Global Settings → Agents → Default Agent
---

Alfredo supports Claude Code, Codex, and Gemini CLI as interchangeable
agent backends. To change which one new worktrees launch by default,
open Global Settings and go to the Agents section. The "Default Agent"
dropdown lists whichever providers Alfredo has detected on your machine
— if one isn't installed, it won't appear in the list.

Pick the agent you want and the choice is saved immediately; any new
worktree tab you open from then on starts with that provider. Existing
tabs keep the agent they were created with. Below the default agent
dropdown are the two Claude-only launch settings — skip permission
checks and additional flags (see [Agent settings](agent-settings.md)).
Model, effort, permission mode and output style are set inside Claude
itself; see [Agent settings](agent-settings.md) for which of those
follow you into every worktree and which are saved per project. To run a
different agent on a single worktree without changing the global
default, use the "+" button in that worktree's tab bar to open a new
Claude, Codex, or Gemini tab alongside the existing ones.
