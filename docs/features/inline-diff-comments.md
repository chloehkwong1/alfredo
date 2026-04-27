---
title: Leaving inline comments on a diff
keywords: [annotate, annotation, comment, inline comment, diff comment, review, note, leave comment]
ui_path: Changes panel → open a file's diff → click a line to annotate
---

Inline comments ("annotations" in the code) let you jot notes on
specific diff lines — either for yourself or as a starting point for
a GitHub PR review comment.

To leave one, click any line in the diff view. An input box opens
inline. Type your note and submit; the comment pins to that line and
renders in the gutter on future visits.

The strip of **Comment chips** above the input inserts reusable
snippets with one click — for example, you might have chips labelled
"Add test", "Why?", and "Nitpick" that each paste a pre-written prompt
into the box. Manage the chip list in Settings → Comment Chips.

Annotations are local to the worktree by default — they don't sync to
GitHub automatically. If the worktree has a PR, inline comments from
GitHub reviewers show up in the same gutter alongside your local
notes; you can reply or resolve from here.

Each annotation shows a relative timestamp. Hover to see the full
date. Delete an annotation from its context menu.
