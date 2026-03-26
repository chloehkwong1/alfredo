# Agent State Detection: Expanded Hooks

**Date:** 2026-03-26
**Status:** Approved

## Problem

Agent status in the sidebar is frequently wrong in both directions:
- Shows "Idle" when the agent is actively running subagents and processing (hooks gap)
- Shows "Thinking..." when the agent is idle at the prompt (stale hook state)

Root cause: We only register 5 of Claude Code's 26 available hooks. The `Stop` hook fires → sets idle, but subsequent activity (subagent spawns, tool completions) never fires a hook to set busy again because we don't listen for those events. The detector can't compensate because its "busy" signal is suppressed once hooks are active.

## Solution

Register 6 additional hooks that fire during active work, eliminating the gaps between `Stop` and the next `PreToolUse`/`UserPromptSubmit`. Reduce the detector suppression window since hooks now fire more frequently.

## Changes

### 1. New hooks in `write_hooks_config()` (`pty_manager.rs`)

| Hook | Maps to state | Rationale |
|------|--------------|-----------|
| `SubagentStart` | `busy` | Agent spawned a subagent — actively working |
| `SubagentStop` | `busy` | Subagent finished, parent still processing results |
| `PostToolUse` | `busy` | Tool completed, agent still in its turn |
| `TaskCreated` | `busy` | Background task spawned |
| `TaskCompleted` | `busy` | Task done, agent still processing |
| `StopFailure` | `idle` | Agent errored out, treat same as Stop |

Combined with existing hooks, the full mapping becomes:

**Busy signals:** `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `TaskCreated`, `TaskCompleted`

**Idle signals:** `SessionStart`, `Stop`, `StopFailure`

**WaitingForInput signals:** `Notification` (permission_prompt matcher)

### 2. Reduce `HOOK_AUTHORITY_MS` (`sessionManager.ts`)

Change from `5000` to `3000`. With hooks firing more frequently, we need a shorter suppression window for faster detector fallback if hooks stop arriving.

## What's NOT changing

- `AgentState` enum — same 4 states
- `PtyEvent` enum — `HookAgentState` already carries what we need
- State server — already parses any `/agent-state/{wt_id}/{state}` URL
- Agent detector — untouched, continues as fallback for non-Claude agents
- Sidebar UI — no changes, just receives more accurate data
- `is_alfredo_hook_entry` cleanup — already works for new entries

## Files touched

1. `src-tauri/src/pty_manager.rs` — add 6 hook entries to `alfredo_hooks` vec
2. `src/services/sessionManager.ts` — change `HOOK_AUTHORITY_MS` from 5000 to 3000

## Future work (not in scope)

- Output-recency detection layer for universal agent support (Codex, Aider)
- `tcgetpgrp()` polling as process-level fallback
- OSC 133 shell integration handler (blocked on Claude Code upstream support)
