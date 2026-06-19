---
title: Pane tab bar — sessions and diffs rows
keywords: [pane tab bar, two rows, sessions row, diffs row, notes tab, pinned notes, reorder tabs, scroll tabs, jump to agent, cmd j, ctrl j, cycle tabs, cmd option left right, split pane tab, close all diffs, close all changes]
ui_path: Pane tab bar (top of each pane)
---

Each pane's tab bar has up to two rows. **Row 1 (sessions)** holds your
working sessions — agents, terminals, and the dev server. **Row 2
(diffs)** holds open diff tabs and appears only when you have at least
one diff open; it slides into view (with a brief highlight) the first
time a diff opens and collapses away again when you close the last one.
Splitting sessions and diffs onto separate rows keeps a busy worktree
scannable without hiding either kind of tab.

Each row scrolls horizontally on its own when it overflows — there is no
group switcher and no overflow menu. The active tab (and any tab you
just opened) scrolls into view automatically.

### Notes is pinned

The **Notes** tab sits pinned at the far left of the sessions row in its
own bordered cell, shown as an icon only. It stays put regardless of
what else is open and is deliberately kept out of tab cycling and the
Cmd/Ctrl+J jump (below) so the two keyboard moves only ever land on
working views.

### Sessions row

Agent, terminal, and server tabs render here in order. Agent tabs carry
a small **status dot** — Thinking, Idle, Waiting for input (pulsing), or
Unresponsive. The **`+`** button opens a menu to start a new agent
(Claude, Codex, or Gemini — whichever providers are available) or a new
terminal. When a dev server is configured, its run control and a
`localhost:PORT` open-in-browser badge sit at the right end of the row.

### Diffs row

Every diff tab you open lives in the second row. It animates open the
first moment a diff appears and collapses once the last diff closes, so
diffs never compete with sessions for horizontal space. A **Close all**
button pinned at the far right of the row closes every open diff at once
— your sessions and Notes are left untouched.

### Reordering, splitting, and closing

Drag any tab left or right to reorder it **within its own row** —
sessions reorder among sessions, diffs among diffs. In a split layout,
drag a tab over the neighbouring pane to move it there. Right-click a tab
for **Split Right**, **Split Down**, **Move to Other Pane** (when split),
and **Close Tab / Close Other Tabs / Close Tabs to the Right** — the
close-others and close-to-right actions are scoped to that tab's own row.
A preview (single-click) tab shows in italics; double-click it to pin.

### Keyboard

- **Cmd/Ctrl+J** — jump between the agent and your last-focused working
  view (a session or a diff, never Notes). Press it again to jump back.
- **Cmd+Option+Left / Cmd+Option+Right** — cycle through the pane's tabs
  (wrapping at the ends). Notes is skipped.
