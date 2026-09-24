import { create } from "zustand";
import { setAttention } from "../api";

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
}

let unfocusTimer: ReturnType<typeof setTimeout> | null = null;

function mirrorToRust(focused: boolean) {
  setAttention(focused).catch((e) =>
    console.warn(`[attention] set_attention(${focused}) failed:`, e),
  );
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
      set({ focused: true });
      mirrorToRust(true);
      return;
    }
    if (!get().focused) return;
    unfocusTimer = setTimeout(() => {
      unfocusTimer = null;
      set({ focused: false });
      mirrorToRust(false);
    }, UNFOCUS_DEBOUNCE_MS);
  },
}));
