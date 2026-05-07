---
title: Repo-shared config — the alfredo.json file
keywords: [alfredo.json, repo config, shared config, layered config, upstream, override, reset, teammate, schema, migration, config layer, defaults, repository defaults]
ui_path: Repository Settings → header chip / Scripts and Ports tabs
---

`alfredo.json` lives at the root of a repo. It captures the bits of
Repository Settings that should follow the repo, not the machine —
the **setup scripts**, **run script**, **archive script**, **port
range**, **port env var**, and **default agent**. Commit it and
teammates who clone the repo get the same defaults out of the box.

**Why two layers?**

Some repo settings (badge colour, display name, worktree directory)
are personal — you decide how the sidebar looks on your machine.
Others (the scripts that bring up a fresh worktree) are universal —
everyone working on the repo wants the same answer. The two-layer
model keeps both honest:

- **Repo layer** (`alfredo.json`, committed): the team default.
- **Personal layer** (per-machine): just your overrides.

Effective config is personal-on-top-of-repo. If `alfredo.json`
defines `npm install` as a setup script and you also want to copy
an env file, your override stacks on top — `alfredo.json` keeps
its value untouched.

**The header chip** (top right of Repository Settings) tells you
which state the repo is in:

- **Tracking `alfredo.json`** — file exists *and* is in the git
  index. Teammates will pick it up.
- **`alfredo.json` not in git** — file exists but is untracked.
  Almost always means the migration ran but you haven't committed
  yet. Commit the file or teammates won't see your defaults.
- **Local only · Create `alfredo.json`** — no file at all. Click
  to create one seeded with whatever shared values are currently
  set on your personal layer.

**Per-field overrides:** any Scripts or Ports field that differs
from `alfredo.json` shows an **Override** tag and a **Reset** button.
Reset wipes the personal value and falls back to the committed
default. **Reset all overrides** at the bottom of the dialog clears
every personal override in one click (with a confirm prompt).

**One-time migration:** the first time Alfredo loads a repo that
doesn't have an `alfredo.json` but does have shared values on the
personal layer (because they were set before this feature existed),
those values move to a new local `alfredo.json` automatically. Your
personal layer is left with only its overrides. The migration is
silent — the file isn't committed, that's up to you. The "not in
git" chip is the cue to commit.

**Schema:** the file is plain JSON with a `$schema` pointer to
`schemas/alfredo.schema.json` shipped inside the app, so editors with
JSON-schema support give you autocomplete and validation. A typical
file looks like:

```json
{
  "$schema": "...",
  "setupScripts": [
    { "command": "npm install" }
  ],
  "runScript": "npm run dev",
  "portRangeStart": 3000,
  "portRangeEnd": 3010,
  "portEnvVar": "PORT"
}
```

Fields you don't set are simply absent — Alfredo treats missing keys
as "no opinion at the repo layer", and the personal layer (or the
hard-coded defaults) takes over.

**Failure modes:** a malformed `alfredo.json` is detected on load
and surfaces as an error toast, not a wedged loading screen. Fix
the JSON and re-open the worktree.
