---
title: Worktree notes
keywords: [notes, notepad, note, scratchpad, todo, tasks, checklist, markdown, rich text, jot, memo, notebook]
ui_path: Pane tab bar → leftmost notebook icon tab (always present)
---

Every worktree has its own notepad for jotting down plans, todos, and
scratch thoughts. It lives as a permanent tab pinned to the far left of the
pane tab bar, shown as a notebook icon with no label. There's exactly one
per worktree — it can't be closed or duplicated, and it's always there when
you open a worktree.

The editor is rich text (WYSIWYG): use the toolbar or keyboard shortcuts for
bold, italic, underline, strikethrough, bulleted lists, numbered lists, and
task lists with clickable checkboxes. Just start typing — there's nothing to
create or set up.

Notes save automatically. Edits are written to disk a moment after you stop
typing, and also when you switch tabs, click away from Alfredo, or quit the
app — so you won't lose work on reload or close. When you reopen the notes
tab, your content (and any checkbox states) comes back exactly as you left it.

Behind the scenes, notes are stored as a Markdown file at
`<worktree>/.alfredo/notes.md`, so the content travels with the worktree
directory. Alfredo keeps this file out of your project's git status using the
worktree's local `.git/info/exclude` — it is never committed and never shared
with other clones or teammates. The file is removed when you delete the
worktree.
