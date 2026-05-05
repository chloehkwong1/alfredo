---
title: Terminal appearance — font, size, cursor
keywords: [terminal, font, font size, line height, letter spacing, cursor, block, underline, bar, blink, appearance]
ui_path: Sidebar → ⚙ Settings → Terminal tab
---

The **Terminal** tab of the global Settings dialog customises how the
embedded terminal looks. It's separate from the External Tools
terminal choice on the General tab — that one picks which external
terminal app "Open in Terminal" uses.

Controls on this tab:

- **Font family** — dropdown of 6 monospace options.
- **Font size** — slider, 10–20px.
- **Line height** — slider, 1.0–1.8.
- **Letter spacing** — slider, −1 to 3px.
- **Cursor style** — Block, Underline, or Bar.
- **Cursor blink** — toggle.

Preferences save to local storage and take effect immediately on every
terminal pane, no restart needed.

**⌘+ / ⌘− / ⌘0 zoom** is also wired to terminal font size: click into
a terminal pane to focus it, and those shortcuts adjust the **Font
size** preference instead of zooming the webview. Without an xterm
focused they zoom the whole window — see [keyboard
shortcuts](keyboard-shortcuts.md).
