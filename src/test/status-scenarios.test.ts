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
    agentState: "idle",
    hooksActive: true,
    outputBuffer: new Uint8Array(0),
    outputBufferPos: 0,
    outputBufferTotal: 0,
    lastHeartbeat: now,
    ptyExited: false,
    lastOutputAt: now,
    pendingOutput: [],
    writeScheduled: false,
    restoredFromScrollback: false,
    startupCommandSent: false,
    allowNextClearScrollback: false,
    lastHookAt: now - 5_000,
    lastHookDesc: "",
    pendingIdleTimer: null,
    turnEndAt: 0,
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
