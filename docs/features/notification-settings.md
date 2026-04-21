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
- **Sound** — grid of named sounds. Click any sound to select it; the
  preview play button lets you hear it first. Pick "None" to keep
  notifications silent.
- **Test notification** — button that fires a real banner using your
  current settings so you can check it all works end-to-end.
- **Debug mode** (on the General tab, bottom) — adds diagnostic
  info to notification payloads.

macOS quirk: OS banners only fire from the installed
`/Applications/Alfredo.app`, not from `npm run tauri dev`.
