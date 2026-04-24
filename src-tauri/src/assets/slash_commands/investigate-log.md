---
description: Dispatch a subagent to summarise a large log file so its contents stay out of this transcript.
argument-hint: "[log-path]"
---

# Investigate Log

Summarise a large local log file **without** reading its contents into this transcript. The file is dispatched to a subagent; only the summary returns.

**Argument:** Absolute or workspace-relative path to a log file (e.g. `/tmp/build.log`, `logs/server.log`). Required.

## Workflow

### Step 1: Validate the path

If the argument is missing or the file does not exist, stop and ask for a valid path. Do **not** attempt to read it in the main transcript.

### Step 2: Dispatch a subagent

Use the **Agent** tool with `subagent_type: "general-purpose"`. Pass this prompt verbatim (substituting `<LOG_PATH>`):

> You are summarising a large log file at `<LOG_PATH>`. Do **not** paste the file contents back — only return a tight summary.
>
> 1. Get file size (`wc -c <LOG_PATH>`) and line count (`wc -l <LOG_PATH>`).
> 2. Count occurrences of `error`, `ERROR`, `warn`, `WARN`, `panic`, `fatal` (case-insensitive grep with `-c` or `-i | wc -l`).
> 3. Find the most-recent error/panic/fatal line and grab 5 lines of surrounding context (e.g. `grep -in -A2 -B2 -E 'error|panic|fatal' <LOG_PATH> | tail -n 20`).
> 4. Identify the top 3 most-repeated error patterns (e.g. `grep -iE 'error|panic|fatal' <LOG_PATH> | sort | uniq -c | sort -rn | head -3`). Strip variable bits (timestamps, IDs) when grouping.
> 5. Return a summary under **200 words** with this shape:
>    - **File:** `<LOG_PATH>` — <size>, <lines> lines
>    - **Counts:** errors=N, warnings=N, fatals=N
>    - **Most recent error (with context):** quoted, <=7 lines
>    - **Top repeated patterns:** up to 3, with counts
>    - **Suggested next step:** one sentence
>
> Do NOT include large excerpts, full stack traces, or anything over 200 words.

### Step 3: Relay the subagent's summary

Paste the subagent's summary directly. Do not re-read the file in the main transcript.
