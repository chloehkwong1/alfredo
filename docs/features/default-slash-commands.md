---
title: Default slash commands shipped with new worktrees
keywords: [slash commands, slash command, /ci-failure, /investigate-log, /diff-summary, context hygiene, subagent, .claude/commands]
ui_path: New worktree → Claude session → type /ci-failure, /investigate-log, or /diff-summary
---

Every newly-created worktree gets three default slash commands written
into `.claude/commands/` so they're available in any Claude Code
session opened in that worktree. They all do the same thing: dispatch
a subagent to chew through bulky output and return only a short
summary, so the noisy raw text never lands in your main transcript.

- **`/ci-failure [run-id-or-url]`** — fetch a failing GitHub Actions
  run, send the full logs to a subagent, get back a focused failure
  summary. Argument is the run ID (`1234567890`) or a run/job URL.
  - Example: `/ci-failure https://github.com/chloehkwong1/alfredo/actions/runs/24985308156`
  - You'd see a few short bullets back — failing job name, the
    specific step that errored, the relevant log excerpt, and a
    likely cause — instead of 5,000 lines of green setup output.
- **`/investigate-log [log-path]`** — point at a local log file
  (absolute or workspace-relative); the subagent reads it and
  reports what's interesting. Useful for tail-of-build outputs,
  server logs, anything multi-MB.
  - Example: `/investigate-log /tmp/dev-server.log`
  - Returns a compact summary of errors, repeated warnings, and
    timing anomalies — your transcript stays clean.
- **`/diff-summary [ref-range]`** — summarise a large git diff
  without pulling the patch into this transcript. Accepts a range
  like `main..HEAD`, `v0.8.0..v0.9.0`, `abc..def`, or a single ref
  (treated as `<ref>..HEAD`).
  - Example: `/diff-summary main..HEAD`
  - Returns a few bullets per file group ("auth: added refresh
    token rotation", "ui: extracted FormField component") rather
    than 800 lines of patch.

The commands are written on creation only — **existing worktrees
aren't retrofitted**, so if you want them in an older worktree, copy
the three files from `src-tauri/src/assets/slash_commands/` into
that worktree's `.claude/commands/`.

Files in `.claude/commands/` are automatically excluded from git
status (via Alfredo's `ensure_claude_excludes` helper), so they
don't pollute uncommitted-changes lists or the sidebar's diff
counter. Linear-flow worktrees also get a "Context hygiene" section
at the bottom of `CLAUDE.local.md` pointing at the three commands.
