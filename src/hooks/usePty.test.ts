import { describe, it, expect } from "vitest";
import { computeStaleBusy, STALE_BUSY_MS } from "./usePty";

describe("computeStaleBusy", () => {
  const now = Date.now();

  it("returns false when output is recent", () => {
    expect(computeStaleBusy("busy", true, now - 5000, now)).toBe(false);
  });

  it("returns true when busy with no output for over 30s", () => {
    expect(computeStaleBusy("busy", true, now - (STALE_BUSY_MS + 1000), now)).toBe(true);
  });

  it("returns false when idle even with old output", () => {
    expect(computeStaleBusy("idle", true, now - (STALE_BUSY_MS + 1000), now)).toBe(false);
  });

  it("returns false when channel is dead", () => {
    expect(computeStaleBusy("busy", false, now - (STALE_BUSY_MS + 1000), now)).toBe(false);
  });

  it("returns false when lastOutputAt is 0 (no output yet)", () => {
    expect(computeStaleBusy("busy", true, 0, now)).toBe(false);
  });

  it("returns false for waitingForInput even with old output", () => {
    expect(computeStaleBusy("waitingForInput", true, now - (STALE_BUSY_MS + 1000), now)).toBe(false);
  });

  it("returns true at exactly STALE_BUSY_MS + 1", () => {
    expect(computeStaleBusy("busy", true, now - STALE_BUSY_MS - 1, now)).toBe(true);
  });

  it("returns false at exactly STALE_BUSY_MS", () => {
    expect(computeStaleBusy("busy", true, now - STALE_BUSY_MS, now)).toBe(false);
  });
});
