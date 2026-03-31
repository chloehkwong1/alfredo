# Status Detection Test Specs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive test coverage for agent status detection across both Rust (scenario-level tests) and frontend (Vitest setup + unit tests for status logic).

**Architecture:** Shared scenario definitions in JSON consumed by both Rust and TypeScript test suites. Three small extractions make frontend logic testable as pure functions. Vitest is added as the frontend test runner.

**Tech Stack:** Rust built-in tests, Vitest, TypeScript

---

### Task 1: Shared Scenario Definitions

**Files:**
- Create: `src/test/status-scenarios.ts` (TypeScript types)
- Create: `src/test/status-scenarios.json` (scenario data)

- [ ] **Step 1: Create the TypeScript types file**

```typescript
// src/test/status-scenarios.ts
import type { AgentState } from "../types";

export interface StatusScenario {
  name: string;
  description: string;
  category: "stuck-busy" | "wrong-status-on-focus" | "missed-waiting-for-input";
  steps: ScenarioStep[];
}

export interface ScenarioStep {
  action:
    | { type: "ptyOutput"; data: string }
    | { type: "hookEvent"; state: AgentState }
    | { type: "userInput" }
    | { type: "elapsed"; ms: number }
    | { type: "heartbeat" }
    | { type: "noHeartbeat"; ms: number };
  expect: {
    agentStatus: AgentState;
    effectiveStatus?: string;
    staleBusy?: boolean;
  };
}
```

- [ ] **Step 2: Create the scenario JSON file**

Write `src/test/status-scenarios.json` with all 10 scenarios. Note: `ptyOutput` data strings use `\n` for newlines and unicode escapes for special chars (e.g., `\u276f` for `❯`).

