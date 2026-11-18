---
title: Orchestrations and "Your turn" — a list of the worktrees that need you
keywords: [orchestration, orchestrations, your turn, answer, check, waiting for input, question, branch prefix, rule, sidebar, agent question, worktree note]
ui_path: Sidebar — "Your turn" at the top; Repository settings → General → Orchestrations
---

An orchestration is a name plus a branch prefix. Every worktree in the
repo whose branch starts with that prefix belongs to it. Rules are
personal: they live in your own config, never in `alfredo.json`, so
nobody else sees them and your team's repo is untouched.

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
`label`, or the branch when the note has no label. A worktree with a
note that also matches a rule shows once, with the note's names. A rule
with the same name as a note orchestration adds its other worktrees to
it.

**What a row shows:**

- **Answer** — the agent is waiting for input. The row shows its
  question, then the orchestration name, the item (the branch after
  the prefix, or the name from a worktree note) and `waiting` plus
  how long.
- **Check** — the agent finished, errored, or is ready to start. The
  row shows which, then the orchestration name, the item and how long.

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
