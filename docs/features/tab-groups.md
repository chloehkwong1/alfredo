---
title: Tab groups — Agents, Terminals, Server, Files
keywords: [tab groups, grouped tabs, group tabs by category, tab switcher, agents group, terminals group, server group, files group, group switcher]
ui_path: Tab bar → group switcher button (left of tabs) · Global Settings → Tabs → Group tabs by category
---

By default Alfredo groups every tab in a pane into one of four
categories — **Agents**, **Terminals**, **Server**, **Files** — and
shows only the active group's tabs in the pane tab bar. A **group
switcher button** sits to the left of the tabs (right of the pinned
Notes tab) and cycles between groups. Notes is intentionally outside
the group system: it stays pinned and visible regardless of which
group is active.

Toggle the whole behaviour off in **Global Settings → Tabs → Group
tabs by category**. Off, every tab in the pane renders in one
scrollable row exactly like older Alfredo versions. The setting is
global and applies to every pane.

### Group switcher

The switcher button shows the current group label and an arrow. Click
it to open a dropdown listing all four groups; each row shows the
group label, the count of tabs in that group, and a small activity
dot if any agent tab in that group is waiting for input, busy, or
stale. The button itself carries an `activeDot` that summarises every
**non-active** group — at a glance, the button tells you whether any
hidden group needs attention. Only agent tabs contribute activity
signal; terminals, server, and files have no status.

### Per-group memory

Each group remembers its last-active tab. Switching from Agents to
Terminals jumps back to whichever terminal was active last time you
were in that group, not the first one. Switching back to Agents lands
on the same agent you left.

### Group-aware "+" button

The "+" button in the tab bar adapts to the active group:

- **Agents** — opens a dropdown to pick which provider to spawn.
- **Terminals** — one click adds a new shell tab.
- **Server** / **Files** — hidden (those groups can't be added to
  manually).

### Empty-group state

When the active group has no tabs, the tab bar shows a per-group
empty state (e.g. "No agents in this group — start one with +") with
the appropriate CTA wired to the same action as the "+" button.

### Keyboard

`Cmd+Option+Left` / `Cmd+Option+Right` cycle tabs **within the active
group** (wrapping at the ends) — they no longer step through hidden
tabs in other groups. With Notes selected the cycle defaults to the
Agents group. Drag-reorder still works inside a group, and dragging
between panes moves the tab to the same group in the destination.
