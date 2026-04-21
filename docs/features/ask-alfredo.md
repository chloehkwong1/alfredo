---
title: Ask Alfredo — the in-app help assistant
keywords: [help, ask, assistant, how do i, question, ask alfredo, chat, support]
ui_path: Floating ? button in the bottom-right corner of the window
---

The floating **?** button in the bottom-right corner opens **Ask
Alfredo**, a chat popover for "how do I…" questions about Alfredo
itself.

Ask anything task-oriented ("how do I rename a worktree?", "where's
the notification sound setting?") and Alfredo answers from its
bundled feature docs in one shot. Answers include a UI breadcrumb
pointing you at the exact menu path.

Notes:

- **One shot, no memory** — each question is independent; closing
  the popover clears the chat history.
- **If it says "I don't know"** — tap the **Tell Chloe** button.
  That opens a pre-filled GitHub issue with the `ask-alfredo-miss`
  label so the gap can be filled.
- **No LLM configured** — Alfredo uses your local `claude` CLI when
  present. If the CLI isn't installed, the popover returns an error
  asking you to install Claude Code (an Anthropic API-key fallback
  is wired in the backend but no settings UI exists yet).

Ask Alfredo is only for questions about Alfredo. For coding help,
use the agent tab in your worktree (Claude / Codex / Gemini).
