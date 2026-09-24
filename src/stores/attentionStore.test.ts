import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api", () => ({
  setAttention: vi.fn(() => Promise.resolve()),
  debugLog: vi.fn(() => Promise.resolve()),
}));

import { useAttentionStore, UNFOCUS_DEBOUNCE_MS, cancelPendingUnfocus } from "./attentionStore";
import { setAttention } from "../api";

const state = () => useAttentionStore.getState();

describe("attentionStore.reportFocus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // reportFocus(true) also cancels any debounce a previous test left armed.
    state().reportFocus(true);
    useAttentionStore.setState({ focused: true });
    vi.mocked(setAttention).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("unfocus lands only after the debounce, then mirrors to Rust", () => {
    state().reportFocus(false);
    expect(state().focused).toBe(true);
    expect(setAttention).not.toHaveBeenCalled();

    vi.advanceTimersByTime(UNFOCUS_DEBOUNCE_MS - 1);
    expect(state().focused).toBe(true);

    vi.advanceTimersByTime(1);
    expect(state().focused).toBe(false);
    expect(setAttention).toHaveBeenCalledTimes(1);
    expect(setAttention).toHaveBeenCalledWith(false);
  });

  it("a regain inside the window cancels the pending unfocus", () => {
    state().reportFocus(false);
    vi.advanceTimersByTime(UNFOCUS_DEBOUNCE_MS - 1_000);
    state().reportFocus(true);

    vi.advanceTimersByTime(UNFOCUS_DEBOUNCE_MS * 2);
    expect(state().focused).toBe(true);
    // Never actually went unfocused, so there was nothing to mirror.
    expect(setAttention).not.toHaveBeenCalled();
  });

  it("focus applies instantly and mirrors to Rust", () => {
    useAttentionStore.setState({ focused: false });
    state().reportFocus(true);
    expect(state().focused).toBe(true);
    expect(setAttention).toHaveBeenCalledTimes(1);
    expect(setAttention).toHaveBeenCalledWith(true);
  });

  it("repeated unfocus events restart the debounce instead of stacking", () => {
    state().reportFocus(false);
    vi.advanceTimersByTime(UNFOCUS_DEBOUNCE_MS - 1_000);
    state().reportFocus(false);

    vi.advanceTimersByTime(1_000);
    expect(state().focused).toBe(true);

    vi.advanceTimersByTime(UNFOCUS_DEBOUNCE_MS - 1_000);
    expect(state().focused).toBe(false);
    expect(setAttention).toHaveBeenCalledTimes(1);
  });

  it("a focus event while already focused is a no-op", () => {
    state().reportFocus(true);
    expect(setAttention).not.toHaveBeenCalled();
  });
});

describe("attentionStore.seedFocus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state().reportFocus(true);
    useAttentionStore.setState({ focused: true });
    vi.mocked(setAttention).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("mirrors to Rust even when the store already agrees — the regression this closes", () => {
    // Store is already `true` here. A `reportFocus`-style early return would
    // skip the mirror entirely; this is exactly what must not happen for a
    // mount-time seed re-asserting after e.g. a webview reload left Rust
    // desynced at `false`.
    state().seedFocus(true);
    expect(setAttention).toHaveBeenCalledTimes(1);
    expect(setAttention).toHaveBeenCalledWith(true);
    expect(state().focused).toBe(true);
  });

  it("applies immediately with no debounce, unlike an unfocus reportFocus", () => {
    state().seedFocus(false);
    // No timer advance at all — seedFocus is synchronous.
    expect(state().focused).toBe(false);
    expect(setAttention).toHaveBeenCalledTimes(1);
    expect(setAttention).toHaveBeenCalledWith(false);
  });

  it("cancels an armed unfocus debounce", () => {
    state().reportFocus(false);
    vi.advanceTimersByTime(1_000);
    vi.mocked(setAttention).mockClear();

    state().seedFocus(true);

    // The debounce that would have landed `false` must never fire.
    vi.advanceTimersByTime(UNFOCUS_DEBOUNCE_MS * 2);
    expect(state().focused).toBe(true);
    expect(setAttention).toHaveBeenCalledTimes(1);
    expect(setAttention).toHaveBeenCalledWith(true);
  });
});

describe("attentionStore.cancelPendingUnfocus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state().reportFocus(true);
    useAttentionStore.setState({ focused: true });
    vi.mocked(setAttention).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("cancels an armed unfocus so it never lands, even well past the debounce", () => {
    state().reportFocus(false);
    vi.advanceTimersByTime(1_000);

    cancelPendingUnfocus();

    vi.advanceTimersByTime(UNFOCUS_DEBOUNCE_MS * 10);
    expect(state().focused).toBe(true);
    expect(setAttention).not.toHaveBeenCalled();
  });

  it("is a no-op when nothing is armed", () => {
    expect(() => cancelPendingUnfocus()).not.toThrow();
    expect(state().focused).toBe(true);
    expect(setAttention).not.toHaveBeenCalled();
  });
});
