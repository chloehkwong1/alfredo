---
title: Repository settings — per-repo mode, display name, badge, worktree dir, ports, scripts
keywords: [repository, repo, workspace, display name, badge, badge label, badge colour, badge color, chip, branch mode, worktree mode, worktree directory, port, ports, setup script, run script, archive, scripts]
ui_path: Right-click any sidebar surface (worktree row, branch card, or repo chip) → "Open Repo Settings"
---

**Repository Settings** are per-repo — each repo added to Alfredo
carries its own copy. To open the dialog, right-click anywhere on the
repo's surface in the sidebar — a worktree row, a branch card, or a
repo chip in the multi-repo selector — and choose **Open Repo
Settings**. The dialog opens scoped to whichever repo you clicked.

**Repository tab:**

- **Mode** — Branches (plain git branches) or Worktrees (the kanban +
  git worktree model). Switching rewrites the sidebar layout.
- **Repository Path** — read-only, the on-disk location.
- **Display Name** — full repo name shown in the sidebar repo
  selector and in dialogs. Defaults to the folder name.
- **Badge Label** — 1–4 characters shown inside the small coloured
  chip on every worktree row and branch card. Defaults to the first
  one or two letters of the display name. Edit this if two repos
  collide on initials (e.g. `florence-app` and `florence-auth` both
  default to `FL`).
- **Badge Colour** — pick from a fixed 6-slot palette: violet, teal,
  fuchsia, coral, ochre, slate. New repos auto-claim the first
  unused slot. Legacy colour names from older configs
  (purple/blue/green/amber/pink/cyan) alias to the nearest new hue.
- **Worktree Directory** (worktree mode only) — where new worktrees
  are created. Defaults to the repo's parent folder.
- **Auto-assign dev server ports** — toggle. When on, the first dev
  server to start in a worktree claims the next free port from the
  configured **port range** (per-repo: set start and end yourself).
  A typical setup is `3000`–`3010` for a Node app or `5173`–`5183`
  for a Vite project — give yourself ten or so slots so you can run
  several worktrees side by side. The claim is sticky for the
  worktree's lifetime and is released when the worktree is dragged
  to **Done** in the kanban. If the range is full when a session
  needs a port, Alfredo opens a release-and-retry dialog listing the
  worktrees currently holding ports so you can free one up. **Port
  environment variable** lets you choose the env var name your
  scripts read (defaults to `PORT`).
- **Default Agent** (per-repo) — overrides the global default just
  for this repo.

**Scripts tab:**

- **Setup Scripts** — run automatically once when a worktree is
  created. Typical examples:
  - `npm install` — pull deps for a fresh worktree.
  - `cp ../main/.env .env` — copy your local env file from the main
    checkout so the worktree boots with the same secrets.
  - `bundle install && bin/rails db:setup` — Rails-style scaffold.
- **Run Script** — single optional command that starts your dev
  server; toggled on/off from the worktree tab bar. Examples:
  - `npm run dev`
  - `bin/rails s -p $PORT` (uses the auto-assigned port if enabled)
  - `pnpm dev --port $PORT`
- **Archive Script** — custom command run when a worktree is
  archived. Useful for tear-down side-effects like `docker compose
  down` or `rm -rf node_modules` to reclaim disk.
