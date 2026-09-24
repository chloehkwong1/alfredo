import { create } from "zustand";
import { setAttention, debugLog } from "../api";

/** Unfocused pollers run at `focusedMs × UNFOCUSED_MULTIPLIER` unless a
 *  site passes its own multiplier (the registry backstop uses 4). */
export const UNFOCUSED_MULTIPLIER = 10;

/** Alt-tab flicker must not thrash every poller in the app, so losing focus
 *  only "lands" after this long without a regain. Regaining is instant. */
export const UNFOCUS_DEBOUNCE_MS = 5_000;

interface AttentionState {
  /** Whether Alfredo's window has focus — the app's only attention signal
   *  (Tauri has no minimise/occlusion event; see the spec). Defaults to true
   *  so a webview reload can only make polling slower, never miss a cue. */
  focused: boolean;
  /** Feed a raw window focus event. Debounces unfocus, applies focus at
   *  once, and mirrors every landed flip into Rust via set_attention. */
  reportFocus: (focused: boolean) => void;
  /** Seed the store from the mount-time `isFocused()` read — never from a
   *  real focus event (`useAttentionSignal` is the only caller). Unlike
   *  `reportFocus`, this mirrors into Rust UNCONDITIONALLY, even when
   *  `focused` already matches the store's current value.
   *
   *  Why that matters: a fresh JS context always starts at `focused: true`
   *  (see the field doc above), but Rust can still be mirrored to `false`
   *  from a *previous* JS context — e.g. the webview reloaded (dev HMR, a
   *  WebKit crash-recovery reload) while the window was unfocused. If the
   *  seed then reads `true` and `reportFocus`'s "already true, do nothing"
   *  early return applied here too, Rust would stay desynced at `false`
   *  indefinitely: it self-heals only on the next full alt-tab out and back,
   *  while the window sits focused in the foreground the whole time. That
   *  early return is correct for `reportFocus` — it keeps redundant *real*
   *  focus events from firing IPC or waking subscribers, which matters for
   *  flicker — but a mount-time reading is not flicker, it is the one-time
   *  authoritative starting state, and skipping the mirror here is exactly
   *  the bug this closes.
   *
   *  Applies immediately, no debounce: the debounce exists to absorb alt-tab
   *  flicker, and a mount-time reading has none to absorb. */
  seedFocus: (focused: boolean) => void;
}

let unfocusTimer: ReturnType<typeof setTimeout> | null = null;

/** Cancel any armed unfocus debounce without touching `focused`. Safe to
 *  call when nothing is armed. Callers that tear down the listener feeding
 *  `reportFocus` (e.g. AppShell unmounting) must call this in their cleanup,
 *  or a stale timer can fire after remount and desync the mirrored Rust
 *  state from the window's real focus. */
export function cancelPendingUnfocus(): void {
  if (unfocusTimer === null) return;
  clearTimeout(unfocusTimer);
  unfocusTimer = null;
}

function mirrorToRust(focused: boolean) {
  setAttention(focused).catch((e) => {
    console.warn(`[attention] set_attention(${focused}) failed:`, e);
    debugLog(`[attention] set_attention(${focused}) failed: ${e}`).catch(() => {});
  });
}

/** Logs each *landed* flip to alfredo.log (console.warn does not reach it —
 *  only window.onerror/unhandledrejection are forwarded). Fire-and-forget. */
function logFlip(focused: boolean) {
  debugLog(`[attention] focused=${focused}`).catch(() => {});
}

export const useAttentionStore = create<AttentionState>((set, get) => ({
  focused: true,

  reportFocus: (focused) => {
    if (unfocusTimer !== null) {
      clearTimeout(unfocusTimer);
      unfocusTimer = null;
    }
    if (focused) {
      if (get().focused) return;
      // Mirror before set: mirrorToRust is fire-and-forget and never throws
      // synchronously, but a subscriber to `set` below (e.g. a poller's
      // regain fire) could — and Rust has no self-correction if that starves
      // the mirror call. See pollInterval.ts's regain-fire guard for the
      // other half of this.
      mirrorToRust(true);
      logFlip(true);
      set({ focused: true });
      return;
    }
    if (!get().focused) return;
    unfocusTimer = setTimeout(() => {
      unfocusTimer = null;
      mirrorToRust(false);
      logFlip(false);
      set({ focused: false });
    }, UNFOCUS_DEBOUNCE_MS);
  },

  seedFocus: (focused) => {
    if (unfocusTimer !== null) {
      clearTimeout(unfocusTimer);
      unfocusTimer = null;
    }
    // Unconditional — see the doc comment on `seedFocus` above for why this
    // must not early-return even when `focused` already matches.
    mirrorToRust(focused);
    logFlip(focused);
    set({ focused });
  },
}));
