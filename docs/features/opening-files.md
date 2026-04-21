---
title: Opening a file in your editor
keywords: [editor, open file, vscode, external editor]
ui_path: Changes panel → right-click a file, or toolbar "Open in editor" icon
---

Any file in the Changes panel can be opened in your preferred editor
without leaving Alfredo. There are two entry points. First, right-click
a file in the file sidebar on the left of the Changes panel — the
context menu has an "Open in Editor" item (alongside Copy Path). This
works for every file except ones marked deleted. Second, when a file
is focused in the diff view, the Changes toolbar at the top shows a
small external-link icon labelled "Open in editor"; clicking it opens
the currently focused file.

Both entry points use the editor set in Global Settings → General →
External Tools → "Preferred editor". Options include VS Code, Cursor,
Zed, and others; pick "Custom" to point at an arbitrary .app bundle or
binary. The setting defaults to VS Code. If nothing happens when you
click, check that the selected editor is actually installed — Alfredo
shells out to the editor's CLI and silently no-ops if it's missing.
