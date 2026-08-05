---
title: Worktrees created outside Alfredo appear automatically
keywords: [external worktree, git worktree add, discovery, adopt, auto-detect, terminal, script, deleted worktree, sync]
ui_path: N/A — automatic; new worktrees appear in the sidebar within seconds
---

You don't have to create worktrees through Alfredo. Run
`git worktree add` from a terminal, a script, or an agent session,
and Alfredo notices within about ten seconds and **adopts** the new
worktree: it appears in the sidebar with an unread badge, gets the
default tabs, and runs the repo's create-time setup scripts (showing
the usual "Setting up…" status while they run) — the same
provisioning a worktree created in-app gets.

Deletion works in reverse. Remove a worktree from disk outside
Alfredo and its card disappears, with a full clean-up rather than a
silent drop: any running agent session is closed, tabs and layout
are cleared, the dev-server port is released, and the stale git
worktree entry is pruned.

## Details

- Only **worktree-mode** repos are watched; branch-mode repos are
  skipped.
- Worktrees that already exist when Alfredo starts are simply
  listed, never re-adopted — setup scripts won't run twice.
- Switching branches inside an existing worktree
  (`git checkout -b`) is not treated as a new worktree; adoption
  only triggers for a genuinely new path on disk.
- The same holds in reverse: a branch change — including a rebase
  that finishes on a detached HEAD — is never read as a deletion.
  Removal needs the directory itself to be gone, so work in a
  worktree is safe no matter what its branch does.
- Creating a worktree through Alfredo's own flow is unaffected —
  discovery pauses while an in-app creation is mid-flight.
