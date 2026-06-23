import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import scenarios from "./status-scenarios.json";
import type { StatusScenario } from "./status-scenarios";
import type { AgentState } from "../types";
import { shouldAcceptDetectorState } from "../services/sessionManager";
import { computeEffectiveStatus } from "../components/sidebar/AgentItem";
import { computeStaleBusy } from "../hooks/usePty";

interface SimState {
  agentStatus: AgentState;
  hooksActive: boolean;
  channelAlive: boolean;
  lastOutputAt: number;
  lastHeartbeat: number;
  lastHookAt: number;
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
    lastHookAt: 0,
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
        const detectorState = step.expect.agentStatus;
        if (shouldAcceptDetectorState(state.hooksActive, state.lastHookAt)) {
          state.agentStatus = detectorState;
        }
        state.lastOutputAt = now;
        break;
      }
      case "detectorEvent": {
        const detectorState = action.state as AgentState;
        if (shouldAcceptDetectorState(state.hooksActive, state.lastHookAt)) {
          state.agentStatus = detectorState;
        }
        state.lastOutputAt = now;
        break;
      }
      case "hookEvent": {
        state.hooksActive = true;
        state.lastHookAt = now;
        state.agentStatus = action.state as AgentState;
        break;
      }
      case "userInput": {
        // User input — no special flag handling needed
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
    expect(
      state.agentStatus,
      `Scenario '${scenario.name}' step ${i}: agentStatus`,
    ).toBe(step.expect.agentStatus);

    // Assert effectiveStatus if specified
    if (step.expect.effectiveStatus !== undefined) {
      const staleBusy = computeStaleBusy(state.agentStatus, state.channelAlive, state.lastOutputAt, now);
      const effective = computeEffectiveStatus(
        state.agentStatus, state.channelAlive, staleBusy, state.isSeen,
      );
      expect(
        effective,
        `Scenario '${scenario.name}' step ${i}: effectiveStatus`,
      ).toBe(step.expect.effectiveStatus);
    }

    // Assert staleBusy if specified
    if (step.expect.staleBusy !== undefined) {
      const staleBusy = computeStaleBusy(state.agentStatus, state.channelAlive, state.lastOutputAt, now);
      expect(
        staleBusy,
        `Scenario '${scenario.name}' step ${i}: staleBusy`,
      ).toBe(step.expect.staleBusy);
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

import { SessionManager, type ManagedSession } from "../services/sessionManager";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useSessionStatusStore } from "../stores/sessionStatusStore";
import { useTabStore } from "../stores/tabStore";
import { startStatusMirror } from "../services/statusMirror";

function makeFakeSession(overrides: Partial<ManagedSession> = {}): ManagedSession {
  const now = Date.now();
  return {
    sessionId: "fake-session",
    terminal: {} as any,
    fitAddon: {} as any,
    searchAddon: {} as any,
    webglLoaded: false,
    webglAddon: null,
    agentState: "idle",
    hooksActive: true,
    outputBuffer: new Uint8Array(0),
    outputBufferPos: 0,
    outputBufferTotal: 0,
    lastHeartbeat: now,
    ptyExited: false,
    lastOutputAt: now,
    pendingOutput: [],
    writeInFlight: false,
    disposed: false,
    restoredFromScrollback: false,
    startupCommandSent: false,
    allowNextClearScrollback: false,
    lastHookAt: now - 5_000,
    lastHookDesc: "",
    hookDerivedState: null,
    pendingIdleTimer: null,
    turnEndAt: 0,
    workDepth: 0,
    subagentDepth: 0,
    lastSubagentActivityAt: 0,
    monitorPending: false,
    pasteDiagDrainChain: 0,
    pasteDiagLastLogAt: 0,
    staleHookNotifiedAt: 0,
    ...overrides,
  };
}

describe("SessionManager.reconcileAll", () => {
  it("does NOT flip idle → busy on stray output (status-bar redraws, focus echoes)", () => {
    // Regression: a previous reconciler flipped state back to busy whenever
    // any PTY bytes arrived after a Stop hook. Claude Code's status bar and
    // focus repaints emitted exactly such bytes, permanently re-sticking the
    // worktree in busy on every click.
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "idle",
      lastHookAt: Date.now() - 5_000,
      lastOutputAt: Date.now() - 500,
    });
    (mgr as any).sessions.set("wt-abc:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-abc", agentStatus: "idle", staleBusy: false } as any],
    });

    (mgr as any).reconcileAll();

    expect(session.agentState).toBe("idle");
    expect(useWorkspaceStore.getState().worktrees[0].agentStatus).toBe("idle");
  });

  it("flips stale busy → idle when neither hooks nor output have arrived for the thresholds", () => {
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "busy",
      lastHookAt: Date.now() - 120_000,
      lastOutputAt: Date.now() - 30_000,
    });
    (mgr as any).sessions.set("wt-xyz:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-xyz", agentStatus: "busy", staleBusy: false } as any],
    });
    useSessionStatusStore.getState().setSessionStatus("wt-xyz:main", "busy");

    (mgr as any).reconcileAll();

    expect(session.agentState).toBe("idle");
    // reconcileAll writes to sessionStatusStore; statusMirror projects from
    // there onto workspaceStore.agentStatus, so the mirror is what the test
    // for the visible sidebar state belongs to.
    expect(useSessionStatusStore.getState().statuses["wt-xyz:main"]).toBe("idle");
  });

  it("does NOT flip busy → idle when output is still flowing (long-running tool)", () => {
    // Pins the STALE_OUTPUT_IDLE_MS guard: hooks may have gone silent during
    // a long-running tool that streams output, but recent output means the
    // agent is still working — don't reconcile to idle.
    // Uses 50s silence — under the 60s STALE_HOOK_MS threshold so the soft
    // check fails (output too recent) and the force check doesn't trigger.
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "busy",
      lastHookAt: Date.now() - 50_000,
      lastOutputAt: Date.now() - 1_000,
    });
    (mgr as any).sessions.set("wt-streaming:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-streaming", agentStatus: "busy", staleBusy: false } as any],
    });

    (mgr as any).reconcileAll();

    expect(session.agentState).toBe("busy");
  });

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

  it("marks busy as stale (does NOT force idle) when hooks silent past force threshold but output still flowing", () => {
    // Hook channel may be dead (e.g. settings.local.json hooks stripped) while
    // Claude is genuinely busy producing output. We can't distinguish "work
    // done, hooks broken" from "work in flight, hooks broken" — so we keep
    // agentState=busy and surface the uncertainty via staleBusy. The sidebar
    // renders this as "stale" rather than the confident lie of "idle".
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

    expect(session.agentState).toBe("busy");
    expect(useWorkspaceStore.getState().worktrees[0].staleBusy).toBe(true);
  });

  it("does NOT flip busy → idle while hooks are still arriving (e.g. during tool use)", () => {
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "busy",
      lastHookAt: Date.now() - 2_000,
      lastOutputAt: Date.now() - 30_000,
    });
    (mgr as any).sessions.set("wt-tool:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-tool", agentStatus: "busy", staleBusy: false } as any],
    });

    (mgr as any).reconcileAll();

    expect(session.agentState).toBe("busy");
  });

  it("does NOT mark stale / flip idle while subagentDepth > 0, even if hooks AND output both stale", () => {
    // A worktree running silent background agents (subagentDepth=1) with no
    // hooks or output for 80s must stay busy and NOT be marked stale — the
    // subagent is structural proof work is happening, the same role workDepth
    // plays for foreground tools.
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "busy",
      lastHookAt: Date.now() - 80_000,
      lastOutputAt: Date.now() - 80_000,
      workDepth: 0,
      subagentDepth: 1,
    });
    (mgr as any).sessions.set("wt-bg:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-bg", agentStatus: "busy", staleBusy: false } as any],
    });

    (mgr as any).reconcileAll();

    expect(session.agentState).toBe("busy");
    expect(useWorkspaceStore.getState().worktrees[0].staleBusy).toBe(false);
  });

  it("self-heals a stranded subagentDepth (dropped SubagentStop) once BOTH channels are silent past the threshold", () => {
    // A dropped SubagentStop strands subagentDepth > 0; because the rescue
    // paths are gated on !hasWorkInFlight, the session would be stuck
    // 'Running N agents…' forever. After STALE_SUBAGENT_FORCE_MS of hook+output
    // silence, the count is cleared and the standard soft-rescue flips it idle.
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "busy",
      workDepth: 0,
      subagentDepth: 2,
      lastHookAt: Date.now() - 301_000,   // > STALE_SUBAGENT_FORCE_MS (300s)
      lastOutputAt: Date.now() - 301_000, // output also silent
    });
    (mgr as any).sessions.set("wt-strand:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-strand", agentStatus: "busy", staleBusy: false, runningAgents: 2 } as any],
    });

    (mgr as any).reconcileAll();

    expect(session.subagentDepth).toBe(0);
    expect(session.agentState).toBe("idle"); // soft-rescue fires same tick
  });

  it("projects summed subagentDepth onto worktree.runningAgents", () => {
    const mgr = new SessionManager();
    const sessA = makeFakeSession({ sessionId: "a", agentState: "busy", subagentDepth: 2 });
    const sessB = makeFakeSession({ sessionId: "b", agentState: "busy", subagentDepth: 1 });
    (mgr as any).sessions.set("wt-count:claude:a", sessA);
    (mgr as any).sessions.set("wt-count:claude:b", sessB);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-count", agentStatus: "busy", runningAgents: 0 } as any],
    });

    (mgr as any).reconcileAll();

    expect(useWorkspaceStore.getState().worktrees[0].runningAgents).toBe(3);
  });

  it("clears worktree.runningAgents back to 0 when no subagents remain", () => {
    const mgr = new SessionManager();
    const session = makeFakeSession({ agentState: "busy", subagentDepth: 0 });
    (mgr as any).sessions.set("wt-clear:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-clear", agentStatus: "busy", runningAgents: 5 } as any],
    });

    (mgr as any).reconcileAll();

    expect(useWorkspaceStore.getState().worktrees[0].runningAgents).toBe(0);
  });

  it("does not touch sessions where hooksActive=false (detector-driven)", () => {
    const mgr = new SessionManager();
    const session = makeFakeSession({
      hooksActive: false,
      agentState: "idle",
      lastOutputAt: Date.now() - 500,
    });
    (mgr as any).sessions.set("wt-codex:main", session);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-codex", agentStatus: "idle", staleBusy: false } as any],
    });

    (mgr as any).reconcileAll();

    expect(session.agentState).toBe("idle");
  });

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

    // 5. Hook channel then dies — lastHookAt and lastOutputAt remain stale
    //    (already set in step 2)
    (mgr as any).reconcileAll();

    // 6. Reconciler now rescues → idle
    expect(session.agentState).toBe("idle");
  });
});

