---
title: Orchestrations and "Your turn" — a list of the worktrees that need you
keywords: [orchestration, orchestrations, your turn, answer, check, waiting for input, question, branch prefix, rule, sidebar, agent question, worktree note, running from, subagent, orchestrator]
ui_path: Sidebar — "Your turn" at the top; Repository settings → General → Orchestrations
---

An orchestration is a name plus a branch prefix, or just a name that
[worktree notes](external-worktrees.md) share (see **Without a rule**
below). With a prefix, every worktree in the repo whose branch starts
with it belongs to the orchestration. Rules are
personal: they live in your own config, never in `alfredo.json`, so
nobody else sees them and your team's repo is untouched. Alfredo also
makes an orchestration by itself when one session works in other
worktrees (see **Worktrees a session works in** below).

The **Your turn** list sits at the top of the sidebar. It shows the
worktrees in your orchestrations that need you, oldest first. With no
orchestrations, or nothing waiting, it doesn't appear at all.

**Add a rule:** Repository settings → General → **Orchestrations** →
**Add orchestration**. Give it a name and a branch prefix (for example
`pay/`). Under each rule Alfredo shows how many worktrees match right
now. Rows missing a name or a prefix are dropped when you save. The
list updates as soon as you save; no restart.

**Without a rule:** worktrees whose
[worktree notes](external-worktrees.md)
have the same `orchestration` form an orchestration with that name.
They appear in **Your turn** with no rule. The item is the note's
`label`, or the branch when the note has no label. A worktree whose
note names an orchestration and that also matches a rule shows once,
with the note's names. A note with only a `label` renames the sidebar
row; under a rule, **Your turn** still shows the branch after the
prefix. A rule
with the same name as a note orchestration adds its other worktrees to
it, except those a note puts in another orchestration.

**Worktrees a session works in:** when a Claude Code session in one
worktree works in another worktree, Alfredo links the two. This needs
no rule, no note and no setup. A link is made when:

- a subagent of the session runs in the other worktree, for example
  a subagent with worktree isolation;
- the session or one of its subagents edits or writes a file there;
- the session itself moves into the other worktree;
- the session starts another Claude Code session in the other
  worktree's folder (the folder itself, not a subfolder). Alfredo
  sees that session while it is working or waiting, so one that works
  only briefly can be missed.

Reading or searching files there makes no link, so a session that
only reviews another worktree stays separate.

While the work runs, the other worktree's row says **Running from**
and the name of the session's worktree, where it would say "Not
running". A worktree with an agent of its own keeps its own status.
When the work stops the row says "Not running" again. It never turns
to "Done" and it adds nothing to the dock badge: the session's own
row tells you when the session finishes.

A Claude Code session that you start in a terminal outside Alfredo
shows in the same way, as **Running outside Alfredo**, on the row of
the worktree it was started in. It shows while it is working or
waiting, and only if it was started in the worktree's folder itself,
not in a subfolder. These sessions show only while at least one agent
session is running in Alfredo; a hibernated tab does not count.

The session's worktree and the worktrees of the same repo that it
works in form an orchestration. It is named after the session's
worktree: the name you gave the row, or its note's `label`, or its
branch. In **Your turn** the session's worktree is the item
`orchestrator`. A subagent cannot ask you a question, so a question
shows on the session's row, and a click opens the session's worktree.
Rules and notes come first: a worktree they already place keeps that
place.

A link stays until you close the session's tab or quit Alfredo. The
other worktree stays in the orchestration after the work in it stops,
and when either worktree changes branch. A session that is restarted,
or that fails to start, loses its links too. A lost link comes back
the next time the session works in that worktree.

Limits of these links:

- A session that starts a separate Alfredo session in each worktree
  makes no link. Use a rule or a worktree note for it.
- Only Claude Code sessions make links. Codex is not covered.
- Work done only through shell commands is not seen.
- A session that edits a file in another worktree without moving into
  it adds that worktree to the orchestration, but the row keeps "Not
  running".
- Links are kept in memory. After Alfredo restarts, a link comes back
  the next time the session works in that worktree.
- The kanban card still says "Not running".
- Paths are compared as text, so a worktree reached through a symlink
  can be missed.

**What a row shows:**

- **Answer** — the agent is waiting for input. The row shows its
  question, then the orchestration name, the item and `waiting` plus
  how long.
- **Check** — the agent finished, errored, or is ready to start. The
  row shows which, then the orchestration name, the item and how long.

The item is the branch after the prefix, or the name from a worktree
note. In an orchestration made from links, the item is `orchestrator`
for the session's own worktree, and the row's name for a worktree the
session works in.

Click a row to open that worktree. That is all it does. The list
ignores **Pinned only**.

A worktree is in the list under the same test as the
[dock badge](dock-badge.md). An **Answer** row stays until you answer
the question, even while you look at the worktree. A **Check** row for
a finished agent goes when you open the worktree, unless you mark it
unread.

**Limits:**

- A session that started before the update shows "Waiting for input"
  without the question until it is restarted.
- Only questions asked with the question tool, or a plan approval,
  have text. A question written as plain prose, a permission prompt,
  or a wait found by the status backstop shows "Waiting for input".
- A question whose hook data is larger than 64 KB, or that Alfredo
  cannot read, shows "Waiting for input" without the text.
- When the agent asks several questions at once, the row shows the
  first.
- If you cancel a question with Esc, the row shows "Waiting for input"
  until you send the next prompt.
- The question text stays in memory. It is never written to a log or
  a file, so it is gone when you quit.
