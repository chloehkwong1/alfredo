---
title: General settings — theme, editor, terminal, updates, diff view, archive cleanup
keywords: [general settings, theme, dark mode, light mode, warm dark, appearance, default editor, default terminal, auto update, default diff view, archive after days, delete after days, auto archive, auto delete]
ui_path: Sidebar → ⚙ Settings → General tab
---

The **General** tab of the global Settings dialog (gear icon at the
bottom of the sidebar, or "Go to settings" from the command palette)
groups settings that apply across every repo:

- **Theme** — swatches for dark / light / warm-dark. Applied instantly.
- **Editor** — which external editor to open worktrees in. Options are
  VS Code, Cursor, Zed, Vim / Neovim, or **Custom…** for an
  absolute path to a binary.
- **Terminal** — external terminal app. iTerm2, Terminal.app, Warp,
  Ghostty, or Custom for a `.app` path.
- **Check for updates** — manual update check button; shows
  "You're up to date" when current.
- **Receive beta updates** — toggle that opts into the pre-release
  channel (see beta-releases doc for the full flow).
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
