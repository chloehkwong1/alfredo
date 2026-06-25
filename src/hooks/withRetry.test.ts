import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockDebugLog = vi.fn();

vi.mock("../api", () => ({
  debugLog: (...args: unknown[]) => mockDebugLog(...args),
}));

// Import AFTER mocks are declared (mirrors lifecycleManager.test.ts).
import { withRetry, WORKTREE_RETRY_DELAYS_MS } from "./withRetry";

// Zero-length backoff so the retry path runs instantly, while still tracking
// the real attempt count via the production schedule — if WORKTREE_RETRY_DELAYS_MS
// grows, the bounded-attempt assertions below grow with it.
const NO_DELAY = WORKTREE_RETRY_DELAYS_MS.map(() => 0);
const MAX_ATTEMPTS = NO_DELAY.length + 1;

beforeEach(() => {
  vi.resetAllMocks();
  mockDebugLog.mockResolvedValue(undefined);
  // The error-path tests exercise console.warn; silence it here and restore in
  // afterEach so a failing assertion can never leak the spy into later tests.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withRetry", () => {
  it("returns the result on the first success without retrying", async () => {
    const op = vi.fn().mockResolvedValue("ok");

    const result = await withRetry(op, () => false, "op", NO_DELAY);

    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("returns a successful empty result immediately without retrying", async () => {
    const op = vi.fn().mockResolvedValue([]);

    const result = await withRetry(op, () => false, "op", NO_DELAY);

    expect(result).toEqual([]);
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("retries after a transient thrown error and logs the retry", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("ok");

    const result = await withRetry(op, () => false, "op", NO_DELAY);

    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
    expect(mockDebugLog).toHaveBeenCalledWith(expect.stringContaining("retry"));
  });

  it("returns null after a bounded number of failing attempts, never looping", async () => {
    const op = vi.fn().mockRejectedValue(new Error("persistent"));

    const result = await withRetry(op, () => false, "op", NO_DELAY);

    expect(result).toBeNull();
    expect(op).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("aborts and returns null once cancelled", async () => {
    let cancelled = false;
    const op = vi.fn().mockImplementation(() => {
      // A superseding effect run flips the cancel flag while the first attempt
      // is in flight.
      cancelled = true;
      return Promise.reject(new Error("boom"));
    });

    const result = await withRetry(op, () => cancelled, "op", NO_DELAY);

    expect(result).toBeNull();
    // The cancel guard before the second attempt stops the retry loop.
    expect(op).toHaveBeenCalledTimes(1);
  });
});
