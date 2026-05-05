---
title: Automatic archiving and deletion of worktrees
keywords: [automatic, auto archive, auto delete, automatic deletion, cleanup, prune, housekeeping, archive after days, delete after days, lifecycle rules, gear popover]
ui_path: Sidebar → Done group header → ⚙ gear → Lifecycle rules popover
---

Alfredo can clean up finished worktrees for you, and the rules now
live in-flow next to the worktrees they affect: hover the **Done**
group header in the sidebar and click the small **⚙ gear** to open
the lifecycle rules popover. Both steps are opt-in and the rules
apply to **all repositories**, not just the active one.

Two day-count fields control the behaviour.

"Auto-archive merged worktrees after N days" moves Done worktrees to
the Archive section once they've been idle that long. It uses the PR
merge time when available, otherwise the last-activity timestamp, so
Done worktrees without a PR still get archived. The default is 2 days.
Setting it to **0 turns auto-archive off**. If you manually unarchive
something, it won't be re-archived until the same interval elapses
again.

"Auto-delete archived worktrees after N days" is the destructive step
— it permanently removes the worktree (git worktree remove plus the
folder). This one defaults to 0, which means disabled. Archive is safe
and reversible; delete is not, so turn it on deliberately. When
auto-delete is on, the Done group header also shows a small
**auto-delete chip** so the rule isn't hidden behind a popover.
