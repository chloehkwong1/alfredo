---
title: Ask Alfredo — the in-app help search
keywords: [ask alfredo, help, help button, question mark button, in-app help, quick actions, bug report, keyboard shortcuts, claude usage, quick-start tour]
ui_path: Sidebar header → ? button (top-right of the sidebar)
---

The **?** button in the sidebar header opens **Ask Alfredo**, a
popover anchored to the button that combines help search with app-wide
quick actions.

Type a few words ("notification sound", "mark as blocked",
"keyboard shortcuts") and the top matches appear instantly with the
exact UI path underneath. Click a result to read the full doc inline.

Before you type, the popover shows quick-action chips:

- **Take the quick-start tour** — replays the first-launch onboarding
  walkthrough with pulse highlights.
- **Keyboard shortcuts** — opens the shortcuts overlay (also ⌘⇧?).
- **Report bug or request feature** — opens the GitHub "New issue"
  chooser for the Alfredo repo.
- **Claude usage** — opens `claude.ai/settings/usage` in your browser.

Notes:

- **Local, offline, instant.** Search is a keyword-based BM25 match
  over bundled docs — no network, no LLM, no account.
- **Press Esc** to close. Closing clears the search state.
- **Keyword-based.** Results match on titles, keyword tags in the
  doc frontmatter, UI paths, and body text. Misspellings may miss.
- **"Tell Chloe"** — if nothing matches your query, a button opens a
  pre-filled GitHub issue with the `ask-alfredo-miss` label so the
  doc gap can be filled.

For coding help (not help *about* Alfredo), use the agent tab in
your worktree (Claude / Codex / Gemini).
