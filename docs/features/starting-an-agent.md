---
title: Starting an agent on a new worktree
keywords: [start agent, launch agent, run claude, run codex, run gemini, agent session, auto start]
ui_path: Sidebar footer → "New worktree" (or ⌘N)
---

To spin up a fresh agent session, click "New worktree" at the bottom of
the sidebar or press ⌘N. The Create Worktree dialog opens with four tabs:
New Branch (pick a base and name a new branch), Branches (check out an
existing branch into a new worktree), PRs (create a worktree from an
open pull request), and Linear Issues (if you have the Linear
integration configured).

Pick a source, confirm the repo and base branch, and Alfredo creates the
git worktree, runs any setup scripts configured for the repo, and opens
a tab for it in the main pane. By default the tab launches your chosen
agent — Claude Code, Codex, or Gemini CLI — with whatever permission
mode, model, and output style you've set as defaults. You can override
those settings for a single worktree from the status bar at the bottom
of its tab, or open a different agent alongside the current one via the
"+" button in the tab bar.
