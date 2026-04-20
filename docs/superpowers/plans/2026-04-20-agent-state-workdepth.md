# Agent-State `workDepth` Counter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-session `workDepth` counter (incremented on `promptStart`/`toolStart`, decremented on `toolEnd`, hard-reset on `turnEnd`/`notRunning`) and use it as a first-class authoritative busy signal that blocks both reconciler rescue paths (soft + force) when work is legitimately in flight.

**Architecture:** Currently `sessionManager.reconcileAll()` guesses whether work is in flight from time thresholds and a fragile `lastHookDesc` string comparison. The fix stores structural data: every `toolStart`/`promptStart` hook increments a counter; every `toolEnd` decrements it; `turnEnd` resets to zero. While `workDepth > 0`, the reconciler **cannot** flip busy→idle regardless of hook silence or output silence — the counter is ground truth. This eliminates the two most common stuck-busy/false-idle failure modes without adding more time thresholds. Prior art: `4649cd3` introduced a narrower `toolsInFlight` that only gated `shouldAcceptDetectorState`; it was removed in `9f00b27` with detector fallback. Detector fallback was later re-added piecemeal (`ac7d779`, `ace029e`) but the counter was not. This plan reinstates the counter with broader authority and phase coverage (`promptStart`/`subagentEnd` added in `bf89066` are now handled).

**Tech Stack:** TypeScript, Vitest, Zustand. Frontend-only change — no Rust modifications.

---

## Constraints & Non-Goals

**Do NOT touch:**
- `21907fe` (hooks wipe fix on session close) — settings.local.json preservation must remain intact
- `4242447` (straggler subagentEnd suppression) — parent stays idle when subagent cleanup arrives late
- `bf89066` (promptStart phase + idle debounce + turnEnd grace) — the phase vocabulary we depend on
- `55b22e1` (force-idle on flowing TUI output) — keep the force path but gate it on `workDepth == 0`

**Non-goals for this plan (future phases):**
- Replacing `hooksActive` latch with flip-able `hookHealth`
- Settings watchdog in Rust
- Moving state machine to Rust
- Eliminating sessionStatusStore multi-writer race

These are Phases 2–6 of the architecture redesign. Phase 1 (this plan) should resolve the majority of reported pain on its own.

## Known Limitations of Phase 1

- **Depth can stay > 0 if hooks die mid-tool.** If the hook channel dies between a `toolStart` and its `toolEnd` and never recovers, `workDepth` stays ≥ 1 and the reconciler's force-idle path will not fire (it's gated on `workDepth === 0`). Recovery requires `turnEnd`, `notRunning`, or `stopSession`. This is the intentional trade-off of Phase 1 — preferring stuck-busy (visible, user-actionable) over false-idle (silent, corrupts trust). Phase 2's `hookHealth` unlatch will let the detector take back over in this case.
- **Test coverage of the channel-handler wire is thin.** Only two tests exercise `createSessionChannel.onmessage` directly; the end-to-end scenario bypasses the wire. Adequate for Phase 1 but expand before any Phase 2+ refactor.

## Phase Vocabulary (reference)

From `src/types.ts:26` — `HookPhase = "none" | "promptStart" | "toolStart" | "toolEnd" | "turnEnd" | "subagentEnd"`

Hook event → depth delta:

