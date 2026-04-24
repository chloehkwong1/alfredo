---
description: Dispatch a subagent to summarise a failing CI run so raw log output stays out of this transcript.
argument-hint: "[run-id-or-url]"
---

# CI Failure Summary

Summarise a failing GitHub Actions run **without** pulling raw log output into this transcript. The full log is dispatched to a subagent; only the summary returns.

**Argument:** A GitHub Actions run ID (e.g. `1234567890`) or a job/run URL (e.g. `https://github.com/owner/repo/actions/runs/1234567890`). Required.

## Workflow

### Step 1: Parse the argument

- If it's a numeric ID, treat it as `<RUN_ID>`.
- If it's a URL, extract the run ID from `/actions/runs/<RUN_ID>` (and the job ID from `/job/<JOB_ID>` if present).

### Step 2: Dispatch a subagent

Use the **Agent** tool with `subagent_type: "general-purpose"`. Pass this prompt verbatim (substituting `<RUN_ID>` / `<JOB_ID>`):

> You are summarising a failing CI run. Do **not** paste full logs back to the caller — only return a tight summary.
>
> 1. Run `gh run view <RUN_ID> --log-failed` (or `gh run view --job <JOB_ID> --log` if a specific job was given). If `gh` is not authenticated, report that and stop.
> 2. Identify: the failing job name, the failing step name, and the first ~10 lines that explain the root cause (compiler error, assertion, exit code, etc.). Skip noise (setup, cache, dependency install) unless it IS the failure.
> 3. Return a summary under **200 words** with this shape:
>    - **Job:** <name>
>    - **Step:** <name>
>    - **Root cause:** 1–3 sentences naming the actual failure
>    - **Key log lines:** at most 5 short lines, quoted, no full stack traces
>    - **Suggested next step:** one sentence
>
> Do NOT include the raw log, full stack traces, or anything over 200 words. If the run actually passed or no failed step exists, say so and stop.

### Step 3: Relay the subagent's summary

Paste the subagent's summary directly. Do not re-fetch logs in the main transcript.
