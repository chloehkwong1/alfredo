import { describe, it, expect } from "vitest";
import { shouldAcceptDetectorState } from "./sessionManager";

describe("shouldAcceptDetectorState", () => {
  it("accepts all states when hooks are not active", () => {
    expect(shouldAcceptDetectorState(false, "busy")).toBe(true);
    expect(shouldAcceptDetectorState(false, "idle")).toBe(true);
    expect(shouldAcceptDetectorState(false, "waitingForInput")).toBe(true);
    expect(shouldAcceptDetectorState(false, "notRunning")).toBe(true);
  });

  it("rejects all detector states when hooks are active", () => {
    expect(shouldAcceptDetectorState(true, "busy")).toBe(false);
    expect(shouldAcceptDetectorState(true, "idle")).toBe(false);
    expect(shouldAcceptDetectorState(true, "waitingForInput")).toBe(false);
    expect(shouldAcceptDetectorState(true, "notRunning")).toBe(false);
  });
});
