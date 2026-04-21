---
title: What's new — recent Alfredo releases
keywords: [whats new, changelog, release notes, updates, new features, latest]
ui_path: N/A — full notes at github.com/chloehkwong1/alfredo/releases
---

Recent highlights. Full notes:
https://github.com/chloehkwong1/alfredo/releases.

**v0.8.1 — 2026-04-21**
- Notification sounds now play via a native Rust audio pipeline for
  more reliable playback.
- Linear search finds tickets in any state, including Backlog.
- Sidebar delete/archive target the correct repo for non-primary
  repo worktrees.
- Dock no longer bounces until focused — just the banner.
- Various state-reconciler fixes so long-running tools don't trip
  false-idle transitions.

**v0.8.0 — 2026-04-19**
- **Port management.** Opt-in auto-assign of per-worktree ports;
  `PORT` and `ALFREDO_PORT` injected into PTY sessions; port badge
  in sidebar.
- **Comment chips** for quick-insert review prompts in diffs.
- **Beta updates toggle** under General → Updates.
- Close others / close to the right in tab context menu.
- Stale-status dot for unresponsive agent tabs.

**v0.7.0 — 2026-04-14**
- Inline worktree label editing (double-click in sidebar).
- Global session reconciler that recovers stuck agent states.
- Terminal re-focuses on click and on attach.

Check the releases page for older versions and full detail.
