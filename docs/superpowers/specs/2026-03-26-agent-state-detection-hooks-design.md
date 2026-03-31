# Agent State Detection: Expanded Hooks

**Date:** 2026-03-26
**Updated:** 2026-03-31
**Status:** Approved

## Problem

Agent status in the sidebar is frequently wrong, most commonly showing "Thinking..." (busy) when the agent is waiting for user input. This has recurred across multiple prompt types.

### Root causes identified (2026-03-31 audit)

**Structural gap 1: Missing hooks.** We relied on `Notification(permission_prompt)` for permission dialogs, but Claude Code has a separate `PermissionRequest` hook with broader coverage (fires for ALL permission dialogs including file creation, settings changes). We also lacked `PostToolUseFailure` for interrupt detection — `Stop` hooks explicitly do not fire on user interrupts (per Claude Code docs).

**Structural gap 2: Hook race condition.** The `hookAgentState` handler unconditionally applied any state. A delayed `PreToolUse` "busy" arriving via HTTP after the detector already identified a prompt as `waitingForInput` would override the correct state. The Rust detector had a sticky `waiting_for_input` flag for this, but the frontend session manager did not.

**Structural gap 3: Deny-list detector.** The PTY detector defaults everything > 3 chars to Busy. Every new Claude Code prompt type required a new pattern — a whack-a-mole game.

## Solution

Three-layer defense:

1. **Maximize hook coverage** — Add `PermissionRequest` and conditional `PostToolUseFailure` hooks
2. **Catch-all detector patterns** — "Esc to cancel" covers virtually all Claude Code prompts
3. **Race condition protection** — `waitingForInput` sticky flag in session manager, mirroring the Rust detector

## Changes

### 1. Hooks in `write_hooks_config()` (`pty_manager.rs`)

Full hook mapping (15 hooks total):

| Hook | Maps to state | Rationale |
|------|--------------|-----------|
| `SessionStart` | `idle` | Session begins |
| `UserPromptSubmit` | `busy` | User submitted prompt |
| `Stop` | `idle` | Agent finished responding (does NOT fire on interrupts) |
| `PreToolUse` | `busy` | Tool about to execute |
| `PostToolUse` | `busy` | Tool completed, agent still in turn |
| `Notification(permission_prompt)` | `waitingForInput` | Permission notification |
| `Notification(elicitation_dialog)` | `waitingForInput` | MCP elicitation dialog |
| `Notification(idle_prompt)` | `idle` | Agent returned to prompt |
| `PermissionRequest` | `waitingForInput` | **NEW:** Fires for ALL permission dialogs (file creation, tool approval, settings) — separate from Notification, broader coverage |
| `PostToolUseFailure` | `waitingForInput` (conditional) | **NEW:** Only when `is_interrupt: true` — Stop hooks don't fire on interrupts, so this is the only hook signal for "What should Claude do instead?" |
| `SubagentStart` | `busy` | Subagent spawned |
| `SubagentStop` | `busy` | Subagent finished |
| `TaskCreated` | `busy` | Task spawned |
| `TaskCompleted` | `busy` | Task done |
| `StopFailure` | `idle` | API error, treat same as Stop |

### 2. Frontend `waitingForInput` sticky flag (`sessionManager.ts`)

Added `waitingForInput: boolean` to `ManagedSession`. Mirrors the Rust detector's sticky flag:

- **Set** when any source (hook or detector) transitions to `waitingForInput`
- **Cleared** when user provides input (keyboard `onData`, send-to-claude, remote control)
- **Effect**: `hookAgentState` handler rejects "busy" while flag is set, preventing late hook race conditions

### 3. Expanded detector patterns (`agent_detector.rs`)

Added catch-all patterns for Claude Code prompts the detector was missing:

| Pattern | Catches |
|---------|---------|
| `"What should Claude do"` | Interrupt prompt after tool cancellation |
| `"Esc to cancel"` | Universal navigation hint on virtually all Claude Code input prompts |
| `"Tab to amend"` | Prompt edit hint |

These are safety-net patterns — hooks are the primary signal. The detector only fires when hooks don't cover a scenario.

### 4. Test scenarios (`status-scenarios.json`)

Added 4 new scenarios:
- `interrupt-prompt-what-should-claude-do` — user interrupts running command
- `esc-to-cancel-prompt` — file creation prompt with Esc to cancel hint
- `late-hook-busy-after-waiting-for-input` — hook race condition: busy arriving after detector sets waitingForInput
- Frontend test runner updated to track `waitingForInput` flag

## Architecture: Signal Priority

```
Hook signals (authoritative when active):
  hookAgentState → session.agentState
  EXCEPT: "busy" blocked while session.waitingForInput is set

Detector signals (safety net):
  agentState → filtered by shouldAcceptDetectorState()
  When hooks active: only idle, waitingForInput, notRunning accepted
  When hooks inactive: all states accepted

User input (flag reset):
  term.onData / writePty → session.waitingForInput = false
```

## Files touched

1. `src-tauri/src/pty_manager.rs` — add PermissionRequest + PostToolUseFailure hooks
2. `src-tauri/src/agent_detector.rs` — add interrupt, Esc to cancel, Tab to amend patterns
3. `src/services/sessionManager.ts` — add `waitingForInput` flag + hookAgentState guard (both channel handlers)
4. `src/hooks/usePty.ts` — clear flag on keyboard input
5. `src/hooks/useSendToClaude.ts` — clear flag on send-to-claude
6. `src/services/remoteControl.ts` — clear flag on remote control input
7. `src/test/status-scenarios.json` — 4 new scenarios
8. `src/test/status-scenarios.test.ts` — runner tracks waitingForInput flag

## Future work (not in scope)

- Output-recency detection layer for universal agent support (Codex, Aider)
- `tcgetpgrp()` polling as process-level fallback
- OSC 133 shell integration handler (blocked on Claude Code upstream support)
- HTTP hook type for PostToolUseFailure (eliminate shell grep, parse JSON server-side)
