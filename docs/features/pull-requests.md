---
title: Reviewing a pull request
keywords: [pr, pull request, review pr, pr comments, pr panel, github pr]
ui_path: Worktree tab → Changes panel → PR section (⌘⇧C / ⌘I to toggle)
---

When a worktree's branch has an open pull request on GitHub, Alfredo
pulls in the PR metadata and surfaces it in the Changes panel alongside
the diff. Open the Changes panel with ⌘⇧C or ⌘I (or expand it from the
right rail) and you'll see the PR description, the list of CI check runs
with pass/fail status, reviewer decisions and requested reviewers, plus
unresolved review comments threaded by file.

The sidebar row for the worktree shows the PR number, title, and a
condensed stats row (approvals, failing checks, unresolved comments) so
you can triage at a glance. Once the PR is merged, the stats row
collapses to a single purple **Merged** chip — the precursor chips
(Approved, Checks pass, etc.) are suppressed so a merged PR doesn't
look like it still needs action. If you close a PR on GitHub without
merging, the sidebar row collapses to a single **Cancelled** chip
(closed-PR icon) for the same reason, the Changes panel shows a red
**Cancelled** banner, and the worktree auto-moves to Done on the next
sync so it doesn't sit in "in review" with stale check status. Right-clicking the worktree in
the sidebar gives you "View PR on GitHub" to jump to the full PR in
your browser.
Review comments can be sent straight into the agent session as context
via the inline actions on each comment card, so you can ask Claude or
Codex to address feedback without copy-pasting.
