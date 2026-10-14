---
title: PR panel — checks, and merging from the banner
keywords: [pr checks, ci, github actions, workflow, rerun checks, failing check, fix failing ci, merge, merge pr, squash and merge, rebase and merge, merge commit, ready to merge, mark ready for review, draft pr, undraft]
ui_path: Changes panel → PR tab → Checks section / merge banner
---

When a worktree has an open pull request, the **PR** tab of the
Changes panel shows a **Checks** section listing every GitHub Actions
check run. Each row has the check name, status (pending, success,
failure, cancelled), duration, and a link to the run logs on GitHub.

Clicking a check expands it with the most recent log output inline,
so you don't have to jump to the browser to see why something failed.
Each failing entry also has an **external-link icon** that opens the
run on GitHub in one click. When the failure list is long it scrolls
inside its own container so the bulk actions (rerun / fix / merge-and-fix)
stay reachable below.

Two command-palette actions speed up a common loop when checks fail:

- **Rerun failing checks** — re-runs only the failing workflow runs
  for the active worktree's PR (uses the GitHub API via your token
  or `gh` login).
- **Fix failing checks** — sends the failing logs to the worktree's
  Claude / Codex / Gemini agent as a prompt asking it to diagnose
  and fix. Useful for flaky-looking failures or obvious regressions.

Both commands only show up in the palette when the active worktree
has a PR with at least one failing check.

## Merging from the banner

The banner at the bottom of the PR tab reports the PR's state —
merge conflict, failing checks, changes requested, draft, approved —
and once everything is green it becomes a merge button.

**Ready to merge** appears when the PR is approved, has no
conflicts, and no check is still running. The button is labelled
with your repo's default method (**Squash & merge**, **Create merge
commit** or **Rebase & merge**); if the repo allows more than one,
a small chevron next to it lets you pick. Pressing it opens a
confirmation naming the PR, the method and the base branch, because
a merge can't be undone from Alfredo. After a successful merge the
banner reads "Merged — updating…" until the next sync moves the
worktree to Done.

**Drafts.** A draft PR that is approved shows "Approved — still a
draft" with a combined **Mark ready & squash** (or merge / rebase)
button, so one press takes it out of draft and merges it. Alfredo
only offers the combined press when checks have already run on the
PR — undrafting is often what starts CI, and merging a head that was
never tested is the thing the checks guard exists to prevent. A
draft that isn't ready to merge gets a plain **Mark ready for
review** button with no confirmation, since GitHub undoes that in
one click.

If GitHub refuses the merge after the undraft (a repo that requires
code-owner approval will), the toast says so: the PR stays open and
out of draft, and the ordinary merge button comes back on the next
poll.
