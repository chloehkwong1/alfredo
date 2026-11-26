---
title: Dev servers Alfredo did not start
keywords: [dev server, detected server, server not started by alfredo, stop server, claude started a server, npm run dev, port, listening, lsof, stray server, orphan server, done stops server]
ui_path: Worktree tab bar → Stop server; sidebar row → port badge
---

Alfredo also finds dev servers that it did not start. If Claude runs
`npm run dev` in a worktree, or you start a server from a terminal
tab, Alfredo shows it as that worktree's running server.

### How a server is found

Every 5 seconds Alfredo lists the processes that listen on a TCP port.
A listener belongs to a worktree when its working folder is inside
that worktree. Ports in the system's ephemeral range (49152 and up on
macOS) are ignored, because they are never dev servers.

The scan uses `lsof`. On a Linux machine without `lsof`, Alfredo
cannot detect servers that it did not start.

### What you see

- The worktree tab bar shows **Stop server**, even when the repo has
  no run script. Hover it to see the port.
- The sidebar row shows the server's port.

### Stopping a detected server

Click **Stop server** in the worktree tab bar. Alfredo stops the
server's process tree inside that worktree only. It never stops:

- Claude or Codex agents, or the processes they run through.
- Alfredo itself, or the shells in its terminal tabs.
- Apps such as editors or terminals that you opened from the worktree.
- Servers in other worktrees.

If the scan fails, Alfredo reports an error. It does not report a
clean stop.

### When you mark a worktree Done

Moving a worktree to **Done** (or archiving it) also stops the
servers Alfredo detected there, and frees the worktree's assigned
port. If a server is still listening after the stop, Alfredo keeps
the port assigned. See [Archiving a worktree](archiving-a-worktree.md)
and [Auto-assigning ports](auto-assign-ports.md).
