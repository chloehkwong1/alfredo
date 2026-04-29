---
title: Splitting the main pane
keywords: [split pane, split view, split right, split down, vertical split, horizontal split, side-by-side, two tabs]
ui_path: Tab bar → right-click a tab → Split Right or Split Down
---

Alfredo can split the main pane so two tabs live side-by-side (or
stacked). Right-click any tab in the tab bar and pick "Split Right" to
push that tab into a new pane on the right, or "Split Down" to stack it
below. The context-menu items are disabled unless the current pane has
at least two tabs — you need a tab to move out, otherwise there would
be nothing left in the original pane. You can also trigger a split
with ⌘\\ (right) or ⌘⇧\\ (down) on the active tab.

Once split, each pane has its own tab bar and active tab, and you can
drag tabs between panes. To merge back, either close every tab in one
pane (the layout collapses automatically when a pane empties) or
right-click a tab in the split pane and choose "Move to Other Pane" to
pull it back across. Closing the last tab in a pane is allowed — the
empty pane collapses and the remaining pane takes the full space.
Splits can nest up to a hard depth cap, so the feature scales from a
simple two-up to a small grid without the layout getting away from you.

The bottom worktree bar (Effort / Permissions / Output Style / Remote /
Open in) renders once per worktree below the split tree, not per pane,
since those settings apply to the whole worktree rather than a single
tab.
