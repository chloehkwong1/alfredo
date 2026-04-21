---
title: Glossary — Alfredo terms in plain English
keywords: [glossary, terms, definitions, vocabulary, jargon, what is]
ui_path: N/A
---

- **Worktree** — one git branch checked out into its own folder,
  with its own agent tab and status. Alfredo's core unit of work.
- **Stack** — a recorded parent-child link between worktrees.
  Rebasing a stacked worktree targets its parent, not main.
- **Kanban column** — the status lane a worktree sits in: **To do**,
  **In progress**, **Blocked**, **Draft PR**, **Open PR**,
  **Needs review**, **Done**. Change status by dragging.
- **Agent / provider** — the AI CLI running in a worktree tab:
  Claude Code, Codex, or Gemini CLI.
- **Permission mode** — how aggressively the agent can edit without
  asking (Claude-specific): Default, Accept Edits, Plan, Auto,
  Don't Ask, Bypass.
- **Ask Alfredo** — the **?** button in the bottom-right; searches
  these feature docs locally.
- **Archive** — hide a finished worktree without deleting it.
  Reversible. Auto-archive runs after N idle days.
- **Repository settings** — per-repo config (scripts, cleanup
  rules, display name). Separate from Global Settings.
- **app.json** — Alfredo's global config file on disk.
