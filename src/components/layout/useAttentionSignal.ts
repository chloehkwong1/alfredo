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
 */
export function useAttentionSignal(): void {
  useEffect(() => {
    const { reportFocus } = useAttentionStore.getState();
    let sawRealEvent = false;
    getCurrentWindow()
      .isFocused()
      .then((focused) => {
        if (sawRealEvent) return;
        reportFocus(focused);
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
