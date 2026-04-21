---
title: Marking a worktree as blocked, todo, done, or any other status
keywords: [blocked, mark as blocked, status, kanban, column, move, todo, done, in progress, drag]
ui_path: Sidebar → start dragging a worktree → drop on the target column
---

A worktree's status is just which kanban column it's in. To change it,
start dragging the worktree in the sidebar. The moment the drag begins,
every column becomes visible — **To do**, **In progress**, **Blocked**,
**Draft PR**, **Open PR**, **Needs review**, and **Done**. Drop the
worktree onto the column you want and it takes on that status.

Empty columns hide themselves automatically on the next drag-free
render, except **In progress** which is always shown. There is no
right-click "Mark as blocked" or menu action — the kanban drag is the
one mechanism for all statuses, including Blocked.

Some columns also change on their own: opening a PR moves the worktree
to **Draft PR** or **Open PR**, a "ready for review" PR moves it to
**Needs review**, and merging moves it to **Done**. You can always drag
it back out manually.
