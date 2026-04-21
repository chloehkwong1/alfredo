---
title: Todo column for worktrees
keywords: [todo column, to do column, hidden column, park worktree, backlog]
ui_path: Sidebar kanban → drag any worktree to reveal "To do"
---

Alfredo's sidebar does have a "To do" column — it's just hidden until
you need it. The kanban shows only columns that have items, plus "In
progress" which always stays visible. "To do", "Blocked", "Draft PR",
"In review", "Needs review", and "Done" all collapse out of sight when
empty.

To park a worktree as a todo, start dragging any sidebar row. The
moment a drag begins, every column becomes visible, including "To do".
Drop the worktree onto it and the column sticks around while it holds
that item. Move the last worktree out of "To do" and the column will
hide itself again on the next drag-free render.

There is no separate "create a todo" button — the column is just
another kanban lane, so anything you want queued up belongs there as
a worktree. If you need to move several, drag them one at a time; the
column stays revealed for the duration of each drag.
