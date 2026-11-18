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
  asking (Claude-specific). Set inside Claude with `/permissions`;
  Alfredo only adds an optional skip-permissions launch flag.
- **Ask Alfredo** — the **?** button in the bottom-right; searches
  these feature docs locally.
- **Archive** — hide a finished worktree without deleting it.
  Reversible. Auto-archive runs after N idle days.
- **Repository settings** — per-repo config (scripts, cleanup
  rules, display name). Separate from Global Settings.
- **app.json** — Alfredo's global config file on disk.
- **Orchestration** — a personal rule (a name plus a branch prefix)
  that groups the worktrees whose branch starts with that prefix, or
  the worktrees whose worktree notes have the same `orchestration`.
  A rule is set in Repository settings → General. Only you see it.
- **Worktree note** — a small JSON file a tool writes in the repo's
  git folder to name a worktree and put it in an orchestration, with
  no rule. Alfredo only reads it.
- **Your turn** — the sidebar list at the top showing worktrees in
  your orchestrations that need you: **Answer** (the agent is
  waiting for input) or **Check** (finished, errored, or ready).