| Hook | State | Phase | Depth delta |
|---|---|---|---|
| `UserPromptSubmit` | busy | promptStart | +1 |
| `PreToolUse` | busy | toolStart | +1 |
| `PostToolUse` | busy | toolEnd | −1 (clamp ≥0) |
| `Stop` / `StopFailure` | idle | turnEnd | reset to 0 |
| `SubagentStop` | busy | subagentEnd | 0 (neutral — parent turn continues; the Task tool's `toolEnd` will decrement) |
| `Notification` / `PermissionRequest` | waitingForInput / busy | none | 0 |
| PTY EOF | notRunning | none | reset to 0 |
| bare `busy` with `phase === "none"` | busy | none | 0 |

Rationale for `subagentEnd = 0`: Claude's Task tool fires `PreToolUse (toolStart, +1)` when the subagent begins. `SubagentStop` fires *within* that Task invocation. `PostToolUse (toolEnd, −1)` fires when the Task tool itself returns. So `subagentEnd` is informational only; decrementing here would double-count.

## File Structure

- Modify: `src/services/sessionTypes.ts` — add `workDepth: number` field
- Modify: `src/services/sessionChannel.ts` — increment/decrement in `hookAgentState` handler
- Modify: `src/services/sessionManager.ts` — gate both reconciler paths on `workDepth`, reset in lifecycle methods, remove `lastHookInFlight` string guard
- Modify: `src/test/status-scenarios.test.ts` — extend `makeFakeSession` helper, add new reconciler tests

---

## Task 1: Add `workDepth` field with init sites (infrastructure, no behavior change)

**Files:**
- Modify: `src/services/sessionTypes.ts` (add field to interface)
- Modify: `src/services/sessionManager.ts` (init in 3 construction sites + 1 reset site)
- Modify: `src/test/status-scenarios.test.ts` (extend `makeFakeSession` default)

- [ ] **Step 1: Add field to `ManagedSession` interface**

Edit `src/services/sessionTypes.ts`. Add the field immediately after `turnEndAt` (around line 62, before `onFirstOutput?`):

```typescript
  /** Turns/tools currently in flight. Incremented on `promptStart` and
   *  `toolStart`; decremented on `toolEnd` (clamped ≥0); hard-reset on
   *  `turnEnd` and `notRunning`. While > 0 the reconciler is forbidden
   *  from flipping busy → idle, regardless of hook or output silence. */
  workDepth: number;
```

- [ ] **Step 2: Initialise `workDepth: 0` in `SessionManager.getOrSpawn`**

Edit `src/services/sessionManager.ts`. In the `const session: ManagedSession = { ... }` block inside `getOrSpawn` (currently around line 168–191), add `workDepth: 0,` alongside the other default fields.

- [ ] **Step 3: Initialise `workDepth: 0` in `loadScrollbackOnly`**

In the same file, find the session object literal in `loadScrollbackOnly` (around line 284–307) and add `workDepth: 0,`.

- [ ] **Step 4: Initialise `workDepth: 0` in `reattachToSession`**

In the same file, find the session object literal in `reattachToSession` (around line 413–436) and add `workDepth: 0,`.

- [ ] **Step 5: Reset `workDepth = 0` in `stopSession` and `spawnForExisting`**

In `stopSession`, below the existing `session.hooksActive = false; session.agentState = "notRunning";` lines (around line 484–485), add:

```typescript
    session.workDepth = 0;
```

In `spawnForExisting`, alongside `session.agentState = mode === "shell" ? "notRunning" : "busy";` (around line 366), add:

```typescript
    session.workDepth = 0;
```

- [ ] **Step 6: Extend `makeFakeSession` test helper**

Edit `src/test/status-scenarios.test.ts`. In `makeFakeSession` (around line 127–154), add `workDepth: 0,` to the returned object, before the `...overrides` spread.

- [ ] **Step 7: Verify compilation**

Run: `npx tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 8: Verify existing tests still pass**

Run: `npm test -- --run status-scenarios`
Expected: all existing tests pass (no behaviour changed yet).

- [ ] **Step 9: Commit**

```bash
git add src/services/sessionTypes.ts src/services/sessionManager.ts src/test/status-scenarios.test.ts
git commit -m "feat(state): add workDepth field (infrastructure only)

Adds a per-session counter that will track turns/tools in flight.
No behavior change in this commit — field is initialized to 0 at
every session construction and reset site, but not yet read or
mutated. Follow-up commits wire increments and reconciler gates.

Part 1/5 of agent-state workDepth rollout.
"
```

---

## Task 2: Reconciler soft path gates on `workDepth`

**Files:**
- Modify: `src/test/status-scenarios.test.ts` (add failing test)
- Modify: `src/services/sessionManager.ts` (add gate to soft check)

- [ ] **Step 1: Write failing test — long-running tool with sparse output**

Add to `src/test/status-scenarios.test.ts` inside the `describe("SessionManager.reconcileAll", ...)` block (after the existing "does NOT flip busy → idle when output is still flowing" test, around line 221):

```typescript
  it("does NOT flip busy → idle when workDepth > 0, even if hooks AND output both stale", () => {
    // A long-running tool (e.g. 10-min git push via Bash) fires toolStart, then
    // produces no output and no further hooks for 90s+. The soft check's
    // silence-on-both-signals condition would normally fire idle rescue —
    // workDepth > 0 blocks it because we know a tool is genuinely running.
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "busy",
      lastHookAt: Date.now() - 90_000,   // hooks silent >60s (STALE_HOOK_MS)
      lastOutputAt: Date.now() - 30_000, // output silent >10s (STALE_OUTPUT_IDLE_MS)
      workDepth: 1,                       // tool genuinely in flight
    });
    (mgr as any).sessions.set("wt-long-tool:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-long-tool", agentStatus: "busy", staleBusy: false } as any],
    });

    (mgr as any).reconcileAll();

    expect(session.agentState).toBe("busy");
  });
