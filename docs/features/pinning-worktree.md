---
title: Pinning a worktree
keywords: [pin, unpin, sticky, prioritize]
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