describe("shouldAcceptDetectorState", () => {
  it("rejects detector when hooks are active and recent", () => {
    expect(shouldAcceptDetectorState(true, Date.now() - 5_000)).toBe(false);
  });

  it("accepts detector when hooks are not active", () => {
    expect(shouldAcceptDetectorState(false, 0)).toBe(true);
  });

  it("accepts detector as fallback when hooks have been silent for 60s+", () => {
    expect(shouldAcceptDetectorState(true, Date.now() - 61_000)).toBe(true);
  });

  it("rejects detector when hooks are active with lastHookAt=0 (no hooks received yet)", () => {
    // Edge case: hooksActive=true but lastHookAt=0 means we set hooksActive
    // but never recorded a timestamp. Shouldn't fall through to fallback.
    expect(shouldAcceptDetectorState(true, 0)).toBe(false);
  });
});

describe("hookAgentState debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-dbounce", agentStatus: "busy", staleBusy: false } as any],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces idle from turnEnd and discards when busy arrives within window", () => {
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "busy",
      hooksActive: true,
      lastHookAt: Date.now(),
    });
    (mgr as any).sessions.set("wt-dbounce:main", session);

    // Simulate: subagent Stop → idle (turnEnd)
    // We can't call the real channel handler, so simulate the debounce logic directly:
    // Set pendingIdleTimer like the handler would
    session.pendingIdleTimer = setTimeout(() => {
      session.agentState = "idle";
      useWorkspaceStore.getState().updateWorktree("wt-dbounce", { agentStatus: "idle" });
    }, 300);

    // Simulate: PostToolUse → busy arrives within 300ms (cancels pending idle)
    clearTimeout(session.pendingIdleTimer);
    session.pendingIdleTimer = null;
    session.agentState = "busy";

    // Advance past debounce window
    vi.advanceTimersByTime(500);

    // State should still be busy — the idle was discarded
    expect(session.agentState).toBe("busy");
    expect(useWorkspaceStore.getState().worktrees[0].agentStatus).toBe("busy");
  });

  it("applies idle after debounce window when no busy arrives", () => {
    const mgr = new SessionManager();
    const session = makeFakeSession({
      agentState: "busy",
      hooksActive: true,
      lastHookAt: Date.now(),
    });
    (mgr as any).sessions.set("wt-dbounce:main", session);

    // Simulate: Stop → idle (turnEnd) with no follow-up
    session.pendingIdleTimer = setTimeout(() => {
      session.agentState = "idle";
      useWorkspaceStore.getState().updateWorktree("wt-dbounce", { agentStatus: "idle" });
    }, 300);

    // Advance past debounce window — no cancellation
    vi.advanceTimersByTime(500);

    expect(session.agentState).toBe("idle");
    expect(useWorkspaceStore.getState().worktrees[0].agentStatus).toBe("idle");
  });
});

