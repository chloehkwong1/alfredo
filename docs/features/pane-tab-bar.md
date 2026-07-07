---
title: Pane tab bar — agents, terminals, and diffs rows
keywords: [pane tab bar, three rows, agents row, terminals row, diffs row,
  notes tab, pinned notes, reorder tabs, scroll tabs, jump to agent, cmd j,
  ctrl j, cycle tabs, cmd option left right, split pane tab, close all diffs,
  close all changes, rename tab, custom label, terminal row, collapse row,
  collapsible rows, summary strip, chevron, segments, edge fade]
ui_path: Pane tab bar (top of each pane)
---

Each pane's tab bar has three static rows. **Row 1 (agents)** is always
visible at 44px and holds your agent sessions, Notes, and the `+` menu.
**Row 2 (terminals + dev server)** and **Row 3 (diffs)** are each 30px
and render only when they have at least one tab. Rows never reorder
themselves — each type of tab always lives in its assigned row.

Each row scrolls horizontally on its own when it overflows. The active
tab (and any tab you just opened) scrolls into view automatically. A
right-edge fade on the agents row signals that tabs are clipped.

### Notes is pinned

The **Notes** tab sits pinned at the far left of the agents row in its
own bordered cell, shown as an icon only. It stays put regardless of
what else is open and is deliberately kept out of tab cycling and the
Cmd/Ctrl+J jump (below) so the two keyboard moves only ever land on
working views.

### Agents row

Agent tabs fill the agents row. Each carries a small **status dot** —
Thinking, Idle, Waiting for input (pulsing), or Unresponsive. The **`+`**
button opens a menu to start a new agent (Claude, Codex, or Gemini —
whichever providers are available) or a new terminal.

### Terminals and dev server row

Every terminal and server tab lives in Row 2. When a dev server is
configured, its **localhost:PORT** open-in-browser badge and start/stop
control sit at the right end of this row when it is expanded.

### Diffs row

Every diff tab you open lives in Row 3. A **Close all** button pinned at
the far right of the row closes every open diff at once — your sessions
and Notes are left untouched.

### Collapsing rows

Rows 2 and 3 each have a **chevron** at their left edge. Clicking it
collapses the row into a slim summary strip that shows a chip with an
icon and tab count. The terminals chip also shows a small run-state
indicator when the dev server is running. When both rows are collapsed,
their chips share a single strip row.

Clicking a chip **expands** its row — it does not switch tabs or change
which tab is active. Collapsing a row only hides the tab buttons; the
pane's content is never affected.

A collapsed row **expands automatically** whenever one of its tabs
becomes active by any route: clicking, keyboard cycling, Cmd/Ctrl+J, a
new tab opening, or a diff opened from the Changes panel.

If the collapsed row contains the active tab, its chip carries the
accent underline. Collapse state is remembered per pane and survives
restarts.

### Reordering, splitting, and closing

Drag any tab left or right to reorder it **within its own row** —
agents reorder among agents, terminals among terminals, diffs among
diffs. In a split layout, drag a tab over the neighbouring pane to move
it there. Right-click a tab for **Split Right**, **Split Down**, **Move
to Other Pane** (when split), and **Close Tab / Close Other Tabs / Close
Tabs to the Right** — the close-others and close-to-right actions are
scoped to that tab's own row. A preview (single-click) tab shows in
italics; double-click it to pin.

### Renaming tabs

Right-click any agent, terminal, or diff tab and choose **Rename Tab…**
to give it a custom name. The label turns into an inline input — press
Enter to commit, Esc to cancel. Committing an empty field clears the
custom name and restores the live dynamic label. Custom names outrank
the dynamic label (OSC title, process name, cwd) and survive app
restarts. Notes and the dev-server tab keep their generated names and
cannot be renamed.

### Keyboard

- **Cmd/Ctrl+J** — jump between the agent and your last-focused working
  view (a session or a diff, never Notes). Press it again to jump back.
- **Cmd+Option+Left / Cmd+Option+Right** — cycle through the pane's tabs
  in visual order: agents first, then terminals, then diffs (wrapping at
  the ends). Notes is skipped.
