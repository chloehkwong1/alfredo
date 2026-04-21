# docs/features

One markdown file per user-facing Alfredo feature. Bundled into the
app binary and consumed by the "Ask Alfredo" help assistant.

## Format

```
---
title: Short description, as a teammate would describe it
keywords: [synonym1, synonym2]
ui_path: Sidebar → right-click worktree → Rename
---

One or two short paragraphs, task-oriented, 100-200 words.
No code unless essential.
```

## Rules

- **One feature per file.** Short beats comprehensive.
- **`ui_path` is text only** — surfaced below the answer as a breadcrumb.
- **Keep keywords to 2-4 synonyms** that a confused teammate might use.
- **Missing feature?** The assistant will say so — file a GitHub issue
  with the `ask-alfredo-miss` label to track the gap.
