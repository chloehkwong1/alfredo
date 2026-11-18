---
title: Orchestrations and "Your turn" — a list of the worktrees that need you
keywords: [orchestration, orchestrations, your turn, answer, check, waiting for input, question, branch prefix, rule, sidebar, agent question]
ui_path: Sidebar — "Your turn" at the top; Repository settings → General → Orchestrations
---

An orchestration is a name plus a branch prefix. Every worktree in the
repo whose branch starts with that prefix belongs to it. Rules are
personal: they live in your own config, never in `alfredo.json`, so
nobody else sees them and your team's repo is untouched.

The **Your turn** list sits at the top of the sidebar. It shows the
worktrees in your orchestrations that need you, oldest first. With no
rules, or nothing waiting, it doesn't appear at all.

**Add a rule:** Repository settings → General → **Orchestrations** →
**Add orchestration**. Give it a name and a branch prefix (for example
`pay/`). Under each rule Alfredo shows how many worktrees match right
now. Rows missing a name or a prefix are dropped when you save. The
list updates as soon as you save; no restart.

**What a row shows:**

- **Answer** — the agent is waiting for input. The row shows its
  question, then the orchestration name, the item (the branch after
  the prefix) and `waiting` plus how long.
- **Check** — the agent finished, errored, or is ready to start. The
  row shows which, then the orchestration name, the item and how long.

Click a row to open that worktree. That is all it does. The list
ignores **Pinned only**.

A worktree is in the list under the same test as the
[dock badge](dock-badge.md): its effective status needs you and you
haven't already seen it. Opening it clears the row, unless you mark
it unread.

**Limits:**

- A session that started before the update shows "Waiting for input"
  without the question until it is restarted.
- Only questions asked with the question tool, or a plan approval,
  have text. A question written as plain prose, a permission prompt,
  or a wait found by the status backstop shows "Waiting for input".
- When the agent asks several questions at once, the row shows the
  first.
- The question text stays in memory. It is never written to a log or
  a file, so it is gone when you quit.
