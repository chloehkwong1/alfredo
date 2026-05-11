---
title: Minimising the side panels
keywords: [collapse, minimise, minimize, hide sidebar, hide changes panel, hide panels, full width, zen mode]
ui_path: ⌘B (sidebar) · sidebar header → « chevron · ⌘I or ⌘⇧C (Changes panel) · Changes header → collapse icon
---

Alfredo has two side panels flanking the main view: the worktree
sidebar on the left and the Changes panel on the right. Hiding one or
both gives the terminal, agent, or diff view the full window width,
which is handy on smaller screens or when you want to focus on a long
agent transcript.

The Changes panel is the more complete toggle. Press ⌘I or ⌘⇧C from
anywhere in the app, or click the collapse icon in the "Changes"
header, and the panel shrinks to a slim vertical rail showing the file
count and PR indicators — click the rail to expand it again. The state
is per-worktree, so you can keep Changes open on one worktree and
hidden on another.

The sidebar can be hidden three ways: press ⌘B, run "Toggle sidebar"
from the command palette, or click the `«` chevron at the right end of
the sidebar header row. Once hidden, the leftmost edge of the screen
becomes a thin invisible hit area — hover the left edge and a `»`
chevron fades in; click it (or press ⌘B again) to bring the sidebar
back. Collapsed state is persisted to `app.json` so it survives
restarts.
