import type { AgentState } from "../types";

export const NEEDS_YOU_STATES = new Set(["waitingForInput", "done", "error", "ready"]);

export function computeEffectiveStatus(
  agentStatus: AgentState,
  channelAlive: boolean | undefined,
  staleBusy: boolean | undefined,
  isSeen: boolean,
  justCreated?: boolean,
  setupInProgress?: boolean,
): string {
  // Background setup scripts run off the critical path, so an agent can be
  // spawned while they're still installing. Show "Setting up…" only while no
  // agent is live yet — once one is running, its real state (busy /
  // waitingForInput / done / error) must win, or the setup label swallows the
  // attention signal and no dock badge fires.
  if (setupInProgress && agentStatus === "notRunning") return "settingUp";
  if (justCreated) return "ready";
  const channelStatus = channelAlive === false && agentStatus !== "notRunning"
    ? "disconnected"
    : agentStatus;
  const baseStatus = channelStatus === "busy" && staleBusy ? "stale" : channelStatus;
  if (baseStatus === "idle" && !isSeen) {
    return "done";
  }
  return baseStatus;
}
