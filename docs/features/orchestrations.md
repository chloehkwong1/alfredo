---
title: Orchestrations and "Your turn" — a list of the worktrees that need you
keywords: [orchestration, orchestrations, your turn, answer, check, waiting for input, question, branch prefix, rule, sidebar, agent question, worktree note, running from, subagent, orchestrator, mark, tag, tooltip, plan, map, no map]
ui_path: Sidebar — "Your turn" at the top; Repository settings → General → Orchestrations
---

An orchestration is a name plus a branch prefix, or just a name that
[worktree note files](external-worktrees.md) share (see **Without a rule**
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
[worktree note files](external-worktrees.md)
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

**The mark and the tag:** in an orchestration, each worktree row shows
a small mark after its name, before the time and the pin. The
orchestrator's row shows the tag `orchestrator` in place of the mark.
Archived worktrees and the kanban cards show neither. Neither takes a
click: a click goes to the row, as a click on the name does.

- A worktree shows one mark. If two orchestrations list it, the first
  one wins, and it is the same one that **Your turn** uses.
- An orchestration with only one row left shows no mark and no tag.
  The exception is an orchestrator that has a plan: it keeps its tag,
  so you can still reach the map before its worktrees exist.
- The main checkout's card shows no tag and no mark, also when a
  session there runs sub-agents in other worktrees. Those other
  worktrees still get the mark.
- With one orchestration on screen, the mark has the accent tint. With
  two or more, each has its own colour, from the same palette as the
  stack chips.
- Colours are given in a fixed order: by repo, then by orchestration
  name. An orchestration keeps its colour while the same orchestrations
  are on screen. A colour can change when an orchestration, or a
  stack, appears or goes.

**Which worktree is the orchestrator:**

1. **Told.** The worktree whose
   [worktree note](external-worktrees.md) says `"role": "orchestrator"`,
   for the orchestration that note names.
2. **Seen.** In an orchestration that Alfredo made from a session's
   work (see **Worktrees a session works in**), the session's own
   worktree.

Notes come before links. An orchestration from a rule, or from notes
with no `role`, has no orchestrator, so no row has the tag. A question
that the orchestrator's own session asks shows in **Your turn** as the
item `orchestrator`, for both ways.

**The tooltip:** point at the mark or the tag and a tooltip opens to
the right. It is read-only; nothing in it takes a click. From top to
bottom:

1. The orchestration's name.
2. The map, when the orchestration has a plan.
3. One grey line about this row. For a worktree that has a plan item:
   the item's name, its parent and what waits for it, for example
   `PR 5 · after PR 1 · PR 6 waits for it`. Names come from the
   note's `name`, or its `key`. For the orchestrator:
   `Orchestrator · 1 of 4 merged`, or `Orchestrator · 3 worktrees`
   with no plan. A worktree with no plan item shows `3 worktrees`.
4. With no plan, a last line in a lighter grey:
   `No map: this orchestration has no plan. See Help › Orchestrations.`

**No map, and how to get one:** the no-map line means Alfredo knows
which worktrees are in the orchestration, but nothing has given it a
plan, so there is no map to draw. The line shows only for an
orchestration that comes from worktree notes or from a rule. It never
shows for an orchestration that Alfredo made from a session's work,
because no tool can write a plan for that.

To get a map, one worktree note whose `orchestration` is this
orchestration's name needs two fields:

- `"role": "orchestrator"`, which makes its worktree the orchestrator;
- `"plan"`, the list of the pieces of work.

That worktree must be a linked worktree, not the repo's main checkout:
Alfredo never reads a note for the main checkout. Whatever writes the
note is yours, for example your own orchestrator or a script. Alfredo
only reads the note; it never writes one. The fields are described
under **Worktree note files** in
[Worktrees created outside Alfredo appear automatically](external-worktrees.md).

**The map:** one square per plan item, with its `key` in it. All
squares are as wide as the longest key needs. An item with no `after`,
or whose `after` names no item, sits at the left. Each child sits to
the right of its parent, joined by a line. Siblings go top to bottom in
plan order. An item that is part of a loop is drawn at the left. The
tooltip widens to fit the map, which can be up to 320 px wide and
240 px high. A larger plan is scaled down to fit. The orchestrator has
no square. The square of the row under the pointer has a ring. A square
looks like this:

- **Merged:** green, filled.
- **Closed:** grey, filled.
- **Todo:** dashed outline.
- **Active, and its worktree needs you:** blue, with a glow.
- **Active, any other case:** amber.

**What a row shows:**

- **Answer** — the agent is waiting for input. The row shows its
  question, then the orchestration name, the item and `waiting` plus
  how long.
- **Check** — the agent finished, errored, or is ready to start. The
  row shows which, then the orchestration name, the item and how long.

The item is the branch after the prefix, or the name from a worktree
note. The orchestrator's worktree is the item `orchestrator`, whether
the orchestration comes from notes or from links. In an orchestration
made from links, a worktree the session works in is the row's name.

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
