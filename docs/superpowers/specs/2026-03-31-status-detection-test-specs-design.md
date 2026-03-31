# Status Detection Test Specs

## Problem

Agent status detection bugs keep recurring — stuck busy, wrong status on worktree focus, missed waitingForInput prompts. The Rust detector has 28 unit tests but they're single-pattern, and the frontend status logic (useAgentItemState, sessionManager priority) has zero tests. Cross-layer bugs slip through because neither layer is tested against realistic multi-step scenarios.

## Approach

Unit tests at each layer + shared contract scenarios that both layers are tested against.

### Shared Scenario Format

Scenarios live in `src/test/status-scenarios.json` — a set of step-by-step agent session simulations consumed by both Rust and frontend test suites.

```typescript
interface StatusScenario {
  name: string;
  description: string;
  category: "stuck-busy" | "wrong-status-on-focus" | "missed-waiting-for-input";
  steps: ScenarioStep[];
}

interface ScenarioStep {
  action:
    | { type: "ptyOutput"; data: string }
    | { type: "hookEvent"; state: AgentState }
    | { type: "userInput" }
    | { type: "elapsed"; ms: number }
    | { type: "heartbeat" }
    | { type: "noHeartbeat"; ms: number };
  expect: {
    agentStatus: AgentState;
    effectiveStatus?: string;  // "done" | "stale" | "disconnected" | AgentState
    staleBusy?: boolean;
  };
}
```

## Section 1: Rust Detector Tests

### Scenario runner

A test helper that plays scenarios against `AgentDetector`:
- `ptyOutput` → `detector.feed(data.as_bytes())`
- `userInput` → `detector.notify_input_at(Instant::now())`
- `elapsed` → advance internal timestamps (idle cooldown, echo suppression)
- `hookEvent` → skipped (hooks are frontend concern)
- After each step, assert `detector.state()` matches `expect.agentStatus`

The scenario file is loaded via `include_str!("../../src/test/status-scenarios.json")`.

### Existing tests

The 28 existing single-pattern tests remain unchanged. The scenario runner adds coverage on top.

## Section 2: Frontend Test Infrastructure

### Vitest setup

- Add `vitest` and `@testing-library/react` as dev dependencies
- `vitest.config.ts` extending `vite.config.ts` with test settings
- Path aliases matching `tsconfig.json` (`@/` alias)
- Global mock for `@tauri-apps/api` (not available in test environment)

### What we test

**A) `computeEffectiveStatus` (extracted from `useAgentItemState`)**

Extract the pure status computation from `useAgentItemState` in `AgentItem.tsx` into a standalone function. Test cases:

| agentStatus | channelAlive | staleBusy | isSeen | → effectiveStatus |
|---|---|---|---|---|
| busy | true | false | — | busy |
| busy | true | true | — | stale |
| idle | true | false | false | done |
| idle | true | false | true | idle |
| busy | false | — | — | disconnected |
| notRunning | false | — | — | notRunning |
| waitingForInput | true | false | — | waitingForInput |

**B) sessionManager hook/detector priority**

Extract the event dispatch decision logic into a testable function. Test cases:

| hooksActive | event source | event state | waitingForInput flag | → accepted? |
|---|---|---|---|---|
| false | detector | busy | false | yes |
| true | detector | busy | false | **no** (hooks authoritative) |
| true | detector | idle | false | yes (safety net) |
| true | detector | waitingForInput | false | yes (safety net) |
| true | detector | notRunning | false | yes (safety net) |
| true | hook | waitingForInput | false | yes (sets flag) |
| true | hook | busy | false | yes |
| true | hook | busy | **true** | **no** (late hook blocked by sticky flag) |
| true | hook | idle | true | yes (clears flag) |

**C) staleBusy computation**

Extract from `usePty.ts` polling logic into a pure function. Test cases:

| agentStatus | channelAlive | lastOutputAge | → staleBusy |
|---|---|---|---|
| busy | true | 5s | false |
| busy | true | 31s | true |
| idle | true | 31s | false |
| busy | false | 31s | false |

**D) Scenario runner**