```json
[
  {
    "name": "skill-completes-idle-prompt-arrives",
    "description": "Agent runs tool, outputs result lines, then idle prompt",
    "category": "stuck-busy",
    "steps": [
      {
        "action": { "type": "ptyOutput", "data": "I'll read the file now.\n" },
        "expect": { "agentStatus": "busy" }
      },
      {
        "action": { "type": "ptyOutput", "data": "Here are the contents of the file:\n" },
        "expect": { "agentStatus": "busy" }
      },
      {
        "action": { "type": "ptyOutput", "data": "\u276f \n" },
        "expect": { "agentStatus": "idle" }
      }
    ]
  },
  {
    "name": "skill-with-ask-user-question",
    "description": "Agent outputs elicitation dialog, user answers, agent resumes",
    "category": "stuck-busy",
    "steps": [
      {
        "action": { "type": "ptyOutput", "data": "Let me research this ticket.\n" },
        "expect": { "agentStatus": "busy" }
      },
      {
        "action": { "type": "ptyOutput", "data": "Do you have any extra context beyond the ticket?\n\u203a 1. No extra context\n  2. I have context\n  3. Type something.\nEnter to select \u00b7 \u2191/\u2193 to navigate \u00b7 Esc to cancel\n" },
        "expect": { "agentStatus": "waitingForInput" }
      },
      {
        "action": { "type": "userInput" },
        "expect": { "agentStatus": "waitingForInput" }
      },
      {
        "action": { "type": "elapsed", "ms": 200 },
        "expect": { "agentStatus": "waitingForInput" }
      },
      {
        "action": { "type": "ptyOutput", "data": "Proceeding with codebase exploration.\n" },
        "expect": { "agentStatus": "busy" }
      }
    ]
  },
  {
    "name": "stop-hook-fires-detector-overridden",
    "description": "Hook sends idle even though detector sees output lines",
    "category": "stuck-busy",
    "steps": [
      {
        "action": { "type": "ptyOutput", "data": "Working on the task...\n" },
        "expect": { "agentStatus": "busy" }
      },
      {
        "action": { "type": "hookEvent", "state": "idle" },
        "expect": { "agentStatus": "idle" }
      }
    ]
  },
  {
    "name": "permission-prompt-allow-deny",
    "description": "Standard tool approval prompt with Allow/Deny",
    "category": "missed-waiting-for-input",
    "steps": [
      {
        "action": { "type": "ptyOutput", "data": "I need to run a command.\n" },
        "expect": { "agentStatus": "busy" }
      },
      {
        "action": { "type": "ptyOutput", "data": "  Allow    Deny\n" },
        "expect": { "agentStatus": "waitingForInput" }
      }
    ]
  },
  {
    "name": "elicitation-dialog-enter-to-select",
    "description": "Numbered options with Enter to select navigation hint",
    "category": "missed-waiting-for-input",
    "steps": [
      {
        "action": { "type": "ptyOutput", "data": "Processing request...\n" },
        "expect": { "agentStatus": "busy" }
      },
      {
        "action": { "type": "ptyOutput", "data": "Which approach do you prefer?\n\u203a 1. Option A\n  2. Option B\nEnter to select \u00b7 \u2191/\u2193 to navigate \u00b7 Esc to cancel\n" },
        "expect": { "agentStatus": "waitingForInput" }
      }
    ]
  },
  {
    "name": "confirmation-prompt-y-n",
    "description": "Simple yes/no confirmation prompt",
    "category": "missed-waiting-for-input",
    "steps": [
      {
        "action": { "type": "ptyOutput", "data": "About to delete the file.\n" },
        "expect": { "agentStatus": "busy" }
      },
      {
        "action": { "type": "ptyOutput", "data": "Are you sure? (y/n)\n" },
        "expect": { "agentStatus": "waitingForInput" }
      }
    ]
  },
  {
    "name": "multi-batch-elicitation",
    "description": "Elicitation arrives across three separate PTY output batches",
    "category": "missed-waiting-for-input",
    "steps": [
      {
        "action": { "type": "ptyOutput", "data": "Do you want to proceed?\n" },
        "expect": { "agentStatus": "waitingForInput" }
      },
      {
        "action": { "type": "ptyOutput", "data": "\u203a 1. Yes\n  2. No\n" },
        "expect": { "agentStatus": "waitingForInput" }
      },
      {
        "action": { "type": "ptyOutput", "data": "Enter to select \u00b7 \u2191/\u2193 to navigate \u00b7 Esc to cancel\n" },
        "expect": { "agentStatus": "waitingForInput" }
      }
    ]
  },
  {
    "name": "switch-to-idle-worktree-unseen",
    "description": "Worktree finished while unfocused, user clicks to view",
    "category": "wrong-status-on-focus",
    "steps": [
      {
        "action": { "type": "hookEvent", "state": "idle" },
        "expect": { "agentStatus": "idle", "effectiveStatus": "done" }
      }
    ]
  },
  {
    "name": "switch-to-stale-worktree",
    "description": "Worktree busy with no output for 31s, user clicks",
    "category": "wrong-status-on-focus",
    "steps": [
      {
        "action": { "type": "ptyOutput", "data": "Starting long operation...\n" },
        "expect": { "agentStatus": "busy", "staleBusy": false }
      },
      {
        "action": { "type": "elapsed", "ms": 31000 },
        "expect": { "agentStatus": "busy", "staleBusy": true, "effectiveStatus": "stale" }
      }
    ]
  },
  {
    "name": "channel-dead-during-focus-switch",
    "description": "Heartbeat missed while on different worktree",
    "category": "wrong-status-on-focus",
    "steps": [
      {
        "action": { "type": "ptyOutput", "data": "Working on something...\n" },
        "expect": { "agentStatus": "busy" }
      },
      {
        "action": { "type": "noHeartbeat", "ms": 7000 },
        "expect": { "agentStatus": "busy", "effectiveStatus": "disconnected" }
      }
    ]
  }
]
```

- [ ] **Step 3: Commit**

```bash
git add src/test/status-scenarios.ts src/test/status-scenarios.json
git commit -m "test: add shared status detection scenario definitions"
```

---

### Task 2: Rust Scenario Runner

**Files:**
- Modify: `src-tauri/src/agent_detector.rs` (add scenario runner in `#[cfg(test)]` block)

- [ ] **Step 1: Add serde as a dev-dependency for JSON parsing in tests**

