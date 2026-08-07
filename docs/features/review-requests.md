---
title: Review requests — auto-pulled worktrees for PRs awaiting your review
keywords: [review request, requested reviewer, auto-pull, code review, review a PR, needs review, review prompt, reviewing pull requests]
ui_path: Sidebar → ⚙ Settings → General tab → Auto-pull review requests
---

When someone requests your review on a GitHub PR, Alfredo notices on
its next poll and **creates a worktree for that PR's branch
automatically** in the matching repo — the diff is checked out locally
before you've even looked at it. No agent is launched at creation
time; the card just appears in the sidebar's **Needs Review** column.

The first time you open one of these worktrees, a ready-made review
prompt is pasted into a fresh Claude session: the PR number, title,
author and URL, plus an ask to walk you through the diff against the
base branch — correctness first, then design, tests and anything
risky. The prompt is pasted for you to edit and submit — it is never
auto-sent. This first-open paste only happens for worktrees created
in the current app run; after a restart, restored sessions are left
alone.

Column behaviour follows your involvement: PRs where your review is
requested park in **Needs Review** even if others have approved, and
someone else's PR only moves to **Done** once *you* have approved it.

The feature is controlled by **Auto-pull review requests** in
Settings → General (default on). Turning it off stops future
auto-creation; worktrees that already exist are unaffected. Note
that deleting one of these worktrees while the review request is
still open on GitHub means it will be pulled again on a later poll —
to make it stay gone, submit the review (or have the request
withdrawn), or turn the toggle off.
