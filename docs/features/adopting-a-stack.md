---
title: Setting up a stack that exists on GitHub
keywords: [adopt, set up stack, stacked on, stacked pull request, base branch, pr base, imported pr, rebase and set up]
ui_path: Sidebar → worktree row → "Stacked on <branch> — set up?" cue
---

Sometimes a stack exists on GitHub before Alfredo knows about it — you
opened a PR whose base is another in-flight branch (from the CLI, or
by importing a PR), so GitHub shows the stacking but Alfredo has no
local parent recorded and won't restack for you.

When Alfredo spots this, the worktree's sidebar row shows a quiet cue:
**Stacked on \<branch\> — set up?** Clicking it never changes anything
by itself — it opens a small popover explaining what was detected and
what setting up the stack means: the branch joins the stack map, and
gets rebased automatically when its parent moves. While the popover is
open, Alfredo checks whether the branch is behind its parent, and the
popover tells you plainly which case you're in:

- **"Nothing changes now — no rebase, no push."** The branch already
  sits on the parent's tip, so **Set up stack** is a one-click
  metadata change.
- **"\<parent\> has moved (N commits) — setting up will rebase this
  branch onto it and push the update to the PR."** The button reads
  **Rebase & set up**, so the rebase is named before anything runs.
  Errors surface as a toast.

After setting up, the cue is replaced by the normal stack chip and a
toast confirms what happened. Undo any time with right-click →
**Detach from stack** — the popover's footer says the same.

The cue only appears for PRs you authored, and it stays away from
branches already involved in a stack or whose siblings Alfredo can't
fully see — in doubt, it doesn't offer. **Not now** (or the cue's ✕)
hides it for the rest of the app session; pressing Esc or clicking
elsewhere just closes the popover without dismissing the cue. It comes
back on the next launch if the situation still holds. Detaching a
branch from a stack also pre-dismisses the cue, so detach isn't
immediately answered by an offer to re-set-up.
