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
- **Connect Linear** — button for the OAuth flow. Opens Linear in
  your browser; once approved, the callback port (19284) receives
  the token and the dialog flips to "Connected" with a Disconnect
  option.

If neither GitHub credential is set, PR-related features in the
changes panel, status bar, and command palette stay hidden.
