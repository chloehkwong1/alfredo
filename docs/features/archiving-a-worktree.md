---
title: Archiving (and un-archiving) a worktree
keywords: [archive, archived, unarchive, restore, hide, tidy up, clean up, archive all, archive button]
ui_path: Sidebar → hover a Done worktree → Archive (or right-click → Archive)
---

**Archive** hides a worktree from the main kanban board without
deleting anything on disk. The worktree moves into a collapsed
"Archived" section at the bottom of the sidebar.

Three ways to archive:

- **Hover a Done worktree row** — an **Archive** button reveals on
  the right side of the row.
- **Hover the Done group header** — an **Archive all** button reveals,
  archiving every worktree in the group at once.
- **Right-click** any worktree row and pick **Archive** from the menu.

The first time you have a Done worktree, Alfredo shows a small
**lifecycle nudge** introducing auto-archive — dismiss it once and it
won't reappear.

To restore an archived worktree, expand the Archived section and
either drag it back to the kanban or right-click it to unarchive.

Archive vs. Delete:

- **Archive** — directory + branch stay. Reversible. Safe default
  when a worktree is "done but might be useful later".
- **Delete worktree…** — permanent. Removes the directory and local
  branch. The confirm dialog lists the branch names that will be
  removed (especially handy for **Delete all archived**).

Auto-cleanup: archived worktrees can be auto-archived and auto-deleted
after a configurable number of days. Open the **gear popover** in the
Done group header to set the rules in-flow. See the
[auto-cleanup doc](auto-cleanup.md) for the rules and defaults.
