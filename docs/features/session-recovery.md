---
title: What Alfredo remembers across restarts
keywords: [session, restore, recovery, restart, persist, state, remember, resume, reattach]
ui_path: N/A — happens automatically on launch
---

Close Alfredo and reopen it: every worktree, tab layout, and pane
order is restored. Alfredo saves a JSON session file per worktree
under its app data directory (one file per `repo_path + worktree_id`)
every time you change layout, so there's no "save" step.

What survives a restart:

- The list of worktrees and which kanban column each is in.
- Tab order, which tab is active, and pane splits within a worktree.
- Linear ticket metadata attached to a worktree.

What does **not** survive:

- The running PTY process. Agents are CLIs, so closing Alfredo kills
  them. On relaunch a fresh PTY starts, and for Claude Code tabs
  Alfredo tries to resume the most recent `~/.claude/projects/…`
  session for that worktree path. If it finds one, the agent picks
  up your conversation; if not, you get an empty prompt.
- Scrollback from the previous run — the new PTY starts with a
  clean buffer.

If a tab looks stuck after a restart, try closing and reopening it
so Alfredo re-runs the session discovery.
