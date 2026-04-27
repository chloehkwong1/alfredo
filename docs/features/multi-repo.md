---
title: Working with multiple repos — switching, colors, sidebar chips
keywords: [multi repo, multiple repos, switch repo, active repo, repo colors, repo chip, selected repos]
ui_path: Sidebar → repo chip strip at the top
---

Alfredo is built around multi-repo workflows. Every repo you've added
shows up as a **chip** at the top of the sidebar. Click a chip to
switch the active repo — the kanban board, tabs, and Changes panel
swap to that repo's state.

What you can do with repos:

- **Switch active** — click any chip. Command palette also has a
  "Switch repo" navigation command for each.
- **Colour a repo** — right-click a chip and pick a colour. The
  colour shows in the chip and as a thin accent on each worktree
  row, which helps scan a busy sidebar. Concrete example: tag
  `florence-app` violet and `florence-auth` teal, and a busy "In
  progress" column instantly reads as "two violet rows on the
  frontend, one teal on auth" without you having to read every
  branch name.
- **Rename** — Settings → Repository → Display Name gives the chip
  a shorter label.
- **Show/hide in sidebar** — you can keep a repo on record but hide
  its worktrees from the active view (useful when a repo is idle).
  Example: you have ten repos but only actively work in three this
  week — hide the other seven and the sidebar's repo strip and
  kanban shrink to just those three. They're not removed; tick them
  back on later. The selected-repos list persists globally.
- **Remove** — Repository Settings → Remove Repo. Removing doesn't
  touch the git repo on disk, only Alfredo's pointer to it.

Each repo has its own kanban columns, collapsed-column state,
default agent, and port range, so two repos with very different
workflows don't step on each other.
