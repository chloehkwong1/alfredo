---
title: Select-to-copy in terminal panes
keywords: [terminal, select, copy, clipboard, highlight, mouseup, iterm]
ui_path: Any terminal pane (Claude tab, agent tabs, shell tabs)
---

Highlighting text in any terminal pane copies it to the system
clipboard automatically — same behaviour as iTerm2's "Copy on
Select" setting. The copy fires once when you release the mouse,
not continuously during the drag, so clipboard-history tools
(Raycast, Maccy, Paste) only record the final selection.

Notes:

- Empty selections (e.g. clicking to deselect) leave the existing
  clipboard contents intact.
- Keyboard-driven selections (Shift+Arrow, Cmd+A) don't auto-copy
  — also matches iTerm2. Use Cmd+C from those.
- Trailing whitespace on each selected line is trimmed, and lines
  that wrapped at the terminal's column width are joined back into
  one logical line on copy.
- Applies to all terminal panes uniformly: the Claude tab, agent
  tabs, and shell tabs.
