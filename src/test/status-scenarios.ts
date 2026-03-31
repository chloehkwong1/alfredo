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
