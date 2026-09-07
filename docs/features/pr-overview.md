---
title: PR overview — wide review layout with Reviewed checkboxes
keywords: [pr overview, focus mode, wide pr, reviewed checkbox, viewed files, mark as viewed, github viewed, file groups, implementation, tests, hero, rail]
ui_path: Changes panel → PR tab → Focus mode (⌘⇧E)
---

Widen the Changes panel into **focus mode** (⌘⇧E) while the **PR**
tab is active and the panel switches to a wide overview layout: a
hero with the PR's status, title and description up top, followed by
your review draft, reviews, checks and comment threads, with a
persistent rail alongside. It's the same information as the narrow PR
tab, laid out for reading a whole PR rather than peeking at it.

**Grouped file list.** Changed files are split into
**Implementation** and **Tests** groups (test files are recognised by
the usual conventions — `*.test.*` / `*.spec.*`, `_spec.rb`, and
`test`/`spec`/`__tests__` directories), each group showing its total
additions and deletions. Click a file to open its diff.

**Reviewed checkboxes.** Every file in the PR's diff gets a checkbox
that mirrors GitHub's native **Viewed** state — tick it in Alfredo
and it's marked viewed on github.com, and files you already marked
viewed on GitHub arrive ticked. Progress therefore survives across
both surfaces and across sessions.

Two edges worth knowing:

- A file that exists locally but isn't part of the PR's diff on
  GitHub (uncommitted or unpushed work) shows a disabled checkbox —
  GitHub can't track viewed state for a file it hasn't seen. Push the
  commit and the checkbox activates.
- GitHub's viewed state is fetched once per worktree per app session.
  Boxes you tick on github.com while Alfredo is running show up after
  the next app restart; anything you tick inside Alfredo is always
  current.

Requires a GitHub token (Settings → GitHub). Leave focus mode with
⌘⇧E again and the PR tab returns to the narrow layout.
