---
title: Leaving inline comments on a diff
keywords: [annotate, annotation, comment, inline comment, diff comment, review, note, leave comment, add to review, comment for the agent]
ui_path: Changes panel → open a file's diff → click a line to annotate
---

Inline comments ("annotations" in the code) let you jot notes on
specific diff lines — either for yourself or as a starting point for
a GitHub PR review comment.

To leave one, click any line in the diff view. An input box opens
inline. Type your note and pick where it goes: **Comment for the
agent** (Cmd/Ctrl+Enter) sends it to the running Claude tab and pins
it to the line as a local annotation; **Add to review**
(Cmd/Ctrl+Shift+Enter) queues it into a pending GitHub review
instead — see [PR review](pr-review.md).

The strip of **Comment chips** above the input inserts reusable
snippets — short phrases you'd otherwise retype on every review,
like "Why is this needed?", "Add a test for this", or "Extract this
into a helper." Click one and its text fills the comment box; edit
or submit as-is. Manage the chip list in Settings → Comment Chips.

Annotations are local to the worktree by default — they don't sync to
GitHub automatically. If the worktree has a PR, inline comments from
GitHub reviewers show up in the same gutter alongside your local
notes; you can reply or resolve from here.

Each annotation shows a relative timestamp. Hover to see the full
date. Delete an annotation from its context menu.
