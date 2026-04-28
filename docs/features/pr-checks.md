---
title: PR panel — viewing and rerunning GitHub checks
keywords: [pr checks, ci, github actions, workflow, rerun checks, failing check, fix failing ci]
ui_path: Changes panel → PR tab → Checks section
---

When a worktree has an open pull request, the **PR** tab of the
Changes panel shows a **Checks** section listing every GitHub Actions
check run. Each row has the check name, status (pending, success,
failure, cancelled), duration, and a link to the run logs on GitHub.

Clicking a check expands it with the most recent log output inline,
so you don't have to jump to the browser to see why something failed.
Each failing entry also has an **external-link icon** that opens the
run on GitHub in one click. When the failure list is long it scrolls
inside its own container so the bulk actions (rerun / fix / merge-and-fix)
stay reachable below.

Two command-palette actions speed up a common loop when checks fail:

- **Rerun failing checks** — re-runs only the failing workflow runs
  for the active worktree's PR (uses the GitHub API via your token
  or `gh` login).
- **Fix failing checks** — sends the failing logs to the worktree's
  Claude / Codex / Gemini agent as a prompt asking it to diagnose
  and fix. Useful for flaky-looking failures or obvious regressions.

Both commands only show up in the palette when the active worktree
has a PR with at least one failing check.
