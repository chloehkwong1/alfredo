---
title: Reordering tabs
keywords: [drag tab, rearrange, tab order, sort tabs]
ui_path: Tab bar → drag a tab left or right
---

Tabs in the pane tab bar are draggable. Press and hold on any tab and
drag it left or right along the bar to drop it into a new position;
the other tabs slide out of the way and a lifted preview of the
dragged tab follows your cursor. Drags only start after a short
pointer distance, so a quick click still selects the tab instead of
picking it up. Dragging works across both single-pane and split-view
layouts — within a pane it reorders, and if you're in a split you can
drag a tab over the neighbouring pane to move it there instead.

The new order is written straight to the layout store's pane state,
which is saved to the per-worktree session file. That means the order
you leave tabs in sticks across app restarts and repo switches — open
Alfredo tomorrow and your agent tab will still be where you put it.
There is no separate "save" step and no keyboard shortcut for
reordering; drag is the only gesture.
