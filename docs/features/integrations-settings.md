---
title: Integrations — GitHub token, Linear API key, Linear OAuth
keywords: [github, token, pat, personal access token, linear, api key, oauth, integrations, connect, disconnect]
ui_path: Sidebar → ⚙ Settings → Integrations tab
---

The **Integrations** tab of the global Settings dialog is where you
connect Alfredo to GitHub and Linear. Credentials are stored per-repo,
not globally — so each repo's settings apply to its own worktrees.

- **GitHub Token** — paste a GitHub personal access token (PAT) to
  enable PR creation, check viewing, and inline comment sync. If you
  have the GitHub CLI (`gh`) authenticated, Alfredo can use that
  instead.
- **Linear API Key** — paste a Linear API key for read-only ticket
  lookup. Works alongside the OAuth flow below.
- **Connect Linear** — button for the OAuth flow. Click it and:
  1. Your default browser opens Linear's OAuth approval page (the
     standard "Alfredo would like to access your Linear account"
     screen with the workspace picker and an **Authorize** button).
  2. Click Authorize. Linear redirects back to
     `http://localhost:19284/...` — Alfredo runs a tiny one-shot
     listener on that port just to catch the redirect and pull the
     token out of the URL. (Nothing is exposed to the network; the
     listener closes as soon as the callback arrives.)
  3. The Settings dialog flips to **Connected** with a Disconnect
     option. If port 19284 is already in use by another process,
     the flow fails — close the offender and retry.

If neither GitHub credential is set, PR-related features in the
changes panel, status bar, and command palette stay hidden.
