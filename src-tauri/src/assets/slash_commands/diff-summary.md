---
description: Dispatch a subagent to summarise a large git diff so the full patch stays out of this transcript.
argument-hint: "[ref-range]"
---

# Diff Summary

Summarise a large git diff **without** pulling the full patch into this transcript. The diff is dispatched to a subagent; only the summary returns.

**Argument:** A git ref range (e.g. `main..HEAD`, `v0.8.0..v0.9.0`, `abc123..def456`) or a single ref (treated as `<ref>..HEAD`). Required.

## Workflow

### Step 1: Parse the argument

- If it contains `..`, use as-is.
- If it's a single ref, use `<ref>..HEAD`.
- If empty, stop and ask for a range.

### Step 2: Dispatch a subagent

Use the **Agent** tool with `subagent_type: "general-purpose"`. Pass this prompt verbatim (substituting `<RANGE>`):

> You are summarising a git diff for range `<RANGE>`. Do **not** paste the full patch back — only return a tight summary.
>
> 1. Run `git diff <RANGE> --stat` to get the file list and line counts.
> 2. Run `git diff <RANGE>` and read it. If it's large (>2000 lines), sample: read the first 500 lines, last 500 lines, and stat output.
> 3. Group changed files by subsystem when obvious (e.g. `src/components/sidebar/`, `src-tauri/src/commands/`, `tests/`). If grouping isn't clear, list flat.
> 4. Identify: high-level what changed (1–3 themes), notable risks (schema/migration changes, public API changes, security-sensitive areas, deletions of significant code), and any TODO/FIXME/HACK introduced.
> 5. Return a summary under **200 words** with this shape:
>    - **Range:** `<RANGE>` — N files, +X / -Y lines
>    - **Files (grouped):** short list per subsystem
>    - **What changed:** 1–3 bullets, theme-level
>    - **Risks / callouts:** up to 3 bullets, or "none obvious"
>    - **Suggested next step:** one sentence
>
> Do NOT include diff hunks, full file contents, or anything over 200 words.

### Step 3: Relay the subagent's summary

Paste the subagent's summary directly. Do not re-run `git diff` in the main transcript.
