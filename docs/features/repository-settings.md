---
title: Repository settings — per-repo mode, display name, badge, worktree dir, ports, scripts
keywords: [repository, repo, workspace, display name, badge, badge label, badge colour, badge color, chip, branch mode, worktree mode, worktree directory, port, ports, setup script, run script, archive, scripts, alfredo.json, layered config, override, reset, tabs, general tab, scripts tab, ports tab]
ui_path: Right-click any sidebar surface (worktree row, branch card, or repo chip) → "Open Repo Settings"
---

**Repository Settings** are per-repo — each repo added to Alfredo
carries its own copy. To open the dialog, right-click anywhere on the
repo's surface in the sidebar — a worktree row, a branch card, or a
repo chip in the multi-repo selector — and choose **Open Repo
Settings**. The dialog opens scoped to whichever repo you clicked.

The dialog is split into three tabs: **General**, **Scripts**, and
**Ports** (Ports only shows in worktree mode).

A chip in the dialog header tracks how this repo's config is shared:

- **Tracking `alfredo.json`** — a committed `alfredo.json` exists.
  Teammates who clone the repo inherit these values. Click to open
  the file in your editor.
- **`alfredo.json` not in git** (warning styling) — the file exists
  locally but isn't tracked. Teammates won't see it. Commit it to
  share. Usually means the silent migration ran but you haven't
  committed yet.
- **Local only · Create `alfredo.json`** — no file. Click to create
  one seeded with your current shared values, then commit.

See [Repo-shared `alfredo.json`](repo-shared-config.md) for the
schema and how the personal layer merges on top.

**General tab:**

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
- **Default Agent** (per-repo) — overrides the global default just
  for this repo.

**Scripts tab:**

- **Setup Scripts** — run automatically once when a worktree is
  created. Typical examples:
  - `npm install` — pull deps for a fresh worktree.
  - `cp $ALFREDO_ROOT_PATH/.env .env` — copy your env file from the
    main checkout so the worktree boots with the same secrets.
  - `bundle install && bin/rails db:setup` — Rails-style scaffold.
- **Run Script** — single optional command that starts your dev
  server; toggled on/off from the worktree tab bar. Examples:
  - `npm run dev`
  - `bin/rails s -p $PORT` (uses the auto-assigned port if enabled)
  - `pnpm dev --port $PORT`
- **Archive Script** — custom command run when a worktree is
  archived. Useful for tear-down side-effects like `docker compose
  down` or `rm -rf node_modules` to reclaim disk.

**Ports tab (worktree mode only):**

- **Auto-assign dev server ports** — toggle. When on, the **Start
  server** button claims the next free port from the configured
  **port range** (set start and end yourself). A typical setup is
  `3000`–`3010` for a Node app or `5173`–`5183` for Vite — give
  yourself ten or so slots so several worktrees can run side by
  side. **Port environment variable** picks the env var name your
  scripts read (defaults to `PORT`). See
  [Auto-assigning dev server ports](auto-assign-ports.md) for the
  full lifecycle.

**Layered config:** Scripts, Run Script, Archive Script, port range,
and port env var read from `alfredo.json` first, then your personal
overrides on top. Fields that override the repo default show an
**Override** tag with a **Reset** button next to them. A **Reset all
overrides** button at the bottom of the dialog wipes every personal
override at once and falls back to the committed defaults.
