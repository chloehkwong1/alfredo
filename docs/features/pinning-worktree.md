---
title: Pinning a worktree
keywords: [pin, unpin, sticky, prioritize, pinned only, filter]
ui_path: Sidebar → right-click worktree → Pin
---

Pinning keeps a worktree anchored to the top of its status group in the
sidebar so it stays in view while you juggle others. Right-click the
worktree row and choose "Pin"; the same item flips to "Unpin" once it's
pinned. A small pin icon appears next to the timestamp on the pinned row
so you can tell at a glance which worktrees are held in place.

Pinning is purely a sort-order hint within each status group — pinned
items sort ahead of unpinned ones in that group, and any unpinned items
in a group that contains pins render dimmed to push your eye toward the
pinned rows. It does not prevent archiving, deletion, or status changes,
and it doesn't move the worktree between groups. Pinned state lives in
the Zustand workspace store, so it resets when the app restarts — pin is
a session-level focus tool, not a persistent favorite.

Concrete example: "In progress" has six worktrees but you only care
about two today. Pin those two and they jump to the top of the group
with a small pin icon next to the timestamp; the other four drop
below them and render at lower opacity. You haven't lost the four —
they're still right there to click into — they're just visually
demoted so the pinned pair stand out.

## Pinned only filter

Once you have at least one pinned worktree, a small **"Pinned only"**
toggle appears as a sticky chip at the top of the sidebar list. Click
it to hide every unpinned worktree across all status groups so only
your pins remain. Click it again to bring the rest back. Like the pin
state itself, the toggle is session-only — it resets to off on
restart.
