---
title: Reviewing a PR from Alfredo — draft, submit, reply, resolve
keywords: [pr review, review, submit review, approve, request changes, add to review, your review, reply, resolve thread, unresolve, review draft, review comment]
ui_path: Changes panel → PR tab → Your review
---

Once Alfredo detects a pull request for the worktree's branch, you can
run the whole review from the **PR** tab without bouncing to the
browser.

**Queue comments while reading the diff.** Open a file in the Changes
panel and click a line. The inline comment box has two submit paths:
**Comment for the agent** (Cmd/Ctrl+Enter) sends the note to the
running Claude tab, while **Add to review** (Cmd/Ctrl+Shift+Enter)
files it into a pending GitHub review instead. The button is offered
on every diff line, but GitHub only accepts review comments on lines
in the PR's own diff — a queued note on an uncommitted or unpushed
change makes the whole submit fail. Your drafts are kept when that
happens; remove the offending one and submit again.

**Your review** — a section in the PR tab that lists every queued
comment (remove one with the × on its row), a verdict picker
(**Approve**, **Request changes**, **Comment**) and a summary box.
The summary is required unless you're approving. Drafts persist per
worktree until you submit them or remove them one by one, so you can
read the PR over several sessions.

**Submit** posts the verdict, summary and all queued comments as one
GitHub review. The PR tab re-syncs straight after, so your review
appears in the Reviews list and your comments appear as threads.

**Reply and resolve.** Every inline thread from GitHub — yours or
another reviewer's — shows in the PR tab and in the diff gutter with
a **Reply to this thread…** box and a **Resolve** / **Unresolve**
action. Replies post immediately, outside any pending review.

Requires a GitHub token with write access to the repo (Settings →
GitHub). Read-only tokens can still see reviews and threads.
