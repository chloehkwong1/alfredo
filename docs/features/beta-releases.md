---
title: Beta release channel
keywords: [beta, prerelease, pre-release, updates, channel]
ui_path: Sidebar → App settings (gear) → General → Updates → "Receive beta updates"
---

The "Receive beta updates" toggle in Global Settings → General →
Updates opts you into pre-release builds of Alfredo. With it off (the
default) the auto-updater only sees stable releases. With it on, the
updater also picks up beta tags, so you'll generally upgrade sooner
and hit new features — and new bugs — before everyone else.

Only flip it on if you're comfortable with breakage. Betas ship
work-in-progress features, and the occasional release has regressions
that stable users never see. Bug reports from beta testers are
genuinely useful, so the toggle exists; it isn't meant as a general
"get the latest stuff" switch.

One caveat worth knowing: turning the toggle back off does not
downgrade you. You'll stay on whatever beta you're currently running
until the stable channel catches up with a newer version, at which
point normal stable updates resume. The change takes effect on the
next app launch, since update endpoints are resolved at startup.
