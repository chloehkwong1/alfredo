---
title: Open a Linear issue in Alfredo — deep link, repo picker, base branch
keywords: [linear, open in alfredo, deep link, coding tools, issue, ticket, custom link, repo picker, base branch, background open, prompt, alfredo://]
ui_path: Linear → issue → Open in Alfredo (custom coding-tool link)
---

Clicking a Linear issue's "Open in Alfredo" link creates a worktree for
the issue, launches Claude in it, and pastes the full issue into the
input — ready to review and submit with Enter. Nothing is sent to the
agent automatically; the prompt just sits in the input box.

## Setup (once)

In Linear: **Settings → Editor → Coding tools**, add a custom link
with the URL template:

```
alfredo://open-issue?prompt={{prompt}}
```

Alfredo registers the `alfredo://` scheme on install. The link works
whether Alfredo is already running or not — a cold start opens the app
first, then runs the flow.

## What happens on click

1. If Alfredo can't tell which repo the issue belongs to (the custom
   link carries no workdir), the **Open Linear issue** dialog asks you
   to pick one. It also shows the **base branch** the worktree will be
   created from — the repo's default branch unless you press *Change*
   and pick another (useful for stacking on an in-flight branch).
2. A worktree is created on the issue's suggested branch name.
3. Claude launches in the new worktree, and once its boot output
   settles the issue is pasted into the input. When the Linear
   integration is connected (Settings → Integrations), Alfredo fetches
   the complete title + description from the API — Linear truncates
   long issues in the link itself.
4. The worktree gets the Linear ticket chip in its status bar, and
   **Open in Linear** appears in its right-click menu.

If you're focused on another worktree when the link fires, the issue
opens in the **background**: the worktree is created and Claude gets
the prompt, but your focus isn't stolen. Switch to it whenever you're
ready.

Re-clicking the link for an issue whose worktree already exists reuses
that worktree instead of failing — the prompt is pasted into its agent
again.

## Notes

- A progress overlay shows while the worktree is created and Claude
  boots (a few seconds); if anything fails you get a toast instead of
  a silent no-op.
- The repo must already be added to Alfredo (see "Adding a repo").
- The Linear API fetch is optional — without the integration the link
  text is pasted as-is, which Linear may have truncated.
