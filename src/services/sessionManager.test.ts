import { describe, it, expect } from "vitest";
import { shouldAcceptDetectorState } from "./sessionManager";
import {
  applyRegistryCorrection,
  matchRegistryEntry,
  REGISTRY_TRUST_HOOK_SILENCE_MS,
} from "./sessionChannel";
import type { ClaudeRegistryEntry } from "../types";

describe("shouldAcceptDetectorState", () => {
  it("accepts detector events when hooks are not active", () => {
    expect(shouldAcceptDetectorState(false, 0)).toBe(true);
  });

  it("rejects detector events when hooks are active and fresh", () => {
    expect(shouldAcceptDetectorState(true, Date.now())).toBe(false);
  });

  it("falls back to detector when hooks have been silent for > 60s", () => {
    const stale = Date.now() - 61_000;
    expect(shouldAcceptDetectorState(true, stale)).toBe(true);
  });
});

describe("matchRegistryEntry", () => {
  const entry = (over: Partial<ClaudeRegistryEntry> = {}): ClaudeRegistryEntry => ({
    pid: 1, sessionId: "s-1", cwd: "/wt/a", kind: "interactive", status: "idle", ...over,
  });

  it("matches by claude session id first, even when cwd differs", () => {
    const entries = [entry({ sessionId: "s-1", cwd: "/moved" }), entry({ sessionId: "s-2" })];
    expect(matchRegistryEntry(entries, "s-1", "/wt/a")?.sessionId).toBe("s-1");
  });

  it("does NOT fall back to cwd when a known session id is absent from the registry", () => {
    // The claude we knew about is gone — a cwd fallback here would adopt a
    // sibling tab's session and mis-correct this one.
    const entries = [entry({ sessionId: "s-other", cwd: "/wt/a" })];
    expect(matchRegistryEntry(entries, "s-dead", "/wt/a")).toBeNull();
  });

  it("falls back to a unique cwd match when no session id is known", () => {
    const entries = [entry({ sessionId: "s-1", cwd: "/wt/a" }), entry({ sessionId: "s-2", cwd: "/wt/b" })];
    expect(matchRegistryEntry(entries, undefined, "/wt/a")?.sessionId).toBe("s-1");
  });

  it("returns null when the cwd match is ambiguous", () => {
    const entries = [entry({ sessionId: "s-1" }), entry({ sessionId: "s-2" })]; // both cwd /wt/a
    expect(matchRegistryEntry(entries, undefined, "/wt/a")).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(matchRegistryEntry([entry()], "s-x", "/wt/z")).toBeNull();
  });
});

describe("applyRegistryCorrection", () => {
  const base = {
    agentState: "busy" as const,
    hooksActive: true,
    ptyExited: false,
    lastHookAt: 1_000,
    workDepth: 0,
    subagentDepth: 0,
    monitorPending: false,
    awaitingAnswer: false,
  };
  // Hooks silent just past the trust threshold.
  const now = 1_000 + REGISTRY_TRUST_HOOK_SILENCE_MS + 1;

  it("forces idle when registry says idle and session shows busy", () => {
    expect(applyRegistryCorrection(base, "idle", now)).toBe("forceIdle");
  });

  it("forces idle when counters are stranded on an already-idle session", () => {
    expect(
      applyRegistryCorrection({ ...base, agentState: "idle", subagentDepth: 2 }, "idle", now),
    ).toBe("forceIdle");
  });

  it("forces idle when a session is stuck on waitingForInput the registry says is gone", () => {
    expect(
      applyRegistryCorrection({ ...base, agentState: "waitingForInput", awaitingAnswer: true }, "idle", now),
    ).toBe("forceIdle");
  });

  it("returns null while hooks are recent (never race the hook channel)", () => {
    expect(applyRegistryCorrection(base, "idle", 1_000 + 5_000)).toBeNull();
  });

  it("returns null for sessions without hooks or with an exited pty", () => {
    expect(applyRegistryCorrection({ ...base, hooksActive: false }, "idle", now)).toBeNull();
    expect(applyRegistryCorrection({ ...base, ptyExited: true }, "idle", now)).toBeNull();
  });

  it("forces waiting when registry says waiting and session shows busy or idle", () => {
    expect(applyRegistryCorrection(base, "waiting", now)).toBe("forceWaiting");
    expect(applyRegistryCorrection({ ...base, agentState: "idle" }, "waiting", now)).toBe("forceWaiting");
  });

  it("does not force waiting when already waitingForInput", () => {
    expect(applyRegistryCorrection({ ...base, agentState: "waitingForInput" }, "waiting", now)).toBeNull();
  });

  it("confirms busy regardless of hook recency", () => {
    expect(applyRegistryCorrection(base, "busy", 1_001)).toBe("confirmBusy");
  });

  it("never corrects an in-sync idle session", () => {
    expect(applyRegistryCorrection({ ...base, agentState: "idle" }, "idle", now)).toBeNull();
  });
});