describe("statusMirror", () => {
  function makeAgentTab(id: string) {
    return { id, type: "claude" as const, label: "Claude" };
  }

  beforeEach(() => {
    // Reset stores to a clean baseline. startStatusMirror() is idempotent
    // (guarded by a module-level `started` flag) — calling it every test is
    // safe; subscriptions registered by the first call drive subsequent syncs.
    useTabStore.getState().clearStore();
    useSessionStatusStore.setState({ statuses: {} });
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-mirror", agentStatus: "notRunning", staleBusy: false } as any],
    });
    startStatusMirror();
  });

  it("aggregates highest-priority status across agent tabs", () => {
    const tabA = makeAgentTab("wt-mirror:claude:aaa");
    const tabB = makeAgentTab("wt-mirror:claude:bbb");
    useTabStore.setState({
      tabs: { "wt-mirror": [tabA, tabB] },
      activeTabId: { "wt-mirror": tabA.id },
    });
    useSessionStatusStore.getState().setSessionStatus(tabA.id, "busy");
    useSessionStatusStore.getState().setSessionStatus(tabB.id, "idle");

    expect(useWorkspaceStore.getState().worktrees[0].agentStatus).toBe("busy");
  });

  it("projects waitingForInput when any tab is waiting even if another is busy", () => {
    const tabA = makeAgentTab("wt-mirror:claude:aaa");
    const tabB = makeAgentTab("wt-mirror:claude:bbb");
    useTabStore.setState({
      tabs: { "wt-mirror": [tabA, tabB] },
      activeTabId: { "wt-mirror": tabA.id },
    });
    useSessionStatusStore.getState().setSessionStatus(tabA.id, "busy");
    useSessionStatusStore.getState().setSessionStatus(tabB.id, "waitingForInput");

    expect(useWorkspaceStore.getState().worktrees[0].agentStatus).toBe("waitingForInput");
  });

  it("projects notRunning when no agent tabs exist", () => {
    useTabStore.setState({
      tabs: { "wt-mirror": [] },
      activeTabId: {},
    });
    // Force a sync by nudging the status store.
    useSessionStatusStore.setState({ statuses: {} });

    expect(useWorkspaceStore.getState().worktrees[0].agentStatus).toBe("notRunning");
  });

  it("projects notRunning when all agent tabs are notRunning", () => {
    const tabA = makeAgentTab("wt-mirror:claude:aaa");
    const tabB = makeAgentTab("wt-mirror:claude:bbb");
    useTabStore.setState({
      tabs: { "wt-mirror": [tabA, tabB] },
      activeTabId: { "wt-mirror": tabA.id },
    });
    useSessionStatusStore.getState().setSessionStatus(tabA.id, "notRunning");
    useSessionStatusStore.getState().setSessionStatus(tabB.id, "notRunning");

    expect(useWorkspaceStore.getState().worktrees[0].agentStatus).toBe("notRunning");
  });

  it("drops to lower-priority status when the higher-priority tab closes", () => {
    // Regression: tab-close aggregation gap. Before, closing the busy tab left
    // the worktree stuck at busy because nothing recomputed the projection.
    const tabA = makeAgentTab("wt-mirror:claude:aaa");
    const tabB = makeAgentTab("wt-mirror:claude:bbb");
    useTabStore.setState({
      tabs: { "wt-mirror": [tabA, tabB] },
      activeTabId: { "wt-mirror": tabA.id },
    });
    useSessionStatusStore.getState().setSessionStatus(tabA.id, "busy");
    useSessionStatusStore.getState().setSessionStatus(tabB.id, "idle");
    expect(useWorkspaceStore.getState().worktrees[0].agentStatus).toBe("busy");

    // Simulate tab A closing: its status is cleared AND it's removed from tabs.
    useSessionStatusStore.getState().clearSessionStatus(tabA.id);
    useTabStore.setState({
      tabs: { "wt-mirror": [tabB] },
      activeTabId: { "wt-mirror": tabB.id },
    });

    expect(useWorkspaceStore.getState().worktrees[0].agentStatus).toBe("idle");
  });
});

