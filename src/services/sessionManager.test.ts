import { describe, it, expect } from "vitest";
import { shouldAcceptDetectorState } from "./sessionManager";

const STALE_HOOK = Date.now() - 10_000; // 10s ago — hooks silent, fallback should fire
const FRESH_HOOK = Date.now() - 500;    // 0.5s ago — hooks just fired, reject detector

describe("shouldAcceptDetectorState", () => {
  it("accepts all states when hooks are not active", () => {
    expect(shouldAcceptDetectorState(false, "busy", "idle", 0)).toBe(true);
    expect(shouldAcceptDetectorState(false, "idle", "idle", 0)).toBe(true);
    expect(shouldAcceptDetectorState(false, "waitingForInput", "idle", 0)).toBe(true);
    expect(shouldAcceptDetectorState(false, "notRunning", "idle", 0)).toBe(true);
  });

  it("rejects detector states when hooks are active and not stuck busy", () => {
    expect(shouldAcceptDetectorState(true, "busy", "idle", STALE_HOOK)).toBe(false);
    expect(shouldAcceptDetectorState(true, "idle", "idle", STALE_HOOK)).toBe(false);
    expect(shouldAcceptDetectorState(true, "waitingForInput", "idle", STALE_HOOK)).toBe(false);
    expect(shouldAcceptDetectorState(true, "notRunning", "idle", STALE_HOOK)).toBe(false);
    expect(shouldAcceptDetectorState(true, "busy", "waitingForInput", STALE_HOOK)).toBe(false);
    expect(shouldAcceptDetectorState(true, "notRunning", "busy", STALE_HOOK)).toBe(false);
  });

  it("accepts idle/waitingForInput from detector when hooks active but stuck busy (interrupt fallback)", () => {
    expect(shouldAcceptDetectorState(true, "idle", "busy", STALE_HOOK)).toBe(true);
    expect(shouldAcceptDetectorState(true, "waitingForInput", "busy", STALE_HOOK)).toBe(true);
  });

  it("rejects detector idle/waitingForInput when hooks fired recently (stale detector event)", () => {
    expect(shouldAcceptDetectorState(true, "idle", "busy", FRESH_HOOK)).toBe(false);
    expect(shouldAcceptDetectorState(true, "waitingForInput", "busy", FRESH_HOOK)).toBe(false);
  });

  it("still rejects busy→busy from detector even when stuck busy", () => {
    expect(shouldAcceptDetectorState(true, "busy", "busy", STALE_HOOK)).toBe(false);
  });
});
