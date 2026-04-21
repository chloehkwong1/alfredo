---
title: Archiving (and un-archiving) a worktree
keywords: [archive, archived, unarchive, restore, hide, tidy up, clean up]
ui_path: Sidebar → right-click worktree → Archive
---

**Archive** hides a worktree from the main kanban board without
deleting anything on disk. Right-click the row and pick **Archive**
— the worktree moves into a collapsed "Archived" section at the
bottom of the sidebar.

To get an archived worktree back, expand the Archived section and
either drag it back to the kanban or right-click it to unarchive.

Archive vs. Delete:

- **Archive** — directory + branch stay. Reversible. Safe default
  when a worktree is "done but might be useful later".
- **Delete worktree…** — permanent. Removes the directory and local
  branch.

Auto-cleanup: archived worktrees can be auto-deleted after a
configurable number of days. See the auto-cleanup doc for the rules
and how to change the thresholds.