describe("seenWorktrees ordering invariant", () => {
  it("preserves seenWorktrees when spawn order is setSessionStatus(busy) → markWorktreeSeen", () => {
    // Pins: after a session writes busy via the mirror and the user marks the
    // worktree seen, a subsequent mirror sync (which sees no change in the
    // projected status) must NOT run updateWorktree again — otherwise busy's
    // seen-clearing side-effect would undo the markWorktreeSeen.
    //
    // This exercises the statusMirror guard `if (wt.agentStatus !== projected)`
    // which is what keeps the ordering invariant holding.
    useTabStore.getState().clearStore();
    useSessionStatusStore.setState({ statuses: {} });
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-order", agentStatus: "notRunning", staleBusy: false } as any],
      seenWorktrees: new Set<string>(),
    });
    startStatusMirror();

    const tab = { id: "wt-order:claude:zzz", type: "claude" as const, label: "Claude" };
    useTabStore.setState({
      tabs: { "wt-order": [tab] },
      activeTabId: { "wt-order": tab.id },
    });

    // Session writes busy — mirror projects onto worktree, clearing any seen flag.
    useSessionStatusStore.getState().setSessionStatus(tab.id, "busy");
    expect(useWorkspaceStore.getState().worktrees[0].agentStatus).toBe("busy");

    // User now views the worktree.
    useWorkspaceStore.getState().markWorktreeSeen("wt-order");
    expect(useWorkspaceStore.getState().seenWorktrees.has("wt-order")).toBe(true);

    // A further mirror sync (e.g. session writes busy again) must not touch
    // the worktree since the projection hasn't changed. Seen flag survives.
    useSessionStatusStore.getState().setSessionStatus(tab.id, "busy");
    expect(useWorkspaceStore.getState().seenWorktrees.has("wt-order")).toBe(true);
  });
});

import { applyHookToDepth, applySubagentDepth, applyMonitorPending, hasWorkInFlight } from "../services/sessionChannel";

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

  // Alfredo's AskUserQuestion PreToolUse hook emits waitingForInput?phase=toolStart
  // (the agent is parked on a question but a tool is genuinely in flight). Depth
  // is driven by phase, not state, so it must increment like any toolStart and
  // get balanced by the matching PostToolUse(toolEnd) when the user answers.
  it("increments on toolStart even when state is waitingForInput (AskUserQuestion)", () => {
    expect(applyHookToDepth(0, "waitingForInput", "toolStart")).toBe(1);
    expect(applyHookToDepth(applyHookToDepth(0, "waitingForInput", "toolStart"), "busy", "toolEnd")).toBe(0);
  });

  it("leaves depth unchanged on subagentStart (subagents are tracked separately)", () => {
    expect(applyHookToDepth(2, "busy", "subagentStart")).toBe(2);
  });

  it("increments on monitorStart (balanced by the Monitor PostToolUse toolEnd)", () => {
    expect(applyHookToDepth(0, "busy", "monitorStart")).toBe(1);
  });
});

describe("applySubagentDepth", () => {
  it("increments on subagentStart", () => {
    expect(applySubagentDepth(0, "busy", "subagentStart")).toBe(1);
    expect(applySubagentDepth(2, "busy", "subagentStart")).toBe(3);
  });

  it("decrements on subagentEnd, clamped at zero", () => {
    expect(applySubagentDepth(2, "busy", "subagentEnd")).toBe(1);
    expect(applySubagentDepth(1, "busy", "subagentEnd")).toBe(0);
    expect(applySubagentDepth(0, "busy", "subagentEnd")).toBe(0);
  });

  // The crux of the fix: the main agent fires Stop (turnEnd) the moment it
  // dispatches background agents and yields. The count must survive that Stop
  // so the idle transition can be suppressed while subagents still run.
  it("leaves depth UNCHANGED on turnEnd (subagents outlive the parent's Stop)", () => {
    expect(applySubagentDepth(2, "idle", "turnEnd")).toBe(2);
  });

  it("resets to zero on promptStart (new user turn — prior subagents are done)", () => {
    expect(applySubagentDepth(3, "busy", "promptStart")).toBe(0);
  });

  it("resets to zero on notRunning (PTY exited)", () => {
    expect(applySubagentDepth(4, "notRunning", "none")).toBe(0);
    expect(applySubagentDepth(4, "notRunning", "subagentEnd")).toBe(0);
  });

  it("leaves depth unchanged on tool phases and bare busy", () => {
    expect(applySubagentDepth(1, "busy", "toolStart")).toBe(1);
    expect(applySubagentDepth(1, "busy", "toolEnd")).toBe(1);
    expect(applySubagentDepth(1, "busy", "none")).toBe(1);
  });
});

