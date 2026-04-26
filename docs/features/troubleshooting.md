---
title: Troubleshooting — common fixes when Alfredo misbehaves
keywords: [troubleshooting, broken, not working, stuck, help, fix, error, bug, reset]
ui_path: N/A — read this doc, then act
---

A short list of the things that go wrong most often.

- **UI looks stale after restart.** Clear Alfredo's WebKit cache:
  `rm -rf ~/Library/Caches/com.alfredo.app/WebKit` and relaunch.
- **Notifications make a sound but no banner appears (macOS).** The
  OS only delivers banners from the installed, code-signed app at
  `/Applications/Alfredo.app`. Running from `npm run tauri dev` plays
  sounds but never shows banners. Install the release build to test.
- **⌘B doesn't collapse the sidebar.** Known half-wired shortcut —
  the flag persists but the sidebar still renders. Tracked; no fix yet.
- **Agent tab won't start.** Check the agent CLI is installed and on
  your `PATH` (Claude Code, Codex, or Gemini CLI). Providers that
  aren't detected don't appear in the default-agent dropdown.
- **Worktree operation failed.** Most git errors (dirty tree, rebase
  conflicts, missing base branch) are resolved in the worktree's
  terminal tab with normal git commands.
- **"No free dev-server ports" dialog.** Auto-assign is on and every
  port in the configured range is already claimed. The dialog lists
  the worktrees currently holding a port — pick one to release and
  retry, or close the dialog and widen the range in Repository
  Settings → Auto-assign dev server ports. Ports auto-release when a
  worktree is dragged to Done.
- **Still stuck?** Open an issue at
  https://github.com/chloehkwong1/alfredo/issues.
