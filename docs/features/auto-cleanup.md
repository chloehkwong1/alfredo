---
title: Automatic archiving and deletion of worktrees
keywords: [automatic, auto archive, auto delete, automatic deletion, cleanup, prune, housekeeping, archive after days, delete after days]
ui_path: Sidebar footer → Repository Settings → Archive & Cleanup
---

Alfredo can clean up finished worktrees for you, but both steps are
opt-in via Repository Settings (click "Repository Settings" in the
sidebar footer, then scroll to the Archive & Cleanup section in the
General tab). Two day-count fields control the behaviour.

"Auto-archive merged worktrees after N days" moves Done worktrees to
the Archive section once they've been idle that long. It uses the PR
merge time when available, otherwise the last-activity timestamp, so
Done worktrees without a PR still get archived. The default is 2 days.
If you manually unarchive something, it won't be re-archived until the
same interval elapses again.

"Auto-delete archived worktrees after N days" is the destructive step
— it permanently removes the worktree (git worktree remove plus the
folder). This one defaults to 0, which means disabled. Set either
field to 0 to turn it off. Archive is safe and reversible; delete is
not, so turn it on deliberately.
