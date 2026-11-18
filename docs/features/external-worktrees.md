---
title: Worktrees created outside Alfredo appear automatically
keywords: [external worktree, git worktree add, discovery, adopt, auto-detect, terminal, script, deleted worktree, sync, autostart, start agent automatically, marker, worktree note, name a worktree, label, orchestration]
ui_path: N/A — automatic; new worktrees appear in the sidebar within seconds
---

You don't have to create worktrees through Alfredo. Run
`git worktree add` from a terminal, a script, or an agent session,
and Alfredo notices within about ten seconds and **adopts** the new
worktree: it appears in the sidebar with an unread badge, gets the
default tabs, and runs the repo's create-time setup scripts (showing
the usual "Setting up…" status while they run) — the same
provisioning a worktree created in-app gets.

Deletion works in reverse. Remove a worktree from disk outside
Alfredo and its card disappears, with a full clean-up rather than a
silent drop: any running agent session is closed, tabs and layout
are cleared, the dev-server port is released, and the stale git
worktree entry is pruned.

## Details

- Only **worktree-mode** repos are watched; branch-mode repos are
  skipped.
- Worktrees that already exist when Alfredo starts are simply
  listed, never re-adopted — setup scripts won't run twice.
- Switching branches inside an existing worktree
  (`git checkout -b`) is not treated as a new worktree; adoption
  only triggers for a genuinely new path on disk.
- The same holds in reverse: a branch change — including a rebase
  that finishes on a detached HEAD — is never read as a deletion.
  Removal needs the directory itself to be gone, so work in a
  worktree is safe no matter what its branch does.
- Creating a worktree through Alfredo's own flow is unaffected —
  discovery pauses while an in-app creation is mid-flight.

## Starting an agent automatically

A tool that creates worktrees for you (a script, a Claude Code mod)
can ask Alfredo to start Claude in the new worktree too. Before it
runs `git worktree add`, it writes a marker file at
`<common git dir>/alfredo/autostart/<worktree folder name>` that
contains the worktree's absolute path. To find the common git dir,
run `git rev-parse --path-format=absolute --git-common-dir` in the
repo. It is usually the repo's `.git`. Without `--path-format=absolute`,
git can print a relative `.git`.

When Alfredo adopts the worktree, it removes the marker, waits for
the setup scripts to finish, and starts Claude in the background.
Alfredo does not change focus and does not send a prompt; the tool
sends its own first prompt.

- Without a marker, no agent starts. Subagent and scripted
  worktrees stay idle.
- Autostart starts Claude only. If your Default Agent is Codex or
  Gemini, the new worktree's agent tab uses that agent, and Alfredo
  does not start it.
- Write the marker before `git worktree add`. If you write it after,
  Alfredo can adopt the worktree first and ignore the marker.
- A marker works once. If a marker is older than an hour when
  Alfredo adopts a worktree with that folder name, Alfredo deletes it
  without using it.
- Only worktrees created while Alfredo runs are adopted, so a marker
  for a worktree that existed at launch does nothing.

## Naming a worktree from outside

A tool can give a worktree a name, and put it in an orchestration, by
writing a worktree note. The note is one JSON file at
`<common git dir>/alfredo/worktrees/<worktree folder name>.json`, in
the same `alfredo` folder as the autostart marker:

```json
{ "path": "/abs/path/to/the/worktree", "label": "PR 2 · Document scopes", "orchestration": "Documents refactor" }
```

- `path` is required and must be the worktree's absolute path. A
  note whose `path` is another worktree is ignored, so a reused
  folder name does not take an old note.
- `label` is the name in the sidebar row and in notifications.
  `orchestration` puts the worktree in the
  [orchestration](orchestrations.md) with that name. Both are
  optional. A note with only a `label` only renames the row.
- Each text is trimmed, loses its control characters, and is cut at
  200 characters. A text that is empty after that counts as absent.
- A label you set by hand
  ([Renaming a worktree](renaming-worktree.md)) wins over the note's
  `label`.
- Alfredo reads the note each time it refreshes the worktree list,
  so a change shows at the next refresh: usually within a minute
  while Alfredo is the focused app, and up to about ten minutes while
  it is not.
  Alfredo never changes or removes the note.
- A note larger than 4 KB, or one that is not valid JSON, is ignored.

To write one, run this from any folder inside the worktree:

```bash
top="$(git rev-parse --show-toplevel)"
dir="$(git rev-parse --path-format=absolute --git-common-dir)/alfredo/worktrees" && mkdir -p "$dir"
printf '{"path":"%s","label":"PR 2 · Document scopes","orchestration":"Documents refactor"}\n' "$top" > "$dir/$(basename "$top").json"
```