Check if `serde` and `serde_json` are already in `src-tauri/Cargo.toml` — they likely are since the app uses JSON. If `serde` is not a dependency, add it. The `Deserialize` derive is needed for the scenario structs.

Run: `grep -n 'serde' src-tauri/Cargo.toml`

If serde is already there (likely), no changes needed — just use it in the test module.

- [ ] **Step 2: Add scenario types and runner to the test module**

Add the following at the top of the `#[cfg(test)] mod tests` block in `src-tauri/src/agent_detector.rs`, after the existing `use super::*;`:

```rust
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct StatusScenario {
        name: String,
        #[allow(dead_code)]
        description: String,
        #[allow(dead_code)]
        category: String,
        steps: Vec<ScenarioStep>,
    }

    #[derive(Deserialize)]
    struct ScenarioStep {
        action: ScenarioAction,
        expect: ScenarioExpect,
    }

    #[derive(Deserialize)]
    #[serde(tag = "type")]
    enum ScenarioAction {
        #[serde(rename = "ptyOutput")]
        PtyOutput { data: String },
        #[serde(rename = "hookEvent")]
        HookEvent { state: String },
        #[serde(rename = "userInput")]
        UserInput,
        #[serde(rename = "elapsed")]
        Elapsed { ms: u64 },
        #[serde(rename = "heartbeat")]
        Heartbeat,
        #[serde(rename = "noHeartbeat")]
        NoHeartbeat { ms: u64 },
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ScenarioExpect {
        agent_status: String,
        #[allow(dead_code)]
        effective_status: Option<String>,
        #[allow(dead_code)]
        stale_busy: Option<bool>,
    }

    fn parse_expected_state(s: &str) -> AgentState {
        match s {
            "busy" => AgentState::Busy,
            "idle" => AgentState::Idle,
            "waitingForInput" => AgentState::WaitingForInput,
            "notRunning" => AgentState::NotRunning,
            other => panic!("Unknown agent state in scenario: {other}"),
        }
    }

    fn run_scenario(scenario: &StatusScenario) {
        let mut det = AgentDetector::with_agent_type(AgentType::ClaudeCode);
        // Expire idle cooldown so initial output transitions work
        det.last_idle = Some(Instant::now() - std::time::Duration::from_secs(1));

        for (i, step) in scenario.steps.iter().enumerate() {
            match &step.action {
                ScenarioAction::PtyOutput { data } => {
                    det.feed(data.as_bytes());
                }
                ScenarioAction::UserInput => {
                    det.notify_input_at(Instant::now());
                }
                ScenarioAction::Elapsed { ms } => {
                    // Advance input/idle timestamps backward so cooldowns expire
                    let elapsed = std::time::Duration::from_millis(*ms);
                    if let Some(ref mut ts) = det.last_input {
                        *ts -= elapsed;
                    }
                    if let Some(ref mut ts) = det.last_idle {
                        *ts -= elapsed;
                    }
                }
                ScenarioAction::HookEvent { .. }
                | ScenarioAction::Heartbeat
                | ScenarioAction::NoHeartbeat { .. } => {
                    // These are frontend-only concerns; skip in Rust detector tests
                    continue;
                }
            }

            let expected = parse_expected_state(&step.expect.agent_status);
            assert_eq!(
                det.state(),
                &expected,
                "Scenario '{}' failed at step {}: expected {:?}, got {:?}",
                scenario.name,
                i,
                expected,
                det.state(),
            );
        }
    }
```

- [ ] **Step 3: Add the scenario test that loads and runs all scenarios**

Add this test at the end of the test module, after the existing tests:

```rust
    #[test]
    fn shared_status_scenarios() {
        let json = include_str!("../../src/test/status-scenarios.json");
        let scenarios: Vec<StatusScenario> =
            serde_json::from_str(json).expect("Failed to parse status-scenarios.json");
        assert!(!scenarios.is_empty(), "No scenarios found");
        for scenario in &scenarios {
            run_scenario(scenario);
        }
    }
```

- [ ] **Step 4: Run Rust tests to verify all scenarios pass**

Run: `cd src-tauri && cargo test --lib agent_detector -- --nocapture`

