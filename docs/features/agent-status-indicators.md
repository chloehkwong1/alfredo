---
title: Sidebar agent status — Thinking, Waiting for input, Monitoring, Running agents, Unresponsive
keywords: [status, dot, thinking, waiting for input, monitoring, running agents, unresponsive, idle, busy, sidebar, label, indicator, stale]
ui_path: Sidebar → worktree row → status dot + label
---

Each worktree row shows a coloured dot and a label reflecting what its
agent is doing right now. The states:

- **Idle** — the agent finished its turn and is waiting for your next
  prompt. New results you haven't looked at yet pulse until you open
  the worktree.
- **Thinking… / Reading files… / Writing code…** (rotating) — the
  agent is working. The specific verb is cosmetic; it rotates on a
  timer rather than tracking the actual tool.
- **Waiting for input** — the agent is parked on a question
  (AskUserQuestion), a plan approval, or a permission prompt. Open the
  worktree and answer in the terminal. This label holds even while the
  agent's background subagents keep working — it flips back to busy
  the moment you answer.
- **Running N agents…** — the main agent has dispatched background
  subagents and is waiting on their results.
- **Monitoring…** — the agent registered a Claude Code monitor and
  parked itself until the watched condition fires. Idle and "finished"
  notifications are held back until it wakes, so you aren't pinged for
  a turn that hasn't really ended.
- **Unresponsive** (amber) — the agent has looked busy for a while
  with no output and no lifecycle signals. Usually a hung process or a
  killed terminal; restarting the tab clears it.
- **Not running** — no agent process in this worktree.

Alfredo installs lifecycle hooks per worktree for Claude Code, Codex,
and Gemini CLI, with output-based detection as a fallback when hooks
aren't active. Claude Code's desktop notifications for "finished" and
"needs input" fire on these transitions — see "Notification settings".

For Codex, finishing a turn or interrupting it clears the activity label
after a short settling delay (about 300 ms). Exiting Codex shows **Not
running**. A new prompt starts activity immediately; completing an
individual tool does not end the turn.

Codex requires project hooks to be trusted before they run. In a trusted
project, open **`/hooks`** inside Codex and review Alfredo's hooks when
first installed or changed. If they are disabled or awaiting review,
output detection is only best effort and the activity label can be
inaccurate. Existing sessions need to reload their hooks or restart
after Alfredo installs an updated definition. Callback failures appear
in Codex's hook diagnostics.

See the [Codex hook documentation](https://learn.chatgpt.com/docs/hooks)
for hook review and trust behavior.
