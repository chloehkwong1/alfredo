---
title: Adopting a stack that exists on GitHub
keywords: [adopt, adopt stack, stacked on github, base branch, pr base, imported pr, stacked on]
ui_path: Sidebar → worktree row → "stacked on <branch> on GitHub" cue
---

Sometimes a stack exists on GitHub before Alfredo knows about it — you
opened a PR whose base is another in-flight branch (from the CLI, or
by importing a PR), so GitHub shows the stacking but Alfredo has no
local parent recorded and won't restack for you.

When Alfredo spots this, the worktree's sidebar row shows an amber cue:
**stacked on \<branch\> on GitHub**, with an **adopt** action and a ✕
to dismiss. Nothing ever happens automatically — the cue is an offer,
not an action.

Clicking **adopt** records the stack relationship locally, so the
branch gets the full stacked treatment from then on: the pos/total
chip, the stack map, and automatic restacks when the parent moves.

- If the branch already sits on the parent's tip, adoption is a
  one-click metadata change — nothing is rebased.
- If the parent has advanced, adopting also rebases the branch onto it
  (and pushes with lease to update the PR). A confirm step names this
  first — "adopt rebases onto \<branch\> (N behind)" — so a rebase
  never runs from a single click. Errors surface as a toast.

The cue only appears for PRs you authored, and it stays away from
branches already involved in a stack or whose siblings Alfredo can't
fully see — in doubt, it doesn't offer. Dismissing with ✕ hides the
cue for the rest of the app session; it comes back on the next launch
if the situation still holds. Detaching a branch from a stack also
pre-dismisses the cue, so detach isn't immediately answered by an
offer to re-adopt.