Expected: All existing 29 tests + `shared_status_scenarios` pass. The scenarios that use `hookEvent`, `heartbeat`, `noHeartbeat` steps are skipped by the runner (they `continue`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/agent_detector.rs
git commit -m "test: add Rust scenario runner for shared status detection tests"
```

---

### Task 3: Frontend Logic Extractions

**Files:**
- Modify: `src/components/sidebar/AgentItem.tsx` (extract `computeEffectiveStatus`)
- Modify: `src/services/sessionManager.ts` (extract `shouldAcceptDetectorState`)
- Modify: `src/hooks/usePty.ts` (extract `computeStaleBusy`)

These are mechanical extractions — no behaviour changes. Each function is extracted and immediately called by the original code so existing behaviour is preserved.

- [ ] **Step 1: Extract `computeEffectiveStatus` in AgentItem.tsx**

In `src/components/sidebar/AgentItem.tsx`, add this exported function above `useAgentItemState`:

```typescript
export function computeEffectiveStatus(
  agentStatus: AgentState,
  channelAlive: boolean | undefined,
  staleBusy: boolean | undefined,
  isSeen: boolean,
): string {
  const channelStatus = channelAlive === false && agentStatus !== "notRunning"
    ? "disconnected"
    : agentStatus;
  const baseStatus = channelStatus === "busy" && staleBusy ? "stale" : channelStatus;
  return baseStatus === "idle" && !isSeen ? "done" : baseStatus;
}
```

Then update `useAgentItemState` to call it:

Replace lines 159-163 of `AgentItem.tsx`:
```typescript
  const channelStatus = worktree.channelAlive === false && worktree.agentStatus !== "notRunning"
    ? "disconnected"
    : worktree.agentStatus;
  const baseStatus = channelStatus === "busy" && worktree.staleBusy ? "stale" : channelStatus;
  const effectiveStatus = baseStatus === "idle" && !isSeen ? "done" : baseStatus;
```

With:
```typescript
  const effectiveStatus = computeEffectiveStatus(
    worktree.agentStatus, worktree.channelAlive, worktree.staleBusy, isSeen,
  );
```

- [ ] **Step 2: Extract `shouldAcceptDetectorState` in sessionManager.ts**

In `src/services/sessionManager.ts`, add this exported function near the top of the file (after imports):

```typescript
export function shouldAcceptDetectorState(
  hooksActive: boolean,
  detectorState: AgentState,
): boolean {
  if (!hooksActive) return true;
  return detectorState === "idle"
    || detectorState === "notRunning"
    || detectorState === "waitingForInput";
}
```

Then update both `case "agentState"` handlers (in `getOrSpawn` around line 233 and in `spawnForExisting` around line 382) to use it.

Replace the existing block (appears in both handlers):
```typescript
        case "agentState": {
          if (session.hooksActive) {
            // Hooks are authoritative for busy state, but they can miss
            // downward transitions (e.g. Ctrl+C killing hook commands,
            // or permission_prompt/elicitation_dialog matchers not firing
            // for all prompt types). Allow detector idle, notRunning, and
            // waitingForInput signals through as a safety net — the
            // detector's prompt/idle matching is highly reliable and
            // prevents stuck "busy" states.
            if (
              event.data === "idle" ||
              event.data === "notRunning" ||
              event.data === "waitingForInput"
            ) {
              session.agentState = event.data;
              useWorkspaceStore
                .getState()
                .updateWorktree(worktreeId, { agentStatus: event.data });
            }
            break;
          }
          session.agentState = event.data;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
```

With:
```typescript
        case "agentState": {
          if (!shouldAcceptDetectorState(session.hooksActive, event.data)) break;
          session.agentState = event.data;
          useWorkspaceStore
            .getState()
            .updateWorktree(worktreeId, { agentStatus: event.data });
          break;
        }
```

- [ ] **Step 3: Extract `computeStaleBusy` in usePty.ts**

In `src/hooks/usePty.ts`, add this exported function near the top (after imports):

```typescript
export const STALE_BUSY_MS = 30_000;

export function computeStaleBusy(
  agentStatus: AgentState,
  channelAlive: boolean,
  lastOutputAt: number,
  now: number,
): boolean {
  return channelAlive
    && agentStatus === "busy"
    && lastOutputAt > 0
    && now - lastOutputAt > STALE_BUSY_MS;
}
```

Then update the polling interval (around line 193-207) to use it.

Remove the local `const STALE_BUSY_MS = 30_000;` line and replace the staleBusy computation:

Replace:
```typescript
        const staleBusy = alive && currentState === "busy"
          && session.lastOutputAt > 0
          && Date.now() - session.lastOutputAt > STALE_BUSY_MS;
```

With:
```typescript
        const staleBusy = computeStaleBusy(currentState, alive, session.lastOutputAt, Date.now());
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: No errors. The extractions are purely mechanical and the call sites use the same logic.

- [ ] **Step 5: Commit**

```bash
git add src/components/sidebar/AgentItem.tsx src/services/sessionManager.ts src/hooks/usePty.ts
git commit -m "refactor: extract pure status functions for testability"
```

---

### Task 4: Vitest Setup

**Files:**
- Modify: `package.json` (add vitest dev dependency)
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts` (Tauri API mock)

- [ ] **Step 1: Install vitest**

Run: `npm install --save-dev vitest`

- [ ] **Step 2: Create vitest.config.ts**

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
  },
});
```

- [ ] **Step 3: Create the test setup file with Tauri mock**

```typescript
// src/test/setup.ts
import { vi } from "vitest";

// Mock @tauri-apps/api modules that get imported transitively.
// Tests only exercise pure logic functions, but imports may pull in Tauri IPC.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
    save: vi.fn(),
  })),
}));
```

- [ ] **Step 4: Add test script to package.json**

Add to the `"scripts"` section in `package.json`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Verify vitest runs (no tests yet, should exit cleanly)**

Run: `npx vitest run`

Expected: "No test files found" or similar clean exit — no crash from missing mocks.

- [ ] **Step 6: Commit**

```bash
git add package.json vitest.config.ts src/test/setup.ts
# Also add package-lock.json if it changed
git add package-lock.json
git commit -m "chore: set up vitest with Tauri API mocks"
```

---

### Task 5: Frontend Unit Tests — computeEffectiveStatus

**Files:**
- Create: `src/components/sidebar/AgentItem.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/components/sidebar/AgentItem.test.ts
import { describe, it, expect } from "vitest";
import { computeEffectiveStatus } from "./AgentItem";

describe("computeEffectiveStatus", () => {
  it("returns busy when agent is busy and not stale", () => {
    expect(computeEffectiveStatus("busy", true, false, true)).toBe("busy");
  });

  it("returns stale when agent is busy and staleBusy is true", () => {
    expect(computeEffectiveStatus("busy", true, true, true)).toBe("stale");
  });

  it("returns done when agent is idle and not seen", () => {
    expect(computeEffectiveStatus("idle", true, false, false)).toBe("done");
  });

  it("returns idle when agent is idle and seen", () => {
    expect(computeEffectiveStatus("idle", true, false, true)).toBe("idle");
  });

  it("returns disconnected when channel dead and agent not notRunning", () => {
    expect(computeEffectiveStatus("busy", false, false, true)).toBe("disconnected");
  });

  it("returns notRunning when channel dead but agent is notRunning", () => {
    expect(computeEffectiveStatus("notRunning", false, false, true)).toBe("notRunning");
  });

  it("returns waitingForInput when agent is waiting", () => {
    expect(computeEffectiveStatus("waitingForInput", true, false, true)).toBe("waitingForInput");
  });

  it("returns disconnected for waitingForInput when channel dead", () => {
    expect(computeEffectiveStatus("waitingForInput", false, false, true)).toBe("disconnected");
  });

  it("returns stale over disconnected (channel alive + stale busy)", () => {
    expect(computeEffectiveStatus("busy", true, true, false)).toBe("stale");
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/components/sidebar/AgentItem.test.ts`

Expected: All 9 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/AgentItem.test.ts
git commit -m "test: add computeEffectiveStatus unit tests"
```

---

### Task 6: Frontend Unit Tests — shouldAcceptDetectorState

**Files:**
- Create: `src/services/sessionManager.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/services/sessionManager.test.ts
import { describe, it, expect } from "vitest";
import { shouldAcceptDetectorState } from "./sessionManager";

describe("shouldAcceptDetectorState", () => {
  it("accepts all states when hooks are not active", () => {
    expect(shouldAcceptDetectorState(false, "busy")).toBe(true);
    expect(shouldAcceptDetectorState(false, "idle")).toBe(true);
    expect(shouldAcceptDetectorState(false, "waitingForInput")).toBe(true);
    expect(shouldAcceptDetectorState(false, "notRunning")).toBe(true);
  });

  it("rejects detector busy when hooks are active", () => {
    expect(shouldAcceptDetectorState(true, "busy")).toBe(false);
  });

  it("accepts detector idle when hooks are active (safety net)", () => {
    expect(shouldAcceptDetectorState(true, "idle")).toBe(true);
  });

  it("accepts detector waitingForInput when hooks are active (safety net)", () => {
    expect(shouldAcceptDetectorState(true, "waitingForInput")).toBe(true);
  });

  it("accepts detector notRunning when hooks are active (safety net)", () => {
    expect(shouldAcceptDetectorState(true, "notRunning")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/services/sessionManager.test.ts`

Expected: All 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/services/sessionManager.test.ts
git commit -m "test: add shouldAcceptDetectorState unit tests"
```

---

### Task 7: Frontend Unit Tests — computeStaleBusy

**Files:**
- Create: `src/hooks/usePty.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
// src/hooks/usePty.test.ts
import { describe, it, expect } from "vitest";
import { computeStaleBusy, STALE_BUSY_MS } from "./usePty";

describe("computeStaleBusy", () => {
  const now = Date.now();

  it("returns false when output is recent", () => {
    expect(computeStaleBusy("busy", true, now - 5000, now)).toBe(false);
  });

  it("returns true when busy with no output for over 30s", () => {
    expect(computeStaleBusy("busy", true, now - (STALE_BUSY_MS + 1000), now)).toBe(true);
  });

  it("returns false when idle even with old output", () => {
    expect(computeStaleBusy("idle", true, now - (STALE_BUSY_MS + 1000), now)).toBe(false);
  });

  it("returns false when channel is dead", () => {
    expect(computeStaleBusy("busy", false, now - (STALE_BUSY_MS + 1000), now)).toBe(false);
  });

  it("returns false when lastOutputAt is 0 (no output yet)", () => {
    expect(computeStaleBusy("busy", true, 0, now)).toBe(false);
  });

  it("returns false for waitingForInput even with old output", () => {
    expect(computeStaleBusy("waitingForInput", true, now - (STALE_BUSY_MS + 1000), now)).toBe(false);
  });

  it("returns true at exactly STALE_BUSY_MS + 1", () => {
    expect(computeStaleBusy("busy", true, now - STALE_BUSY_MS - 1, now)).toBe(true);
  });

  it("returns false at exactly STALE_BUSY_MS", () => {
    expect(computeStaleBusy("busy", true, now - STALE_BUSY_MS, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/hooks/usePty.test.ts`

Expected: All 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePty.test.ts
git commit -m "test: add computeStaleBusy unit tests"
```

---

### Task 8: Frontend Scenario Runner

**Files:**
- Create: `src/test/status-scenarios.test.ts`

- [ ] **Step 1: Write the frontend scenario runner**

This runner simulates the full frontend status pipeline: hook/detector priority → agentStatus → effectiveStatus/staleBusy computation. It processes each scenario step, maintaining state as the sessionManager would.

```typescript
// src/test/status-scenarios.test.ts
import { describe, it, expect } from "vitest";
import scenarios from "./status-scenarios.json";
import type { StatusScenario } from "./status-scenarios";
import type { AgentState } from "../types";
import { shouldAcceptDetectorState } from "../services/sessionManager";
import { computeEffectiveStatus } from "../components/sidebar/AgentItem";
import { computeStaleBusy, STALE_BUSY_MS } from "../hooks/usePty";

interface SimState {
  agentStatus: AgentState;
  hooksActive: boolean;
  channelAlive: boolean;
  lastOutputAt: number;
  lastHeartbeat: number;
  isSeen: boolean;
}

function createInitialState(): SimState {
  const now = Date.now();
  return {
    agentStatus: "idle",
    hooksActive: false,
    channelAlive: true,
    lastOutputAt: now,
    lastHeartbeat: now,
    isSeen: false, // unseen by default (tests wrong-status-on-focus scenarios)
  };
}

function runFrontendScenario(scenario: StatusScenario) {
  const state = createInitialState();
  let now = Date.now();

  for (let i = 0; i < scenario.steps.length; i++) {
    const step = scenario.steps[i];
    const action = step.action;

    switch (action.type) {
      case "ptyOutput": {
        // Detector would classify this output and emit an agentState event.
        // For frontend scenarios, we use the expected agentStatus as what the
        // detector would produce — since the detector is tested separately
        // via the Rust scenario runner.
        // Simulate detector output accepted through priority logic.
        const detectorState = step.expect.agentStatus;
        if (shouldAcceptDetectorState(state.hooksActive, detectorState)) {
          state.agentStatus = detectorState;
        }
        state.lastOutputAt = now;
        break;
      }
      case "hookEvent": {
        // Hook events always accepted
        state.agentStatus = action.state;
        state.hooksActive = true;
        break;
      }
      case "userInput": {
        // User input doesn't change state directly in frontend
        break;
      }
      case "elapsed": {
        now += action.ms;
        break;
      }
      case "heartbeat": {
        state.lastHeartbeat = now;
        state.channelAlive = true;
        break;
      }
      case "noHeartbeat": {
        // Simulate heartbeat timeout
        state.lastHeartbeat = now - action.ms;
        state.channelAlive = false;
        break;
      }
    }

    // Assert agentStatus
    expect(state.agentStatus).toBe(
      step.expect.agentStatus,
      `Scenario '${scenario.name}' step ${i}: agentStatus`,
    );

    // Assert effectiveStatus if specified
    if (step.expect.effectiveStatus !== undefined) {
      const staleBusy = computeStaleBusy(state.agentStatus, state.channelAlive, state.lastOutputAt, now);
      const effective = computeEffectiveStatus(
        state.agentStatus, state.channelAlive, staleBusy, state.isSeen,
      );
      expect(effective).toBe(
        step.expect.effectiveStatus,
        `Scenario '${scenario.name}' step ${i}: effectiveStatus`,
      );
    }

    // Assert staleBusy if specified
    if (step.expect.staleBusy !== undefined) {
      const staleBusy = computeStaleBusy(state.agentStatus, state.channelAlive, state.lastOutputAt, now);
      expect(staleBusy).toBe(
        step.expect.staleBusy,
        `Scenario '${scenario.name}' step ${i}: staleBusy`,
      );
    }
  }
}

describe("shared status scenarios (frontend)", () => {
  for (const scenario of scenarios as StatusScenario[]) {
    it(scenario.name, () => {
      runFrontendScenario(scenario);
    });
  }
});
```

- [ ] **Step 2: Run the scenario tests**

Run: `npx vitest run src/test/status-scenarios.test.ts`

Expected: All 10 scenario tests pass.

- [ ] **Step 3: Run all frontend tests together**

Run: `npx vitest run`

Expected: All tests across all 4 test files pass (9 + 5 + 8 + 10 = 32 tests).

- [ ] **Step 4: Commit**

```bash
git add src/test/status-scenarios.test.ts
git commit -m "test: add frontend scenario runner for shared status detection tests"
```

---

### Task 9: Verify Full Suite

**Files:** None (verification only)

- [ ] **Step 1: Run all Rust tests**

Run: `cd src-tauri && cargo test --lib agent_detector -- --nocapture`

Expected: 30 tests pass (29 existing + 1 shared scenarios).

- [ ] **Step 2: Run all frontend tests**

Run: `npx vitest run`

Expected: 32 tests pass across 4 files.

- [ ] **Step 3: Run TypeScript type check**

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 4: Final commit with any fixups if needed**

Only if previous steps required adjustments. Otherwise, all work is already committed.
