---
title: Marking a worktree as unread
keywords: [unread, mark as read, attention, re-surface]
ui_path: Sidebar → right-click worktree → Mark as Unread
---

Marking a worktree as unread re-surfaces it as needing your attention
even after you've already viewed it. Right-click the worktree in the
sidebar and choose "Mark as Unread"; the same menu item toggles to
"Mark as Read" once the flag is set. Visually, an unread worktree picks
up a dashed left border (dashed red if the agent is in an error state,
dashed accent otherwise) to distinguish it from a worktree that's
organically in an attention state, and its label renders in the bolder
"needs attention" weight.

Unread is a manual flag — Alfredo does not set it automatically on
agent activity. It clears automatically the next time you activate the
worktree (selecting it in the sidebar removes the unread mark), or
explicitly via "Mark as Read" in the same context menu. The flag is
persisted through session auto-save, so an unread worktree stays unread
across app restarts until you open it or clear it by hand.
