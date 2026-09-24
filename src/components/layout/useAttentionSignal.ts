import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useAttentionStore, cancelPendingUnfocus } from "../../stores/attentionStore";

/**
 * Wires the window's native focus signal into the attention store — the sole
 * production caller of `reportFocus` (see stores/attentionStore and
 * services/pollInterval for what this feeds). This is the one focus listener
 * that *pauses* work; the others in the codebase (useGithubSync, TerminalView)
 * only add work on regain.
 *
 * `onFocusChanged` returns a Promise, so an event arriving during listener
 * registration would otherwise be lost, while the `isFocused()` seed read
 * resolves independently and can land AFTER a real event already has. If the
 * window gained focus inside that gap — plausible on an `alfredo://` deep-link
 * launch or a single-instance relaunch, where Rust calls `set_focus` around
 * webview load — the stale seed would apply a stale `false`, arm the unfocus
 * debounce, and leave the app polling at a tenth rate while sitting focused in
 * the foreground, self-healing only on the next real alt-tab. `sawRealEvent`
 * makes the seed a no-op once a real event has been observed.
 *
 * The seed read uses `seedFocus`, not `reportFocus`: it must mirror into
 * Rust even when the store's starting value already agrees (see
 * `seedFocus`'s doc comment in attentionStore for why — in short, a fresh JS
 * context always starts `focused: true`, but Rust can still be mirrored
 * `false` from before a webview reload).
 */
export function useAttentionSignal(): void {
  useEffect(() => {
    const { reportFocus, seedFocus } = useAttentionStore.getState();
    let sawRealEvent = false;
    getCurrentWindow()
      .isFocused()
      .then((focused) => {
        if (sawRealEvent) return;
        seedFocus(focused);
      })
      .catch(() => {});
    const unlisten = getCurrentWindow().onFocusChanged(({ payload }) => {
      sawRealEvent = true;
      reportFocus(payload);
    });
    return () => {
      unlisten.then((fn) => fn());
      cancelPendingUnfocus();
    };
  }, []);
}
