---
title: Opening a worktree in an external app (editor, terminal, Finder)
keywords: [open in, open folder, editor, terminal, finder, external, vscode, cursor, zed, iterm, warp]
ui_path: Sidebar → right-click worktree → Open in → (app)
---

Any worktree in the sidebar can be opened as a folder in whichever
apps Alfredo has detected on your machine. Right-click the worktree
row and hover over **Open in** — the submenu lists every installed
app Alfredo knows about: VS Code, Cursor, Zed, Vim / Neovim, Terminal
apps (iTerm2, Terminal.app, Warp, Ghostty), and Finder.

Apps only show up in the submenu if they're actually installed on
disk — missing apps aren't listed. If an app you use isn't detected,
add a Custom editor or terminal path on the Settings → General tab
(External Tools section) and it'll appear.

This is the worktree-level action — opens the whole folder. To open
a single file from the Changes panel in your preferred editor, use
the file row's right-click menu or the "Open in editor" icon in the
Changes toolbar instead.
