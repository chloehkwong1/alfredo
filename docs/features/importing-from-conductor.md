---
title: Moving to Alfredo from Conductor
keywords: [conductor, import, migrate, migration, existing worktrees, adopt, switch]
ui_path: Sidebar footer → "Add repo"
---

Alfredo replaces Conductor.build for managing agent worktrees.
Migration is a one-step trick: when you **Add repo**, point Alfredo
at the same git repo Conductor was using. Alfredo runs
`git worktree list` under the hood, so every worktree Conductor
already created shows up in the sidebar automatically — you don't
have to re-import anything.

Tips for a smooth move:

- If your worktrees live in a custom folder, set **Worktree base
  path** in Repository Settings so new worktrees land there too.
- Existing worktrees keep their branches and filesystem paths.
  Alfredo just adds its own UI state (kanban status, tab layout)
  on top.
- Pick your default agent under Global Settings → Agents before
  opening the restored worktrees, so new tabs launch with the
  provider you want.
- Conductor-specific metadata (labels, archive state) doesn't carry
  over. Drag worktrees into the right kanban columns once and
  Alfredo will remember from then on.

If a worktree is missing from the sidebar, run `git worktree list`
in a terminal to confirm git still knows about it.