describe("applyMonitorPending", () => {
  it("sets true on monitorStart", () => {
    expect(applyMonitorPending(false, "busy", "monitorStart")).toBe(true);
  });
  it("survives turnEnd — must outlive the parking Stop", () => {
    expect(applyMonitorPending(true, "idle", "turnEnd")).toBe(true);
  });
  it("clears on promptStart (resume / fresh turn)", () => {
    expect(applyMonitorPending(true, "busy", "promptStart")).toBe(false);
  });
  it("clears on notRunning (PTY exit)", () => {
    expect(applyMonitorPending(true, "notRunning", "none")).toBe(false);
  });
  it("is unchanged by tool/subagent phases", () => {
    expect(applyMonitorPending(true, "busy", "toolEnd")).toBe(true);
    expect(applyMonitorPending(true, "busy", "toolStart")).toBe(true);
    expect(applyMonitorPending(true, "busy", "subagentStart")).toBe(true);
  });
});

describe("hasWorkInFlight", () => {
  it("is true when either workDepth or subagentDepth is > 0", () => {
    expect(hasWorkInFlight({ workDepth: 1, subagentDepth: 0, monitorPending: false })).toBe(true);
    expect(hasWorkInFlight({ workDepth: 0, subagentDepth: 1, monitorPending: false })).toBe(true);
    expect(hasWorkInFlight({ workDepth: 2, subagentDepth: 3, monitorPending: false })).toBe(true);
  });

  it("is false only when both are zero", () => {
    expect(hasWorkInFlight({ workDepth: 0, subagentDepth: 0, monitorPending: false })).toBe(false);
  });

  it("is true when a monitor is pending even with zero depth", () => {
    expect(hasWorkInFlight({ workDepth: 0, subagentDepth: 0, monitorPending: true })).toBe(true);
  });
  it("is false when no work and no monitor", () => {
    expect(hasWorkInFlight({ workDepth: 0, subagentDepth: 0, monitorPending: false })).toBe(false);
  });
});

describe("multi-tab reconciler independence", () => {
  it("two independent sessions for one worktree each have their own lastHookAt", () => {
    // Sanity: reconciler state is per-session (keyed by sessionKey), not
    // per-worktree. Two tabs on the same worktree must track their own
    // lastHookAt so one going stale doesn't reconcile the other.
    const mgr = new SessionManager();
    const sessA = makeFakeSession({
      sessionId: "sess-a",
      agentState: "busy",
      lastHookAt: Date.now() - 2_000, // fresh
      lastOutputAt: Date.now() - 500,
    });
    const sessB = makeFakeSession({
      sessionId: "sess-b",
      agentState: "busy",
      lastHookAt: Date.now() - 120_000, // stale
      lastOutputAt: Date.now() - 120_000,
    });
    (mgr as any).sessions.set("wt-multi:claude:aaa", sessA);
    (mgr as any).sessions.set("wt-multi:claude:bbb", sessB);
    useWorkspaceStore.setState({
      worktrees: [{ id: "wt-multi", agentStatus: "busy", staleBusy: false } as any],
    });
    useSessionStatusStore.getState().setSessionStatus("wt-multi:claude:aaa", "busy");
    useSessionStatusStore.getState().setSessionStatus("wt-multi:claude:bbb", "busy");

    (mgr as any).reconcileAll();

    // A stays busy (fresh hooks). B reconciles to idle (stale).
    expect(sessA.agentState).toBe("busy");
    expect(sessB.agentState).toBe("idle");
    // Confirms reconciler didn't conflate the two sessions' lastHookAt.
    expect(sessA.lastHookAt).not.toBe(sessB.lastHookAt);
  });
});

import { createSessionChannel, stateSourceMap, IDLE_DEBOUNCE_MS, IDLE_DEBOUNCE_SUBAGENT_MS } from "../services/sessionChannel";

describe("createSessionChannel wires workDepth updates", () => {
  it("increments session.workDepth on busy(toolStart) hook event", () => {
    const session = makeFakeSession({ workDepth: 0 });
    const fakeWriter = {
      scheduleWrite: () => {},
      appendToBuffer: () => {},
    };
    const channel = createSessionChannel(fakeWriter as any, session, "wt-wire", "wt-wire:main");

    // Drive the handler with a hook event as the real Tauri channel would.
    // Tauri Channel exposes the subscribed callback via `onmessage`.
    (channel as any).onmessage({
      event: "hookAgentState",
      data: { state: "busy", phase: "toolStart", notify: "none" },
    });

    expect(session.workDepth).toBe(1);
  });

  it("decrements session.workDepth on busy(toolEnd) hook event", () => {
    const session = makeFakeSession({ workDepth: 2 });
    const fakeWriter = {
      scheduleWrite: () => {},
      appendToBuffer: () => {},
    };
    const channel = createSessionChannel(fakeWriter as any, session, "wt-wire", "wt-wire:main");

    (channel as any).onmessage({
      event: "hookAgentState",
      data: { state: "busy", phase: "toolEnd", notify: "none" },
    });

    expect(session.workDepth).toBe(1);
  });
});

