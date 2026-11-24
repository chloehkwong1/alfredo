---
title: Worktrees created outside Alfredo appear automatically
keywords: [external worktree, git worktree add, discovery, adopt, auto-detect, terminal, script, deleted worktree, sync, autostart, start agent automatically, marker, worktree note, name a worktree, label, orchestration, role, orchestrator, plan, map, plan item, alsoAfter]
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

## Worktree note files

A tool can give a worktree a name, put it in an orchestration, and make
it the orchestrator, by writing a worktree note. The note is one JSON file at
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
- A note file larger than 32 KB, or one that is not valid JSON, is ignored.
  A note with neither a `label` nor an `orchestration` is ignored too.

To write one, run this from any folder inside the worktree:

```bash
top="$(git rev-parse --show-toplevel)"
dir="$(git rev-parse --path-format=absolute --git-common-dir)/alfredo/worktrees" && mkdir -p "$dir"
printf '{"path":"%s","label":"PR 2 · Document scopes","orchestration":"Documents refactor"}\n' "$top" > "$dir/$(basename "$top").json"
```

### Making a worktree the orchestrator, with a plan

Two more fields turn a worktree into the **orchestrator** of its
orchestration and give the orchestration a **map**. Alfredo only reads
the note. Whatever writes it is yours: your own orchestrator, mod or
script can write it, and Alfredo does not care which. Alfredo shows the
`orchestrator` tag and the map from the note alone.

```json
{
  "path": "/abs/path/to/the/orchestrator/worktree",
  "label": "Agency staff",
  "orchestration": "Agency staff",
  "role": "orchestrator",
  "plan": [
    { "key": "1", "name": "PR 1", "title": "Scheduling-only rule", "state": "merged", "folder": "chloe-scheduling-only-rule" },
    { "key": "5", "name": "PR 5", "title": "Agency set-up", "after": "1", "alsoAfter": ["4"], "state": "active", "folder": "chloe-agency-set-up" },
    { "key": "6", "name": "PR 6", "title": "Clean-up script", "after": "5", "state": "todo" }
  ]
}
```

- `role` is optional. The only value is `orchestrator`. Any other
  value counts as no `role`. A `role` with no `orchestration` is
  ignored.
- `plan` is optional: one item per piece of work, also for work that
  has no worktree yet. Alfredo reads it only from a note whose `role`
  is `orchestrator`. In any other note it is ignored. A `plan` that is
  not a list is read as no plan; it never makes the whole note fail.
- Each plan item has these fields:
  - `key` (required) is the short name shown in the item's square, for
    example `5`, `2a` or `Library`. It is trimmed, loses its control
    characters and is cut at 8 characters. An item with no key is
    dropped. If a key repeats, the first item with it wins and the
    later ones are dropped. `after` and `alsoAfter` name keys.
  - `name` is how the item is called in a sentence, for example
    `PR 5`. It is cut at 40 characters. With no `name`, the key is
    used. Alfredo never adds a word such as "PR" by itself.
  - `title` is cut at 200 characters, like `label`.
  - `after` is the key of the one parent the item hangs from in the
    map. `alsoAfter` is a list of keys of other items it waits for. It
    draws no line; it shows only in the tooltip's grey line, as
    `also after PR 4`.
  - `key`, `after` and each entry of `alsoAfter` must be JSON strings:
    `"key": "5"`, not `"key": 5`. An item whose key is not a string is
    dropped. An `after` that is not a string counts as none, and an
    `alsoAfter` entry that is not a string is left out.
  - `state` is `todo`, `active`, `merged` or `closed`. Anything else,
    or none, counts as `todo`.
  - `folder` is the folder name of the item's worktree, when it has
    one. It ties the item to that worktree. The map uses it to ring
    the row under the pointer and to show whether that worktree needs
    you.
- The plan is cut at 50 items.
- A plan item finds its worktree only when that worktree is in the same
  orchestration: the worktree needs its own note with the same
  `orchestration`, or a rule with that orchestration's name must match
  its branch. A worktree that only a session's work links to the
  orchestrator is listed in a second orchestration, made from those
  links. It gets a mark there when that orchestration has two rows or
  more, but no square of the map is ringed for it, and its square does
  not show when it needs you.
- Alfredo reads notes for the repo's linked worktrees only. A note for
  the main checkout is never read, so the orchestrator must be a linked
  worktree to carry a plan.
- If two notes in one repo say `orchestrator` for the same
  orchestration, one wins in this order: a worktree with a PR number
  comes before one without, then the lower PR number, then the branch
  name that sorts first. The other is a plain member.

See [Orchestrations](orchestrations.md) for how the tag, the mark and
the map look.
