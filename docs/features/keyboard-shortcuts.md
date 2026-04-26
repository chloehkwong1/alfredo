---
title: Keyboard shortcuts
keywords: [shortcut, shortcuts, hotkey, hotkeys, keybinding, keybindings, keymap, cheatsheet]
ui_path: Press ⌘⇧? anywhere in the app
---

Press ⌘⇧? (Cmd+Shift+/) from anywhere in Alfredo to open the Keyboard Shortcuts overlay,
which lists every binding grouped by area. The essentials: ⌘1–9 jumps to
a worktree by its position in the sidebar, ⌘N creates a new worktree,
⌘⇧R opens the Add Repository dialog, and ⌘⇧P opens the command palette
for fuzzy-searching actions.

For tabs and panes, ⌘T opens a new tab, ⌘W closes the current one,
⌘⌥← / ⌘⌥→ cycle between open tabs, and ⌘\ / ⌘⇧\ split the pane right
or down. **Pane-scoped shortcuts target whichever pane has focus** —
clicking inside a terminal or the Changes panel makes that pane the
target for ⌘T, ⌘W, ⌘K, ⌘\, and the tab-cycling shortcuts, so they
don't leak across split panes. ⌘B toggles the sidebar and ⌘I (or ⌘⇧C)
toggles the Changes panel. Inside a terminal, ⌘K clears the buffer
and ⌘+ / ⌘− / ⌘0 control zoom. **⌘F is also pane-scoped**: in a
terminal it opens the buffer search; in the Changes panel it opens
the diff search bar; outside both it does nothing. In the diff view,
] or n jumps to the next file, [ or p jumps back, and x collapses the
current file. The overlay is the source of truth — if a binding isn't
shown there, it isn't wired up.
