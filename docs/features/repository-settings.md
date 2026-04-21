---
title: Repository settings — per-repo mode, display name, worktree dir, ports, scripts
keywords: [repository, repo, workspace, display name, branch mode, worktree mode, worktree directory, port, ports, setup script, run script, archive, scripts]
ui_path: Sidebar → repo chip right-click → "Repository Settings" (or from the global Settings → Repository tab surfaces depending on context)
---

**Repository Settings** are per-repo — each repo added to Alfredo
carries its own copy. The dialog has two tabs: **Repository** and
**Scripts**.

**Repository tab:**

- **Mode** — Branches (plain git branches) or Worktrees (the kanban +
  git worktree model). Switching rewrites the sidebar layout.
- **Repository Path** — read-only, the on-disk location.
- **Display Name** — short label shown in sidebar repo chips.
  Defaults to the folder name.
- **Worktree Directory** (worktree mode only) — where new worktrees
  are created. Defaults to the repo's parent folder.
- **Auto-assign dev server ports** — toggle. When on, each worktree
  gets a unique port from the configured range (default 3001–3099) so
  multiple dev servers run side-by-side.
- **Default Agent** (per-repo) — overrides the global default just
  for this repo.

**Scripts tab:**

- **Setup Scripts** — run automatically when a worktree is created
  (e.g. `npm install`, `cp .env.example .env`).
- **Run Script** — single optional command that starts your dev
  server; toggled on/off from the worktree tab bar.
- **Archive Script** — custom command run when a worktree is
  archived.
