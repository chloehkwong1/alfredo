---
title: Notification settings — enable, triggers, sound, test
keywords: [notifications, notify, alerts, sound, notification sound, mute, do not disturb, waiting, idle, banner, test notification]
ui_path: Sidebar → ⚙ Settings → Notifications tab
---

The **Notifications** tab of the global Settings dialog controls when
Alfredo alerts you about background agent activity.

- **Enable Notifications** — master toggle at the top. If your OS
  denied permission, an error message appears with a pointer to your
  system settings.
- **Notify when → Agent waiting for input** — toggle. Alerts when an
  agent pauses on a prompt.
- **Notify when → Agent finished work** — toggle. Alerts when an agent
  goes idle.
- **Sound** — grid of named sounds (coin, alfie, bigben, mail,
  pacman, oof, honk, ahooga, boing, microwave, shutter, seatbelt,
  powerup, blip, levelup, doorbell, fwump, quack). Click any sound
  to select it; the preview play button lets you hear it first.
  Pick "None" to keep notifications silent.
- **Test notification** — button that fires a real banner using your
  current settings so you can check it all works end-to-end.
- **Debug mode** (on the General tab, bottom) — adds diagnostic
  info to notification payloads.

macOS quirks:

- Banners only fire from the installed `/Applications/Alfredo.app`,
  not from `npm run tauri dev`.
- Focus / Do Not Disturb suppresses the banner but **not** the
  sound — sound playback runs in-process. Toggle Alfredo's
  notifications off in this tab to silence everything.

**Dock badge:** on macOS, the Alfredo dock icon shows the live count
of worktrees that need your attention (waiting for input, finished,
failed checks). The number updates as you work and clears when no
worktrees are flagged. The dock badge is independent of the banner
toggles — it tracks status, not events. See
[Dock badge](dock-badge.md).
