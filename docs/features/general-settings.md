---
title: General settings — theme, editor, terminal, updates, diff view, archive cleanup
keywords: [general settings, theme, dark mode, light mode, warm dark, catppuccin, mocha, latte, everforest, gruvbox, github dark, synthwave, tokyo night, solarized, honeycomb, appearance, default editor, default terminal, auto update, default diff view, review requests, auto-pull, native stacks, auto-sync, archive after days, delete after days, auto archive, auto delete]
ui_path: Sidebar → ⚙ Settings → General tab
---

The **General** tab of the global Settings dialog (gear icon at the
bottom of the sidebar, or "Go to settings" from the command palette)
groups settings that apply across every repo:

- **Theme** — a swatch grid of 12 themes: nine dark (Warm Dark,
  Catppuccin Mocha, Gruvbox, GitHub Dark, Synthwave '84, Sunset
  Boulevard, Tokyo Night, Solarized Dark, Honeycomb) and three light
  (Light, Catppuccin Latte, Everforest Light). Applied instantly —
  diffs, syntax highlighting and the window titlebar follow the
  theme, so light themes get proper light-surface rendering
  everywhere, including already-open diff editors.
- **Editor** — which external editor to open worktrees in. Options are
  VS Code, Cursor, Zed, Vim / Neovim, or **Custom…** for an
  absolute path to a binary.
- **Terminal** — external terminal app. iTerm2, Terminal.app, Warp,
  Ghostty, or Custom for a `.app` path.
- **Check for updates** — manual update check button; shows
  "You're up to date" when current.
- **Receive beta updates** — toggle that opts into the pre-release
  channel (see beta-releases doc for the full flow).
- **Auto-pull review requests** — when someone requests your review
  on GitHub, Alfredo creates a worktree for the PR automatically
  (default on). See [review-requests](review-requests.md).
- **Keep native GitHub stacks in sync locally** — follows GitHub's
  server-side restacks in your local checkouts when it's provably
  safe, and rebases stacked branches onto moved parents. Never
  pushes — updating the PR stays a click (default on). See
  [rebasing-and-stacks](rebasing-and-stacks.md).
- **Default diff view** — Unified or Split. Used when a worktree has
  no explicit view mode set.
- **Archive & Cleanup** — two day-count fields that apply across all
  repos:
  - **Auto-archive merged worktrees after N days** (default 2).
    Moves Done worktrees into the Archived section once they have
    been idle that long. Set to 0 to disable.
  - **Auto-delete archived worktrees after N days** (default 0,
    disabled). Permanently removes the worktree directory and local
    branch once it has been archived that long. Turn on deliberately
    — delete is not reversible.
  The same fields are also reachable from the **gear popover** on the
  sidebar's Done group header. See [auto-cleanup](auto-cleanup.md)
  for the full behaviour.

Changes apply when you press **Save** at the bottom of the dialog.
