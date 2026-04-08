import { describe, it, expect } from "vitest";
import { shouldAcceptDetectorState } from "./sessionManager";

describe("shouldAcceptDetectorState", () => {
  it("accepts all states when hooks are not active", () => {
    expect(shouldAcceptDetectorState(false, "busy", "idle")).toBe(true);
    expect(shouldAcceptDetectorState(false, "idle", "idle")).toBe(true);
    expect(shouldAcceptDetectorState(false, "waitingForInput", "idle")).toBe(true);
    expect(shouldAcceptDetectorState(false, "notRunning", "idle")).toBe(true);
  });

  it("rejects detector states when hooks are active and not stuck busy", () => {
    expect(shouldAcceptDetectorState(true, "busy", "idle")).toBe(false);
    expect(shouldAcceptDetectorState(true, "idle", "idle")).toBe(false);
    expect(shouldAcceptDetectorState(true, "waitingForInput", "idle")).toBe(false);
    expect(shouldAcceptDetectorState(true, "notRunning", "idle")).toBe(false);
    expect(shouldAcceptDetectorState(true, "busy", "waitingForInput")).toBe(false);
    expect(shouldAcceptDetectorState(true, "notRunning", "busy")).toBe(false);
  });

  it("accepts idle/waitingForInput from detector when hooks active but stuck busy (interrupt fallback)", () => {
    expect(shouldAcceptDetectorState(true, "idle", "busy")).toBe(true);
    expect(shouldAcceptDetectorState(true, "waitingForInput", "busy")).toBe(true);
  });

  it("still rejects busy→busy from detector even when stuck busy", () => {
    expect(shouldAcceptDetectorState(true, "busy", "busy")).toBe(false);
  });
});
