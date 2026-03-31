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
