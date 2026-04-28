---
title: Pin a main-branch card — persistent main lane in the sidebar
keywords: [main branch, main card, pin main, pinned main, general prompts, scratch, main lane, worktree main, show main]
ui_path: Sidebar → bottom of branch list → "+ Pin a main-branch card [N]"
---

Worktree-mode repos can opt in to a synthetic **main-branch card** that
sits in the sidebar alongside the per-worktree rows. It's a persistent
lane for general-purpose prompts that don't belong in a ticket-specific
worktree — a place to ask quick questions or run scratch sessions
against the repo's main branch.

A dashed **`+ Pin a main-branch card [N]`** button appears at the bottom
of the branch list whenever there are eligible repos. The `[N]` count is
the number of worktree-mode, currently-selected repos that aren't pinned
yet. The button hides itself when `N` is zero.

Click the button to open a small popover listing eligible repos with
their badge and worktree count. Clicking a row pins that repo's main
card, the popover closes, and the card slots into the sidebar. Hover
the pinned card and a small **×** appears top-right — click it to
unpin.

The pinned card renders with the branch name as the heading and the
repo tag on the right (the inverse of a normal worktree card). It
behaves like any other branch-mode card: live agent status, the rebase
banner ("N commits behind origin/main"), the right-click menu, and the
Changes panel all work the same way.

The pinned-state list is persisted in your global app config under
`showMainCardRepos`, so it survives restarts. **Branch-mode repos
always show a main card** — they don't appear in the popover because
they're already covered.

### Gotcha — setup and archive scripts skip the pinned card

The pinned-main card uses the repo root as its working directory
rather than a real worktree path. Setup and archive scripts are
**skipped** when they would run at the repo root, because most
setups (`ln -sf $repo/.env .env`, `cp -R …`) would either no-op or
clobber the real files in the repo. If you specifically want the
script to run there, invoke it manually from a terminal.
