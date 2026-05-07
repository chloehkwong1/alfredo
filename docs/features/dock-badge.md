---
title: Dock badge — needs-attention count on the macOS dock icon
keywords: [dock badge, dock count, dock icon, badge, notifications, attention, waiting, finished, error, ready, unread, mac, macos]
ui_path: macOS dock — Alfredo icon
---

The macOS dock icon shows a live count of worktrees that need your
attention, right alongside the icon. The number updates as worktrees
change state and clears when nothing is flagged.

**What's counted:** non-archived worktrees whose effective status is
one of:

- **Waiting for input** — agent paused on a prompt.
- **Done** — agent finished its turn.
- **Error** — agent crashed or hit a tool error.
- **Ready** — fresh worktree ready for first input.

A worktree you've already opened (its agent in view, focus on the
pane) drops out of the count, unless you've explicitly marked it
unread — unread takes precedence over seen.

**Master toggle:** the dock badge follows the **Enable
Notifications** master toggle on Settings → Notifications. Turn that
off and the badge clears. The banner triggers (waiting / finished)
don't affect the badge — it tracks status, not events.

**Stale-badge safety:** the count is reset to 0 on app start, so a
badge left over from a previous session never outlives the new
state. If something does drift, restarting Alfredo always clears it.

**Linux / Windows:** no-op. Linux has no equivalent dock; Windows
builds are disabled.
