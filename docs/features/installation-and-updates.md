---
title: Installing Alfredo and staying up to date
keywords: [install, update, auto update, updater, beta, stable, receive beta, version]
ui_path: Global Settings → General → Updates
---

Grab the latest macOS or Linux build from the GitHub releases page:
https://github.com/chloehkwong1/alfredo/releases. Drag the `.app`
into `/Applications` on macOS (the signed, installed copy is what
macOS uses for notification banners — running from source won't
trigger them).

Alfredo checks for updates in the background. When one is available
a prompt offers to download and install it, then restart the app.
The flow is powered by `tauri-plugin-updater`; downloads stream with
a progress event, and failed installs leave the pending update in
place so you can retry without re-checking.

By default the updater only picks up **stable** releases. To
receive pre-releases, open Global Settings → General → Updates and
toggle **Receive beta updates**. Alfredo switches to the beta
endpoint on the next check and will offer whichever channel you're
opted into.

Windows is not supported — the Windows build is disabled in CI.
