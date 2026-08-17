---
title: Review requests — auto-pulled worktrees for PRs awaiting your review
keywords: [review request, requested reviewer, auto-pull, code review, review a PR, needs review, reviewing pull requests]
ui_path: Sidebar → ⚙ Settings → General tab → Auto-pull review requests
---

When someone requests your review on a GitHub PR, Alfredo notices on
its next poll and **creates a worktree for that PR's branch
automatically** in the matching repo — the diff is checked out locally
before you've even looked at it. No agent is launched at creation
time; the card just appears in the sidebar's **Needs Review** column.

The first time you open one of these worktrees, a fresh Claude
session starts as usual — nothing is typed into it for you; ask for
a review (or anything else) in your own words.

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
