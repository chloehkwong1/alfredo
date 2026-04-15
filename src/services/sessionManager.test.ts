import { describe, it, expect } from "vitest";
import { shouldAcceptDetectorState } from "./sessionManager";

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
