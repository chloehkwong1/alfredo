---
title: Selecting several worktrees at once (bulk actions)
keywords: [bulk, bulk select, multi-select, select all, select several, checkbox, shift-click, cmd-click, move several, archive several, bulk move, bulk archive, bulk pin, mark read, undo move, selection bar]
ui_path: Sidebar → hover a row → checkbox (or ⌘-click / ⇧-click a row)
---

When a column has piled up, you can act on several worktrees in one
go instead of dragging or right-clicking each row.

### Starting a selection

Any of these begins a selection:

- **Hover a row** and tick the checkbox that appears in its left
  gutter.
- **⌘-click** a row to add or remove just that one.
- **⇧-click** a row to select the whole range from the last selected
  row to this one, in the order the column shows them.
- **Right-click** a row and choose **Select All in <column>**.

A selection lives in one column. Starting a selection in another
column replaces the current one. Once a column is selecting, every
row in it shows its checkbox, so ticking more is a plain click.

### The selection bar

As soon as one row is selected, a bar appears above the column list
with the count ("3 selected"), a **Select all N** / **Deselect all**
toggle, and the actions:

- **Move** — pick a target column. The rows move together and a toast
  confirms "Moved N to <column>" with an **Undo** button that puts
  them back exactly as they were, including any pins the move
  cleared.
- **⋯** — **Archive N worktrees** (asks first: it runs each repo's
  archive script, stops any dev servers those worktrees are running
  and frees their ports, and the worktrees stay on disk for
  restoring from the Archive section), plus **Pin**, **Unpin**,
  **Mark read** and **Mark unread**.
- **✕** or **Escape** clears the selection without doing anything.

If a repo refuses part of a bulk move, the toast says how many rows
moved and how many repos failed; the rows that did move can still be
undone.

### Dragging a selection

Dragging any selected row carries the whole selection. The lifted
card draws as a deck with the count on it, and the rows left behind
show a dashed slot so the batch isn't drawn twice. Drop on a column
to move them all; dropping into **Done** unpins them like a single
drag would.

### Keyboard

With a row's checkbox focused, **Space** or **Enter** toggles it;
**Escape** and **⌘1–9** still do what they do elsewhere in the
sidebar.
