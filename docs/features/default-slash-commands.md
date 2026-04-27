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
  *Example:* `/ci-failure 9876543210` → Claude fetches the run, reads
  all log chunks, and replies with just the error and the step that
  failed — not 10 000 lines of raw output.
- **`/investigate-log [log-path]`** — point at a local log file
  (absolute or workspace-relative); the subagent reads it and
  reports what's interesting. Useful for tail-of-build outputs,
  server logs, anything multi-MB.
  *Example:* `/investigate-log ./tmp/build.log` → subagent skims a
  20 MB build log and surfaces the first error and any non-trivial
  warnings, without pasting the whole file into the transcript.
- **`/diff-summary [ref-range]`** — summarise a large git diff
  without pulling the patch into this transcript. Accepts a range
  like `main..HEAD`, `v0.8.0..v0.9.0`, `abc..def`, or a single ref
  (treated as `<ref>..HEAD`).
  *Example:* `/diff-summary v1.2.0..HEAD` → Claude describes what
  changed across the release in plain English, without the raw patch
  eating your context window.

The commands are written on creation only — **existing worktrees
aren't retrofitted**, so if you want them in an older worktree, copy
the three files from `src-tauri/src/assets/slash_commands/` into
that worktree's `.claude/commands/`.

Files in `.claude/commands/` are automatically excluded from git
status (via Alfredo's `ensure_claude_excludes` helper), so they
don't pollute uncommitted-changes lists or the sidebar's diff
counter. Linear-flow worktrees also get a "Context hygiene" section
at the bottom of `CLAUDE.local.md` pointing at the three commands.
