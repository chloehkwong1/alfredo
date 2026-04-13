import { describe, it, expect } from "vitest";
import { shouldAcceptDetectorState } from "./sessionManager";

describe("shouldAcceptDetectorState", () => {
  it("accepts detector events when hooks are not active", () => {
    expect(shouldAcceptDetectorState(false)).toBe(true);
  });

  it("rejects detector events when hooks are active", () => {
    expect(shouldAcceptDetectorState(true)).toBe(false);
  });
});
