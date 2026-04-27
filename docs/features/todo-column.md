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

### When you'd use it

Say you've kicked off six worktrees but only want today's two staying
visible. Drag the other four into "To do" and they tuck away into the
hidden lane — still tracked, still resumable, just not cluttering "In
progress" while you focus. Reveal the lane again any time by starting
a drag.

Other typical uses:

- **Parking a paused experiment** you might come back to next week,
  without archiving it.
- **Queueing up tomorrow's work** as empty worktrees so they're ready
  to start without setting them up first thing in the morning.
- **Hiding a long-running worktree** (e.g. one waiting on review)
  that's not blocking you right now.

### How to reveal the column

Start dragging any sidebar row — every column appears, including
"To do". Drop the worktree onto it and the column stays visible
while it holds that item; empty it again and it hides on the next
drag-free render.

There is no "create a todo" button. The column is just another
kanban lane, so anything you want queued up belongs there as a
worktree. To move several, drag them one at a time.
