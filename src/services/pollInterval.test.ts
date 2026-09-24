import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", () => ({
  setAttention: vi.fn(() => Promise.resolve()),
  debugLog: vi.fn(() => Promise.resolve()),
}));

import { startPollInterval } from "./pollInterval";
import { useAttentionStore } from "../stores/attentionStore";

// setState bypasses reportFocus's debounce on purpose: these tests pin the
// interval's reaction to a *landed* flip, not the debounce (attentionStore.test).
const focus = (focused: boolean) => useAttentionStore.setState({ focused });

describe("startPollInterval", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    focus(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs at focusedMs while focused and never on start", () => {
    const fn = vi.fn();
    const stop = startPollInterval(fn, 1_000);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3_000);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
  });

  it("runs at focusedMs × 10 while unfocused", () => {
    focus(false);
    const fn = vi.fn();
    const stop = startPollInterval(fn, 1_000);
    vi.advanceTimersByTime(9_999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });

  it("honours a custom multiplier", () => {
    focus(false);
    const fn = vi.fn();
    const stop = startPollInterval(fn, 1_000, { multiplier: 4 });
    vi.advanceTimersByTime(3_999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });

  it("re-arms at the slow rate when attention is lost", () => {
    const fn = vi.fn();
    const stop = startPollInterval(fn, 1_000);
    vi.advanceTimersByTime(500);
    focus(false);
    // The re-arm restarts the clock: a full 10 s from the flip, not 9.5 s.
    vi.advanceTimersByTime(9_999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });

  it("fires once immediately on focus regain, then resumes the focused rate", () => {
    focus(false);
    const fn = vi.fn();
    const stop = startPollInterval(fn, 1_000);
    focus(true);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(999);
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(2);
    stop();
  });

  it("ignores store updates that don't change focused", () => {
    const fn = vi.fn();
    const stop = startPollInterval(fn, 1_000);
    focus(true); // same value → no re-arm, no regain fire
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a throwing regain fire does not abort a later subscriber or escape the notify loop", () => {
    focus(false);
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const stopThrowing = startPollInterval(throwing, 1_000);
    const laterFn = vi.fn();
    const stopLater = startPollInterval(laterFn, 1_000);

    expect(() => focus(true)).not.toThrow();

    expect(throwing).toHaveBeenCalledTimes(1);
    // The subscriber registered after the throwing one must still fire.
    expect(laterFn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[poll] regain fire threw:", expect.any(Error));

    warn.mockRestore();
    stopThrowing();
    stopLater();
  });

  it("stop() clears the timer and the subscription", () => {
    const fn = vi.fn();
    const stop = startPollInterval(fn, 1_000);
    stop();
    vi.advanceTimersByTime(5_000);
    focus(false);
    focus(true);
    expect(fn).not.toHaveBeenCalled();
    stop(); // idempotent
  });
});