describe("createSessionChannel background-subagent (SubagentStart) handling", () => {
  const fakeWriter = { scheduleWrite: () => {}, appendToBuffer: () => {} };

  function hook(channel: any, phase: string, state = "busy", notify = "none") {
    channel.onmessage({ event: "hookAgentState", data: { state, phase, notify } });
  }

  it("increments subagentDepth on subagentStart and keeps the session busy", () => {
    const session = makeFakeSession({ agentState: "busy", subagentDepth: 0 });
    const channel = createSessionChannel(fakeWriter as any, session, "wt-sa", "wt-sa:main") as any;

    hook(channel, "subagentStart");
    hook(channel, "subagentStart");

    expect(session.subagentDepth).toBe(2);
    expect(session.agentState).toBe("busy");
  });

  it("SUPPRESSES idle(turnEnd) while background subagents are still in flight", () => {
    // Reproduces the live-log Scenario A: the main agent dispatches background
    // agents (subagentStart ×2), then yields → Stop fires → idle(turnEnd). The
    // turn isn't really done, so the session must stay busy, not flip to Idle.
    const session = makeFakeSession({ agentState: "busy", subagentDepth: 0 });
    const channel = createSessionChannel(fakeWriter as any, session, "wt-sa2", "wt-sa2:main") as any;

    hook(channel, "subagentStart");
    hook(channel, "subagentStart");
    hook(channel, "turnEnd", "idle", "finished"); // main yields while agents run

    expect(session.agentState).toBe("busy");
    expect(session.pendingIdleTimer).toBe(null); // suppressed, not even debounced
    expect(session.subagentDepth).toBe(2);
  });

  it("transitions to idle once the last subagent finishes and the real Stop fires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000); // realistic clock so subagent-recency works
    // No worktree in the store → the debounced idle skips the notification path.
    useWorkspaceStore.setState({ worktrees: [] });
    const session = makeFakeSession({ agentState: "busy", subagentDepth: 0 });
    const channel = createSessionChannel(fakeWriter as any, session, "wt-sa3", "wt-sa3:main") as any;

    hook(channel, "subagentStart");
    hook(channel, "subagentStart");
    hook(channel, "turnEnd", "idle", "finished"); // suppressed
    expect(session.agentState).toBe("busy");

    hook(channel, "subagentEnd");
    hook(channel, "subagentEnd");
    expect(session.subagentDepth).toBe(0);

    // Main agent wakes, does its real work, then fires the genuine Stop.
    hook(channel, "turnEnd", "idle", "finished");
    expect(session.pendingIdleTimer).not.toBe(null); // no longer suppressed — debounced
    // Subagent activity was recent, so the LONG window is in effect: the short
    // 300ms debounce must not fire it yet (the genuine final notification lands
    // ~IDLE_DEBOUNCE_SUBAGENT_MS late during a background task — by design).
    vi.advanceTimersByTime(IDLE_DEBOUNCE_MS + 10);
    expect(session.agentState).toBe("busy");
    vi.advanceTimersByTime(IDLE_DEBOUNCE_SUBAGENT_MS);
    expect(session.agentState).toBe("idle");

    vi.useRealTimers();
  });

  it("self-heals a dropped subagentEnd on the next promptStart (new user turn)", () => {
    const session = makeFakeSession({ agentState: "busy", subagentDepth: 3 });
    const channel = createSessionChannel(fakeWriter as any, session, "wt-sa4", "wt-sa4:main") as any;

    hook(channel, "promptStart"); // fresh user turn — prior subagents are done
    expect(session.subagentDepth).toBe(0);
  });

  it("does NOT notify on a turnEnd when subagentDepth under-counted but a resume follows (the leak fix)", () => {
    // Live root cause: Claude Code fires SubagentStop for background/Workflow
    // agents but NOT SubagentStart, so subagentDepth under-counts and sits at 0
    // while agents are still running. The depth>0 hard-suppress can't catch the
    // repeated park-between-results Stops → every harvest cycle leaked a banner.
    // The adaptive long window + resume-cancels it fix the leak.
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000); // realistic clock so subagent-recency works
    try {
      useWorkspaceStore.setState({ worktrees: [] });
      const session = makeFakeSession({ agentState: "busy", subagentDepth: 0 });
      const channel = createSessionChannel(fakeWriter as any, session, "wt-leak", "wt-leak:main") as any;

      // SubagentStop with no matching SubagentStart → depth stays 0, activity recorded.
      hook(channel, "subagentEnd");
      expect(session.subagentDepth).toBe(0);
      expect(session.lastSubagentActivityAt).toBeGreaterThan(0);

      // Main agent parks → Stop. depth==0 so the hard-suppress doesn't apply; it
      // debounces on the LONG window because subagent activity is recent.
      hook(channel, "turnEnd", "idle", "finished");
      expect(session.pendingIdleTimer).not.toBe(null);
      vi.advanceTimersByTime(IDLE_DEBOUNCE_MS + 10);
      expect(session.agentState).toBe("busy"); // long window — not fired yet

      // Agent wakes to harvest the next result → busy(toolStart) cancels it.
      hook(channel, "toolStart");
      expect(session.pendingIdleTimer).toBe(null);

      // Even past the full long window, no idle transition / notification fired.
      vi.advanceTimersByTime(IDLE_DEBOUNCE_SUBAGENT_MS + 10);
      expect(session.agentState).toBe("busy");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT let a straggler (busy toolEnd / subagentEnd) cancel the real finished notification", () => {
    // The dangerous failure mode the long window opens: a late PostToolUse /
    // PermissionDenied (busy toolEnd) or a late SubagentStop (busy subagentEnd)
    // arriving inside the window after the GENUINE final turnEnd must NOT cancel
    // the pending timer — that would permanently swallow the finished banner.
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000); // realistic clock so subagent-recency works
    try {
      useWorkspaceStore.setState({ worktrees: [] });
      const session = makeFakeSession({ agentState: "busy", subagentDepth: 0 });
      const channel = createSessionChannel(fakeWriter as any, session, "wt-strag", "wt-strag:main") as any;

      hook(channel, "subagentEnd"); // recent activity → long window
      hook(channel, "turnEnd", "idle", "finished"); // the genuine final Stop
      expect(session.pendingIdleTimer).not.toBe(null);

      hook(channel, "toolEnd"); // late PostToolUse straggler — must not cancel
      expect(session.pendingIdleTimer).not.toBe(null);
      hook(channel, "subagentEnd"); // late SubagentStop straggler — must not cancel
      expect(session.pendingIdleTimer).not.toBe(null);

      // Window elapses → the finish settles to idle (notification delivered).
      vi.advanceTimersByTime(IDLE_DEBOUNCE_SUBAGENT_MS + 10);
      expect(session.agentState).toBe("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leak an orphaned timer when idle(turnEnd) fires twice in a row (single-timer invariant)", () => {
    // Regression: a second idle(turnEnd) does NOT hit the forward-progress
    // cancel (state is "idle"), so without an explicit clear it would overwrite
    // pendingIdleTimer and orphan the first setTimeout — which still fires,
    // double-notifying. The intervening straggler subagentEnd no longer cancels
    // (by design), so it can't clean up the first timer either. This sequence
    // (turnEnd → subagentEnd → turnEnd) appears verbatim in the live hook log.
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000); // realistic clock so subagent-recency works
    try {
      useWorkspaceStore.setState({ worktrees: [] });
      const session = makeFakeSession({ agentState: "busy", subagentDepth: 0 });
      const channel = createSessionChannel(fakeWriter as any, session, "wt-dbl", "wt-dbl:main") as any;

      hook(channel, "subagentEnd"); // recent activity → long window
      hook(channel, "turnEnd", "idle", "finished"); // schedules timer T1
      hook(channel, "subagentEnd"); // straggler — no longer cancels T1
      hook(channel, "turnEnd", "idle", "finished"); // must clear T1, not orphan it

      // Single-timer invariant: exactly one pending idle timer, never two.
      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(IDLE_DEBOUNCE_SUBAGENT_MS + 10);
      expect(session.agentState).toBe("idle");
      expect(vi.getTimerCount()).toBe(0); // no orphan left ticking
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the snappy 300ms window for a normal turnEnd with no recent subagent activity", () => {
    // Regression guard for the trade-off: the long window must apply ONLY when
    // subagent activity is recent. A plain turn keeps the fast notification.
    vi.useFakeTimers();
    try {
      useWorkspaceStore.setState({ worktrees: [] });
      const session = makeFakeSession({ agentState: "busy", subagentDepth: 0 });
      const channel = createSessionChannel(fakeWriter as any, session, "wt-normal", "wt-normal:main") as any;

      hook(channel, "turnEnd", "idle", "finished");
      expect(session.pendingIdleTimer).not.toBe(null);
      vi.advanceTimersByTime(IDLE_DEBOUNCE_MS + 10);
      expect(session.agentState).toBe("idle"); // fired on the short window
    } finally {
      vi.useRealTimers();
    }
  });

  it("detector idle is REJECTED while subagentDepth > 0 even after hooks go stale", () => {
    // The detector fallback re-engages after 60s of hook silence. Real
    // background agents fire no parent tool-hooks, so a long run goes silent and
    // the detector misreads the `❯` prompt as idle. subagentDepth > 0 must mute
    // it — otherwise the session false-flips to idle mid-run (undoing the fix).
    const session = makeFakeSession({
      agentState: "busy",
      hookDerivedState: "busy",
      subagentDepth: 1,
      workDepth: 0,
      hooksActive: true,
      lastHookAt: Date.now() - 80_000, // hooks stale → detector unmutes
    });
    const channel = createSessionChannel(fakeWriter as any, session, "wt-sa5", "wt-sa5:main") as any;

    channel.onmessage({ event: "agentState", data: "idle" });

    expect(session.agentState).toBe("busy"); // detector idle rejected
  });
});

describe("detector mute while hook-derived state is idle", () => {
  // Reproduces the detector-vs-reconciler race: after an idle hook, the
  // detector's 60s fallback re-engages and can false-flip the state to busy
  // purely from TUI output patterns. The reconciler then force-idles within
  // 500ms, producing visible status-badge flicker and `[debug] stuck busy
  // rescued` spam. Mute rule: once the hook channel has declared idle, ignore
  // detector events regardless of hook-silence age.

  it("rejects detector busy event after idle(none) hook, even with stale lastHookAt", () => {
    const session = makeFakeSession({
      agentState: "busy",
      hooksActive: true,
      lastHookAt: Date.now(),
    });
    const fakeWriter = { scheduleWrite: () => {}, appendToBuffer: () => {} };
    const channel = createSessionChannel(fakeWriter as any, session, "wt-mute-none", "wt-mute-none:main");

    (channel as any).onmessage({
      event: "hookAgentState",
      data: { state: "idle", phase: "none", notify: "none" },
    });
    expect(session.agentState).toBe("idle");

    // Simulate 61s of hook silence so the detector's stale-hook fallback would
    // otherwise accept the next event.
    session.lastHookAt = Date.now() - 61_000;

    (channel as any).onmessage({ event: "agentState", data: "busy" });

    expect(session.agentState).toBe("idle");
    // Rejection, not acceptance — source map must still reflect the last
    // hook-driven transition, not a detector flip.
    expect(stateSourceMap.get("wt-mute-none")).toBe("hook");
  });

  it("rejects detector busy event after idle(turnEnd) debounce settles, even with stale lastHookAt", () => {
    vi.useFakeTimers();
    try {
      useWorkspaceStore.setState({
        worktrees: [{ id: "wt-mute-te", agentStatus: "busy", staleBusy: false } as any],
      });
      const session = makeFakeSession({
        agentState: "busy",
        hooksActive: true,
        lastHookAt: Date.now(),
      });
      const fakeWriter = { scheduleWrite: () => {}, appendToBuffer: () => {} };
      const channel = createSessionChannel(fakeWriter as any, session, "wt-mute-te", "wt-mute-te:main");

      (channel as any).onmessage({
        event: "hookAgentState",
        data: { state: "idle", phase: "turnEnd", notify: "finished" },
      });
      // turnEnd debounces for IDLE_DEBOUNCE_MS before applying idle.
      expect(session.agentState).toBe("busy");
      vi.advanceTimersByTime(500);
      expect(session.agentState).toBe("idle");

      session.lastHookAt = Date.now() - 61_000;

      (channel as any).onmessage({ event: "agentState", data: "busy" });

      expect(session.agentState).toBe("idle");
      expect(stateSourceMap.get("wt-mute-te")).toBe("hook");
    } finally {
      vi.useRealTimers();
    }
  });

  it("still accepts detector event when last hook was busy AND workDepth==0 (safety net)", () => {
    // Sanity check: when the hook channel went silent after work structurally
    // completed (toolStart → toolEnd brought depth back to 0, but Stop never
    // arrived), the detector's 60s fallback should still fire so the state can
    // recover. This is the "Stop hook dropped" rescue path.
    const session = makeFakeSession({
      agentState: "busy",
      hooksActive: true,
      lastHookAt: Date.now(),
    });
    const fakeWriter = { scheduleWrite: () => {}, appendToBuffer: () => {} };
    const channel = createSessionChannel(fakeWriter as any, session, "wt-safety", "wt-safety:main");

    (channel as any).onmessage({
      event: "hookAgentState",
      data: { state: "busy", phase: "toolStart", notify: "none" },
    });
    (channel as any).onmessage({
      event: "hookAgentState",
      data: { state: "busy", phase: "toolEnd", notify: "none" },
    });
    expect(session.workDepth).toBe(0);
    session.lastHookAt = Date.now() - 61_000;

    (channel as any).onmessage({ event: "agentState", data: "idle" });

    expect(session.agentState).toBe("idle");
  });

  it("rejects detector idle event when last hook was busy AND workDepth>0 (long-stream flicker fix)", () => {
    // Reproduces the `/read-plan`-on-a-huge-plan flicker: UserPromptSubmit
    // increments depth to 1, tool calls bring it to 2 then back to 1, then
    // the LLM streams response text for >60s with no further hooks. The detector
    // unmutes and Claude Code's `❯` prompt redraws look like idle, then the
    // next text chunk looks like busy → sidebar flickers busy/idle/done.
    // workDepth > 0 is structural proof the turn is still open — detector must
    // defer to hooks here, even when lastHookAt is past the stale threshold.
    const session = makeFakeSession({
      agentState: "busy",
      hooksActive: true,
      lastHookAt: Date.now(),
    });
    const fakeWriter = { scheduleWrite: () => {}, appendToBuffer: () => {} };
    const channel = createSessionChannel(fakeWriter as any, session, "wt-stream", "wt-stream:main");

    // UserPromptSubmit → depth=1
    (channel as any).onmessage({
      event: "hookAgentState",
      data: { state: "busy", phase: "promptStart", notify: "none" },
    });
    // PreToolUse + PostToolUse for the Read call → depth back to 1
    (channel as any).onmessage({
      event: "hookAgentState",
      data: { state: "busy", phase: "toolStart", notify: "none" },
    });
    (channel as any).onmessage({
      event: "hookAgentState",
      data: { state: "busy", phase: "toolEnd", notify: "none" },
    });
    expect(session.workDepth).toBe(1);
    expect(session.hookDerivedState).toBe("busy");

    // Long stream begins; hooks go silent past STALE_HOOK_MS (60s).
    session.lastHookAt = Date.now() - 81_000;

    // Detector misreads `❯` prompt redraw as idle.
    (channel as any).onmessage({ event: "agentState", data: "idle" });
    expect(session.agentState).toBe("busy");

    // Detector then misreads next text chunk as busy (no-op, but proves the
    // flip from above didn't sneak through).
    (channel as any).onmessage({ event: "agentState", data: "busy" });
    expect(session.agentState).toBe("busy");
  });
});
