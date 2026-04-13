import { describe, it, expect } from "vitest";
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
  isSeen: boolean;
  /** Epoch ms of last hook event — used to gate detector fallback. */
  lastHookEventAt: number;
  /** Mirrors sessionManager.toolsInFlight bookkeeping. */
  toolsInFlight: number;
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
    lastHookEventAt: 0,
    toolsInFlight: 0,
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
        // Rebase lastHookEventAt onto real Date.now() so the function's
        // internal `Date.now() - lastHookEventAt` matches simulated elapsed.
        const rebasedHookAt = state.lastHookEventAt === 0 ? 0 : Date.now() - (now - state.lastHookEventAt);
        if (shouldAcceptDetectorState(state.hooksActive, detectorState, state.agentStatus, rebasedHookAt, state.toolsInFlight)) {
          state.agentStatus = detectorState;
        }
        state.lastOutputAt = now;
        break;
      }
      case "detectorEvent": {
        // Same as ptyOutput, but the expected state is independent of what
        // the detector saw — used to prove the detector is rejected when
        // tools are in flight even though silence threshold has passed.
        const detectorState = action.state as AgentState;
        const rebasedHookAt = state.lastHookEventAt === 0 ? 0 : Date.now() - (now - state.lastHookEventAt);
        if (shouldAcceptDetectorState(state.hooksActive, detectorState, state.agentStatus, rebasedHookAt, state.toolsInFlight)) {
          state.agentStatus = detectorState;
        }
        state.lastOutputAt = now;
        break;
      }
      case "hookEvent": {
        state.hooksActive = true;
        state.lastHookEventAt = now;
        state.agentStatus = action.state as AgentState;
        // Mirror sessionManager.ts toolsInFlight bookkeeping.
        switch (action.phase) {
          case "toolStart":
            state.toolsInFlight += 1;
            break;
          case "toolEnd":
            state.toolsInFlight = Math.max(0, state.toolsInFlight - 1);
            break;
          case "turnEnd":
            state.toolsInFlight = 0;
            break;
        }
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
