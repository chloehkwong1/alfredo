---
title: Minimising the side panels
keywords: [collapse, hide sidebar, full width, changes panel, zen]
ui_path: ⌘B (sidebar) · ⌘I or ⌘⇧C (Changes panel) · Changes header → collapse icon
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

The sidebar toggle lives on ⌘B and in the command palette ("Toggle
sidebar"); its collapsed state is persisted to `app.json` across
restarts. There is no in-UI button for it today — keyboard or palette
only.
