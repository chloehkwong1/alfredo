---
title: Rendered view for markdown files in the Changes panel
keywords: [markdown, rendered, mdx, preview, prose, task list, checkbox, checklist, gfm, toggle, render markdown]
ui_path: Changes panel → Files tab → open a `.md`/`.markdown`/`.mdx` file → Diff/Rendered toggle
---

Markdown files in the Changes panel can be viewed two ways: as a
unified or split **diff** like any other file, or as **rendered**
prose with the markdown styled. A small Diff/Rendered toggle sits
in the file card header for `.md`, `.markdown`, and `.mdx` files.

The default depends on the file's status:

- **Added files default to Rendered** — the diff would just be a
  `+` on every line, so rendered prose is more useful.
- **Modified files default to Diff** — you usually want to see what
  changed; flip to Rendered if you want to read the file as a whole.
- **Committed views are read-only** — when you scope the diff to a
  single commit, the rendered view shows the post-commit state and
  task lists are not interactive.

## Interactive task lists (working tree only)

GFM task-list checkboxes (`- [ ]` / `- [x]`) in the working-tree
rendered view are clickable. Toggling one writes the change back to
the source file on disk:

- The backend re-reads the file before writing, so an external edit
  in your editor between renders won't be clobbered.
- Only lines that actually look like a task list are considered —
  the parser handles indented `-`, `*`, `+`, and ordered list
  markers, and rejects anything else (so a stray `[ ]` in regular
  prose stays untouched).
- The UI updates optimistically and reverts if the backend rejects
  the toggle (e.g. the file was deleted or the line no longer
  matches a task pattern).

Use it for in-progress task lists in scratch docs, planning notes,
or `TODO.md` files where you want to tick items off without
switching to your editor.
