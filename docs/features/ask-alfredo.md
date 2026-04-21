---
title: Ask Alfredo — the in-app help search
keywords: [ask alfredo, help, help button, question mark button, in-app help]
ui_path: Floating ? button in the bottom-right corner of the window
---

The floating **?** button in the bottom-right corner opens **Ask
Alfredo**, a fast local search over Alfredo's bundled feature docs.

Type a few words ("notification sound", "mark as blocked",
"keyboard shortcuts") and the top matches appear instantly with the
exact UI path underneath. Click a result to read the full doc inline.

Notes:

- **Local, offline, instant.** No network, no LLM, no account.
- **Press Esc** to close. Closing clears the search state.
- **Keyword-based.** Results match on titles, keyword tags in the
  doc frontmatter, UI paths, and body text. Misspellings may miss.
- **"Tell Chloe"** — if nothing matches your query, a button opens a
  pre-filled GitHub issue with the `ask-alfredo-miss` label so the
  doc gap can be filled.

For coding help (not help *about* Alfredo), use the agent tab in
your worktree (Claude / Codex / Gemini).
