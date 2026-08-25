---
title: Reviewing a pull request
keywords: [pr, pull request, review pr, pr comments, pr panel, github pr, while you were away, reconcile, merged while closed, pr chip after restart]
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

## Auto-move to Done on approval

When a PR has an active approving review from any reviewer, Alfredo
moves its worktree to **Done** automatically on the next sync — for
both PRs you authored and PRs from others that you're tracking. An
approval is usually the signal you've been waiting on, so the worktree
shouldn't keep sitting in "In review" demanding attention.

The auto-move flips back to **Needs review** when the approval becomes
inactive — typically because a reviewer leaves a `changes_requested`
review, or a previous approval is dismissed (for example by GitHub's
"Dismiss stale reviews on new commits" rule firing on a new push).
Simply re-requesting review without dismissing the existing approval
does **not** flip the PR back; the active approval still wins.

Manual drag-and-drop placements you make after the auto-move are
respected and won't be overwritten on the next sync.

This catch-up also works across restarts: PR associations are
persisted, so chips survive a relaunch, and on launch Alfredo checks
worktrees whose PR merged or closed while the app was off — even ones
that have aged out of the normal sync window. Anything that settled
moves to Done with a summary toast ("While you were away: PR #123
merged — moved to Done"). Manual column placements are respected here
too.
Review comments can be sent straight into the agent session as context
via the inline actions on each comment card, so you can ask Claude or
Codex to address feedback without copy-pasting.

## Stack section on PRs you author

For a PR opened on a stacked branch, Alfredo keeps a **Stack** section
pinned in the PR description — bottom-to-top branch list, with
"(merged)" on any that have already landed and **← this PR** marking
the one you're looking at. It resyncs automatically as the stack
changes, so a reviewer can see the whole chain from any PR in it.

Merging the bottom PR retargets its children onto the default branch
and dissolves the stack relationship automatically. One gap: if a stack
parent is merged manually outside of GitHub (no PR event to react to)
while its worktree is still open, Alfredo can't tell it landed and
won't auto-dissolve — detach it yourself via **Change base branch...**
once you notice.