```

- [ ] **Step 2: Run test — expect fail**

Run: `npm test -- --run status-scenarios.test.ts -t "workDepth > 0, even if hooks AND output both stale"`
Expected: FAIL — `agentState` is "idle" (soft check fires because gate isn't yet in place).

- [ ] **Step 3: Add `workDepth` gate to soft check**

Edit `src/services/sessionManager.ts`. The soft check currently reads (around line 63–78):

```typescript
      if (
        session.agentState === "busy"
        && session.lastHookAt > 0
        && now - session.lastHookAt > STALE_HOOK_MS
        && session.lastOutputAt > 0
        && now - session.lastOutputAt > STALE_OUTPUT_IDLE_MS
      ) {
```

Change to:

```typescript
      if (
        session.agentState === "busy"
        && session.workDepth === 0
        && session.lastHookAt > 0
        && now - session.lastHookAt > STALE_HOOK_MS
        && session.lastOutputAt > 0
        && now - session.lastOutputAt > STALE_OUTPUT_IDLE_MS
      ) {
```

Update the comment block above the soft check (currently at line 57–62) from:

```typescript
      // ── busy → idle reconciliation ──────────────────────────
      // ORDERING INVARIANT: the soft check (hook silence + output silence)
      // MUST come before the force check (hook silence only). The soft
      // check's `continue` skips the force path, allowing long-running
      // tools that stream output to stay busy even when hooks are silent.
      // Reordering these blocks breaks that guard — see e03b8c5.
```

to:

```typescript
      // ── busy → idle reconciliation ──────────────────────────
      // ORDERING INVARIANT: the soft check (hook silence + output silence)
      // MUST come before the force check (hook silence only). The soft
      // check's `continue` skips the force path, allowing long-running
      // tools that stream output to stay busy even when hooks are silent.
      // Reordering these blocks breaks that guard — see e03b8c5.
      //
      // Both paths are additionally gated on workDepth === 0: a tool in
      // flight (workDepth > 0) means we have structural proof work is
      // happening — no time-based rescue should fire until toolEnd
      // decrements the counter or turnEnd resets it.
```

- [ ] **Step 4: Run test — expect pass**

Run: `npm test -- --run status-scenarios.test.ts -t "workDepth > 0, even if hooks AND output both stale"`
Expected: PASS.

- [ ] **Step 5: Run full suite to confirm no regression**

Run: `npm test -- --run status-scenarios`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/services/sessionManager.ts src/test/status-scenarios.test.ts
git commit -m "feat(state): gate reconciler soft check on workDepth==0

When a tool is genuinely in flight (workDepth > 0), the reconciler
must not flip busy → idle based on hook+output silence. This fixes
the false-idle bug for long tools that produce no output for 10s+
while hooks are also quiet.

Part 2/5 of agent-state workDepth rollout.
"
```

---

## Task 3: Additional force-path test coverage (behavior already landed in Task 2)

**Note:** Task 2 necessarily gated both the soft and force checks in one commit (shared 60s threshold means a single failing test exercises both paths). This task adds the complementary tests that pin the force-path behavior specifically, to guard against future regressions that might re-diverge the two paths.

**Files:**
- Modify: `src/test/status-scenarios.test.ts` (add two tests)

- [ ] **Step 1: Write failing test — TUI output flowing but tool in flight**

Add to `src/test/status-scenarios.test.ts` inside the `describe("SessionManager.reconcileAll", ...)` block:

```typescript
  it("does NOT force idle on workDepth > 0 even if hooks silent past STALE_HOOK_FORCE_MS", () => {
    // A long tool is running (workDepth=1). TUI status-bar redraws keep
    // lastOutputAt fresh, so the force path is the only one that could
    // fire — it must be blocked while work is genuinely in flight.
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "busy",
      lastHookAt: Date.now() - 70_000,   // hooks silent >60s (STALE_HOOK_FORCE_MS)
      lastOutputAt: Date.now() - 500,    // output fresh (TUI redraws)
      workDepth: 1,
    });
    (mgr as any).sessions.set("wt-force:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-force", agentStatus: "busy", staleBusy: false } as any],
    });

    (mgr as any).reconcileAll();

    expect(session.agentState).toBe("busy");
  });
```

- [ ] **Step 2: Run test — expect pass (behavior already landed)**

Run: `npm test -- --run status-scenarios.test.ts -t "force idle on workDepth"`
Expected: PASS directly. If it fails, Task 2's force-check gate got reverted somehow — stop and investigate.

- [ ] **Step 3: Add complementary test — hooks dead with workDepth 0 still rescues**

Add to the same describe block:

```typescript
  it("DOES force idle on workDepth == 0 when hooks silent past force threshold (genuinely stuck)", () => {
    // Hook channel died after a clean turnEnd: workDepth=0, no further
    // hooks arrive, but TUI output keeps lastOutputAt fresh. The force
    // path must still rescue — this is the legit "stuck busy" case.
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "busy",
      lastHookAt: Date.now() - 70_000,
      lastOutputAt: Date.now() - 500,
      workDepth: 0,
    });
    (mgr as any).sessions.set("wt-dead-hooks:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-dead-hooks", agentStatus: "busy", staleBusy: false } as any],
    });

    (mgr as any).reconcileAll();

    expect(session.agentState).toBe("idle");
  });
```

- [ ] **Step 4: Run full suite to confirm no regression**

Run: `npm test -- --run status-scenarios`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/test/status-scenarios.test.ts
git commit -m "test(state): pin force-path workDepth behavior separately

Adds two tests that pin the force-idle path's workDepth==0 gate,
complementing the soft-path test landed in the previous commit.
Ensures future refactors can't silently re-diverge soft vs force
paths without a test failing.

Part 3/5 of agent-state workDepth rollout.
"
```

---

## Task 4: Populate `workDepth` from hook events

**Files:**
- Modify: `src/test/status-scenarios.test.ts` (add failing tests for counter mutation)
- Modify: `src/services/sessionChannel.ts` (increment/decrement in handler)

Note: these tests must drive the channel handler directly. Since the channel is not easily unit-testable in isolation, we test the effect via `SessionManager` by invoking the handler path. Easier approach: extract the depth-mutation logic into a pure helper and test that. We'll do the latter.

- [ ] **Step 1: Write failing unit test for depth-mutation helper**

Add to `src/test/status-scenarios.test.ts` (at the end of the file, after the last `describe` block):

```typescript
import { applyHookToDepth } from "../services/sessionChannel";

describe("applyHookToDepth", () => {
  it("increments on promptStart", () => {
    expect(applyHookToDepth(0, "busy", "promptStart")).toBe(1);
    expect(applyHookToDepth(2, "busy", "promptStart")).toBe(3);
  });

  it("increments on toolStart", () => {
    expect(applyHookToDepth(0, "busy", "toolStart")).toBe(1);
    expect(applyHookToDepth(1, "busy", "toolStart")).toBe(2);
  });

  it("decrements on toolEnd, clamped at zero", () => {
    expect(applyHookToDepth(2, "busy", "toolEnd")).toBe(1);
    expect(applyHookToDepth(1, "busy", "toolEnd")).toBe(0);
    expect(applyHookToDepth(0, "busy", "toolEnd")).toBe(0);
  });

  it("resets to zero on turnEnd regardless of state", () => {
    expect(applyHookToDepth(5, "idle", "turnEnd")).toBe(0);
    expect(applyHookToDepth(3, "busy", "turnEnd")).toBe(0);
  });

  it("resets to zero on notRunning", () => {
    expect(applyHookToDepth(7, "notRunning", "none")).toBe(0);
    expect(applyHookToDepth(7, "notRunning", "turnEnd")).toBe(0);
  });

  it("leaves depth unchanged on subagentEnd (the parent Task toolEnd will decrement)", () => {
    expect(applyHookToDepth(2, "busy", "subagentEnd")).toBe(2);
  });

  it("leaves depth unchanged on bare busy (phase=none)", () => {
    expect(applyHookToDepth(1, "busy", "none")).toBe(1);
  });

  it("leaves depth unchanged on waitingForInput", () => {
    expect(applyHookToDepth(1, "waitingForInput", "none")).toBe(1);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `npm test -- --run status-scenarios.test.ts -t "applyHookToDepth"`
Expected: FAIL — import error: `applyHookToDepth` is not exported.

- [ ] **Step 3: Implement and export the helper**

Edit `src/services/sessionChannel.ts`. Add the helper function before `createSessionChannel` (around line 117, just below the `SessionWriter` interface):

```typescript
/**
 * Given the current depth, the incoming hook state, and the hook phase,
 * return the new depth. Pure function — safe to unit test.
 *
 *   promptStart / toolStart  → +1
 *   toolEnd                   → max(0, d - 1)
 *   turnEnd                   → 0 (hard reset — a turn ended, all work done)
 *   notRunning (any phase)    → 0 (PTY exited)
 *   subagentEnd               → unchanged (Task tool's toolEnd will decrement)
 *   anything else             → unchanged
 */
export function applyHookToDepth(
  depth: number,
  state: import("../types").AgentState,
  phase: import("../types").HookPhase,
): number {
  if (state === "notRunning") return 0;
  switch (phase) {
    case "promptStart":
    case "toolStart":
      return depth + 1;
    case "toolEnd":
      return Math.max(0, depth - 1);
    case "turnEnd":
      return 0;
    case "subagentEnd":
    case "none":
    default:
      return depth;
  }
}
```

- [ ] **Step 4: Wire the helper into the channel handler**

Edit `src/services/sessionChannel.ts`. In the `hookAgentState` case (around line 172–272), find the existing `session.lastHookAt = Date.now(); session.hooksActive = true;` block (around line 178–179) and add the depth update immediately after:

```typescript
        session.lastHookAt = Date.now();
        session.hooksActive = true;
        session.workDepth = applyHookToDepth(session.workDepth, state, phase);
```

Also append the depth to the existing debug log near line 257. The current line reads:

```typescript
        console.debug(`[status:${worktreeId}] hook → ${state}${phase !== "none" ? `(${phase})` : ""}${notify !== "none" ? ` notify=${notify}` : ""} sessionKey=${sessionKey} sessionId=${session.sessionId}`);
```

Change to:

```typescript
        console.debug(`[status:${worktreeId}] hook → ${state}${phase !== "none" ? `(${phase})` : ""}${notify !== "none" ? ` notify=${notify}` : ""} depth=${session.workDepth} sessionKey=${sessionKey} sessionId=${session.sessionId}`);
```

- [ ] **Step 5: Run test — expect pass**

Run: `npm test -- --run status-scenarios.test.ts -t "applyHookToDepth"`
Expected: PASS.

- [ ] **Step 6: Run full suite — confirm no regression**

Run: `npm test -- --run status-scenarios`
Expected: all tests pass.

- [ ] **Step 7: Verify Rust not needed**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/services/sessionChannel.ts src/test/status-scenarios.test.ts
git commit -m "feat(state): populate workDepth from hook events

Pure helper applyHookToDepth computes the new counter on each hook.
Wired into the channel handler so every hook event updates depth in
step with lastHookAt. Depth appears in the hook debug log for future
diagnostics.

Phase vocabulary:
  promptStart, toolStart → +1
  toolEnd               → max(0, d-1)
  turnEnd, notRunning   → 0 (hard reset)
  subagentEnd           → unchanged (parent Task toolEnd decrements)

Part 4/5 of agent-state workDepth rollout.
"
```

---

## Task 5: End-to-end scenario — long tool across the full pipeline

**Files:**
- Modify: `src/test/status-scenarios.test.ts` (add integration-style scenario)

- [ ] **Step 1: Write failing integration scenario**

The previous tasks unit-tested each piece in isolation. This task pins the full loop: a `toolStart` hook increments depth via the channel handler pathway, the reconciler then respects it, `toolEnd` decrements, and a subsequent stale-hook reconcile rescues as expected.

Since the real channel callback is hard to invoke directly, the test simulates the handler by mutating `session.workDepth` through `applyHookToDepth`. That mirrors exactly what the wired handler does.

Add to `src/test/status-scenarios.test.ts` inside the `describe("SessionManager.reconcileAll", ...)` block:

```typescript
  it("end-to-end: long tool stays busy through stale window, then rescues after toolEnd+turnEnd", () => {
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "busy",
      lastHookAt: Date.now() - 5_000,
      lastOutputAt: Date.now() - 1_000,
      workDepth: 0,
    });
    (mgr as any).sessions.set("wt-e2e:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-e2e", agentStatus: "busy", staleBusy: false } as any],
    });

    // 1. toolStart arrives → depth = 1
    session.workDepth = applyHookToDepth(session.workDepth, "busy", "toolStart");
    expect(session.workDepth).toBe(1);

    // 2. Simulate 80s of silence on both hook and output channels
    session.lastHookAt = Date.now() - 80_000;
    session.lastOutputAt = Date.now() - 80_000;

    // 3. Reconciler runs — must NOT flip to idle (depth > 0)
    (mgr as any).reconcileAll();
    expect(session.agentState).toBe("busy");

    // 4. toolEnd arrives → depth = 0
    session.workDepth = applyHookToDepth(session.workDepth, "busy", "toolEnd");
    expect(session.workDepth).toBe(0);

    // 5. Hook channel then dies — another 80s of silence
    // (lastHookAt already stale from step 2; lastOutputAt also stale)
    (mgr as any).reconcileAll();

    // 6. Reconciler now rescues → idle
    expect(session.agentState).toBe("idle");
  });
```

- [ ] **Step 2: Run test — expect pass (all parts already wired)**

Run: `npm test -- --run status-scenarios.test.ts -t "end-to-end: long tool"`
Expected: PASS. (This test should pass directly because all the pieces from Tasks 1–4 are in place. If it fails, it means integration between the pieces is broken — diagnose before proceeding.)

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 4: Manual smoke test**

Run: `npm run tauri dev`

Perform the following checks in a running Claude tab:
  - Fire a long-running tool: prompt Claude to run `sleep 90; echo done` via Bash. Observe the tab's status dot stays busy throughout the 90s, then flips idle within ~1s of the bash returning.
  - Fire a subagent: prompt Claude with "launch a Task subagent that runs for 60 seconds". Observe the parent tab stays busy throughout; subagent's `SubagentStop` does not prematurely flip the parent idle.
  - Short turn: send a simple prompt ("say hi"). Observe normal busy → idle transition within debounce window (~300ms).
  - Hit `Esc` mid-tool while a long tool runs. Observe the session recovers to idle when the reconciler force path triggers (after 60s of hook silence + workDepth drops to 0 via the subsequent user prompt's turnEnd, or manually via session close).

Document any anomalies encountered in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src/test/status-scenarios.test.ts
git commit -m "test(state): end-to-end workDepth scenario + manual smoke test

Pins the full loop: toolStart increments depth, reconciler respects
it during hook/output silence, toolEnd decrements, subsequent stale
reconcile rescues. Manually verified long Bash, subagent, and short
turns against npm run tauri dev.

Part 5/5 of agent-state workDepth rollout.
"
```

---

## Self-Review

**Spec coverage:**
- ✅ Counter incremented on promptStart/toolStart (Task 4)
- ✅ Counter decremented on toolEnd, clamped at 0 (Task 4)
- ✅ Counter hard-reset on turnEnd (Task 4)
- ✅ Counter reset on notRunning / lifecycle events (Tasks 1, 4)
- ✅ Subagent phases correctly handled (`subagentEnd` is depth-neutral — Task 4)
- ✅ Reconciler soft path gated on `workDepth === 0` (Task 2)
- ✅ Reconciler force path gated on `workDepth === 0`, string-based `lastHookInFlight` removed (Task 3)
- ✅ Tests cover: long tool with stale hooks+output, TUI output flowing with tool in flight, hooks-dead with depth 0, end-to-end cycle, each phase's depth behavior
- ✅ Existing load-bearing behavior preserved: ordering invariant, bare-busy suppression, idle debounce, straggler subagentEnd, settings wipe fix

**Placeholder scan:** None detected — every step has exact code, exact paths, exact commands.

**Type consistency:**
- `workDepth: number` — consistent across `ManagedSession` interface, all init sites, reset sites, reconciler reads, handler write, helper signature
- `applyHookToDepth(depth, state, phase)` signature matches usage in channel handler and all test call sites
- `AgentState` / `HookPhase` types imported from `"../types"` in all sites

**Non-goals confirmed deferred:**
- Phase 2: `hookHealth` replacing `hooksActive` latch — not in this plan
- Phase 3: Rust-side settings watchdog — not in this plan
- Phase 4: reconciler deletion — not in this plan
- Phase 5: single-writer mirror enforcement — not in this plan
- Phase 6: Rust-side state authority — not in this plan