Plays `status-scenarios.json` against a lightweight mock of the sessionManager event dispatch + effectiveStatus computation. Tracks `waitingForInput` sticky flag to validate race condition protection:
- `hookEvent` → dispatch as hookAgentState (blocked if "busy" and `waitingForInput` flag set)
- `ptyOutput` → dispatch as agentState (simulating detector, sets/clears `waitingForInput` flag)
- `userInput` → clears `waitingForInput` flag
- `elapsed` → advance lastOutputAt / lastHeartbeat timestamps
- `noHeartbeat` → set channelAlive false
- After each step, check agentStatus and effectiveStatus match expectations

## Section 3: Scenario Catalog (14 scenarios)

### Stuck busy

1. **Skill completes, idle prompt arrives** — agent runs tool, outputs result lines, then `❯` prompt. Expect: busy → busy → idle
2. **Skill with AskUserQuestion** — agent outputs question + options + "Enter to select", user answers, agent resumes. Expect: busy → waitingForInput → busy → idle
3. **Stop hook fires but detector misses idle** — hook sends idle, detector still sees output lines. Expect: idle wins

### Missed waitingForInput

4. **Permission prompt (Allow/Deny)** — standard tool approval. Expect: waitingForInput
5. **Elicitation dialog (Enter to select)** — numbered options with navigation hint. Expect: waitingForInput
6. **Confirmation prompt (y/n)** — simple yes/no. Expect: waitingForInput
7. **Multi-batch elicitation** — question in batch 1, options in batch 2, navigation hint in batch 3. Expect: stays waitingForInput throughout, not flipped to busy by option lines
8. **Interrupt prompt** — user interrupts running command, Claude shows "What should Claude do instead?". Expect: waitingForInput
9. **Esc to cancel prompt** — file creation prompt with "Esc to cancel" navigation hint. Expect: waitingForInput
10. **Late hook busy after waitingForInput** — hook race condition: detector sets waitingForInput, then a delayed PreToolUse "busy" hook arrives. Expect: stays waitingForInput (blocked by sticky flag)

### Wrong status on focus

11. **Switch to idle worktree unseen** — worktree finished while unfocused, user clicks it. Expect: effectiveStatus was "done", becomes "idle" after marking seen
12. **Switch to stale worktree** — worktree busy with no output for 31s, user clicks. Expect: effectiveStatus "stale", then hook/detector resolves to actual state
13. **Channel dead during focus switch** — heartbeat missed while on different worktree. Expect: "disconnected", not "busy"

## Refactoring Required

Three small extractions to make the frontend logic testable:

1. **`computeEffectiveStatus(worktree, isSeen)`** — extract from `useAgentItemState` in `AgentItem.tsx`. The hook calls this function; tests call it directly.
2. **`shouldAcceptDetectorState(hooksActive, detectorState)`** — extract from the `case "agentState"` handler in `sessionManager.ts`. Returns boolean.
3. **`computeStaleBusy(agentStatus, channelAlive, lastOutputAt, now)`** — extract from the `usePty.ts` polling interval. Returns boolean.

These are mechanical extractions — no behaviour change, just making existing logic importable.

## File Structure

```
src/test/
  status-scenarios.json          # shared scenario definitions
  status-scenarios.ts            # TypeScript types for scenarios

src/components/sidebar/
  AgentItem.tsx                  # extract computeEffectiveStatus
  AgentItem.test.ts              # effectiveStatus unit tests

src/services/
  sessionManager.ts              # extract shouldAcceptDetectorState
  sessionManager.test.ts         # priority logic unit tests

src/hooks/
  usePty.ts                      # extract computeStaleBusy
  usePty.test.ts                 # staleBusy unit tests

src/test/
  status-scenarios.test.ts       # frontend scenario runner

src-tauri/src/
  agent_detector.rs              # scenario runner + existing tests
```

## Out of Scope

- E2E tests (Playwright/Cypress) — too heavy for this, unit + contract tests cover the logic
- Testing the actual Tauri channel/IPC — mocked at the boundary
- Testing terminal rendering or xterm.js behaviour
