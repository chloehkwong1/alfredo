---
title: Marking a worktree as blocked, todo, done, or any other status
keywords: [blocked, mark as blocked, status, kanban, column, move, todo, done, in progress, drag, move to column, context menu]
ui_path: Sidebar → drag a worktree to a column, or right-click → Move to column
---

A worktree's status is just which kanban column it's in. There are two
ways to change it:

- **Drag** the worktree to the column you want. The moment a drag
  begins, every column becomes visible — **To do**, **In progress**,
  **Blocked**, **Draft PR**, **Open PR**, **Needs review**, and
  **Done** — so you can drop into any of them, including ones that
  are currently empty and hidden.
- **Right-click → Move to column** for a keyboard- or trackpad-friendly
  alternative. The submenu lists every column; pick one and the
  worktree jumps there without a drag.

Empty columns hide themselves automatically on the next drag-free
render, except **In progress** which is always shown.

Some columns also change on their own: opening a PR moves the worktree
to **Draft PR** or **Open PR**, a "ready for review" PR moves it to
**Needs review**, and merging moves it to **Done**. You can always
drag it back out (or use Move to column) manually.
