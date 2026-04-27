---
title: Auto-assigning dev server ports per worktree
keywords: [port, ports, auto assign, auto-assign, dev server, port range, port picker, takeover, take port, exhaustion, sticky port, PORT env var, claim port, release port]
ui_path: Worktree tab → Start server (when auto-assign is enabled per-repo)
---

When you run more than one worktree at a time, you don't want them
all fighting for `localhost:3000`. Auto-assign solves that: each
worktree gets its own port from a range you set, sticky for the life
of the worktree.

### Turning it on

In **Repository Settings → Repository tab**, enable **Auto-assign dev
server ports** and pick a **port range**. Examples:

- `3000`–`3010` — a Node / Next.js stack with room for ~10 active
  worktrees.
- `5173`–`5183` — Vite default with breathing room.
- `4000`–`4019` — Rails, a wider range if you parallelise heavily.

Set **Port environment variable** if your scripts read something
other than `PORT` (e.g. some Rails configs use `RAILS_PORT`). The
chosen var is exported into the agent PTY along with `ALFREDO_PORT`
as a duplicate.

### When the port is claimed

Claims are **lazy**: creating a worktree doesn't claim a port. The
claim happens when you click **Start server** on the worktree's run
script — that's the moment Alfredo picks the next free slot in the
range and exports it as `$PORT` for that session.

This means you can have ten worktrees set up but only the three
running dev servers actually consume ports. The other seven hold
nothing.

### When the port is released

A port is released automatically when the worktree is dragged to
**Done** in the kanban. It's also released if you stop the server
because someone else takes it via the picker (see below). Otherwise
the claim is sticky — quitting Alfredo and reopening keeps the same
port mapped to the same worktree.

### When the range fills up — the picker

If every port in the range is already claimed when you click Start
server, the **Pick a port** dropdown opens instead of failing. It
shows every port in the range with whichever worktree is holding it:

- **Free slots** — click to claim. (Rare in this flow, since the
  picker only appears when the range is full, but a slot can free
  up between checks.)
- **Held slots** — click to take the port from that worktree. Its
  server stops; yours starts on the same port. The held row shows
  the worktree's branch name and a coloured chip so you don't
  accidentally steal from active work.
- **Your own slots** — marked "Yours", inert. You can't take from
  yourself.

If you'd rather not steal, close the picker and widen the range in
Repository Settings, or drag a finished worktree to **Done** to
free its port.

### Why "lazy" matters

Earlier versions claimed a port the moment a worktree was created.
That meant a 10-port range only allowed 10 worktrees total, even if
nine of them were idle. The lazy model lets you have far more
worktrees than ports — you only consume a slot while you're actually
running a dev server.
