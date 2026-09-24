import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../api", () => ({
  setAttention: vi.fn(() => Promise.resolve()),
  debugLog: vi.fn(() => Promise.resolve()),
}));

let isFocusedResolve: ((focused: boolean) => void) | null = null;
let focusChangedCallback: ((e: { payload: boolean }) => void) | null = null;
const unlisten = vi.fn();

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFocused: () =>
      new Promise<boolean>((resolve) => {
        isFocusedResolve = resolve;
      }),
    onFocusChanged: (cb: (e: { payload: boolean }) => void) => {
      focusChangedCallback = cb;
      return Promise.resolve(unlisten);
    },
  }),
}));

import { useAttentionSignal } from "./useAttentionSignal";
import { useAttentionStore, UNFOCUS_DEBOUNCE_MS, cancelPendingUnfocus } from "../../stores/attentionStore";
import { setAttention } from "../../api";

// Mounts the hook inside a real React tree — there's no @testing-library/react
// in this repo, so this drives react-dom/client + act directly (mirrors
// hooks/useReviewRequests.test.ts).
function Harness() {
  useAttentionSignal();
  return null;
}

async function mount(): Promise<Root> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Harness));
  });
  return root;
}

describe("useAttentionSignal", () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    isFocusedResolve = null;
    focusChangedCallback = null;
    unlisten.mockClear();
    vi.mocked(setAttention).mockClear();
    cancelPendingUnfocus();
    useAttentionStore.setState({ focused: true });
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root!.unmount();
      });
      root = null;
    }
    vi.useRealTimers();
  });

  it("a focus event reaches the store and mirrors true into Rust", async () => {
    useAttentionStore.setState({ focused: false });
    root = await mount();

    expect(focusChangedCallback).not.toBeNull();
    await act(async () => {
      focusChangedCallback?.({ payload: true });
    });

    expect(useAttentionStore.getState().focused).toBe(true);
    expect(setAttention).toHaveBeenCalledWith(true);
  });

  it("a blur event applies only after the debounce", async () => {
    root = await mount();
    // Let the isFocused() seed resolve to true first so we start focused.
    await act(async () => {
      isFocusedResolve?.(true);
    });

    await act(async () => {
      focusChangedCallback?.({ payload: false });
    });
    expect(useAttentionStore.getState().focused).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(UNFOCUS_DEBOUNCE_MS - 1);
    });
    expect(useAttentionStore.getState().focused).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(useAttentionStore.getState().focused).toBe(false);
    expect(setAttention).toHaveBeenCalledWith(false);
  });

  it("unmount unsubscribes the listener and cancels any pending unfocus", async () => {
    root = await mount();
    await act(async () => {
      isFocusedResolve?.(true);
    });

    await act(async () => {
      focusChangedCallback?.({ payload: false });
    });
    expect(useAttentionStore.getState().focused).toBe(true); // debounce armed, not landed yet

    await act(async () => {
      root!.unmount();
    });
    root = null; // prevent afterEach from unmounting a second time
    await Promise.resolve(); // flush the cleanup's unlisten.then(...)

    expect(unlisten).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(UNFOCUS_DEBOUNCE_MS * 2);
    // Never landed: unmount cancelled the pending debounce before it fired.
    expect(useAttentionStore.getState().focused).toBe(true);
    expect(setAttention).not.toHaveBeenCalledWith(false);
  });

  it("ignores a stale isFocused() resolution after a real focus event already landed", async () => {
    useAttentionStore.setState({ focused: false });
    root = await mount();

    // A real event arrives first (e.g. set_focus during webview load)...
    await act(async () => {
      focusChangedCallback?.({ payload: true });
    });
    expect(useAttentionStore.getState().focused).toBe(true);
    vi.mocked(setAttention).mockClear();

    // ...then the racing isFocused() seed resolves stale-false. It must be a no-op:
    // if the effect were unwired to ignore it, this assertion would fail.
    await act(async () => {
      isFocusedResolve?.(false);
    });

    // Advance past the unfocus debounce so a stale resolution that slipped
    // through would actually land (and fail these assertions) rather than
    // being masked by the debounce timer never firing before unmount.
    await act(async () => {
      vi.advanceTimersByTime(UNFOCUS_DEBOUNCE_MS);
    });

    expect(useAttentionStore.getState().focused).toBe(true);
    expect(setAttention).not.toHaveBeenCalled();
  });
});
