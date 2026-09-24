import { useAttentionStore, UNFOCUSED_MULTIPLIER } from "../stores/attentionStore";

export interface PollIntervalOptions {
  /** Unfocused slowdown factor. Defaults to UNFOCUSED_MULTIPLIER (10). */
  multiplier?: number;
}

/**
 * `setInterval` that follows window attention.
 *
 * Runs `fn` every `focusedMs` while Alfredo is focused and every
 * `focusedMs × multiplier` while it is not, re-arms when attention flips, and
 * fires `fn` once immediately on focus regain so nothing looks stale.
 * Like `setInterval`, it never fires on start. Returns the stop function —
 * call it where you would have called `clearInterval`.
 *
 * Drop-in for the raw `setInterval` inside an effect or a service; keep the
 * effect's own `cancelled` flag and initial fetch exactly as they were.
 */
export function startPollInterval(
  fn: () => void,
  focusedMs: number,
  opts: PollIntervalOptions = {},
): () => void {
  const multiplier = opts.multiplier ?? UNFOCUSED_MULTIPLIER;
  let timer: ReturnType<typeof setInterval> | null = null;

  const arm = (focused: boolean) => {
    if (timer !== null) clearInterval(timer);
    timer = setInterval(fn, focused ? focusedMs : focusedMs * multiplier);
  };

  arm(useAttentionStore.getState().focused);
  const unsubscribe = useAttentionStore.subscribe((state, prev) => {
    if (state.focused === prev.focused) return;
    arm(state.focused);
    // zustand 5's notify loop is a bare forEach with no try/catch (see
    // node_modules/zustand/esm/vanilla.mjs) — an uncaught throw here would
    // abort every subscriber registered after this one AND propagate out of
    // the store's `set({ focused: true })`, so mirrorToRust never runs and
    // the Rust attention flag desyncs with no self-heal. The interval's own
    // `fn` is NOT wrapped like this — that callback is already isolated by
    // the event loop, and hiding its errors would be a regression.
    if (state.focused) {
      try {
        fn();
      } catch (e) {
        console.warn("[poll] regain fire threw:", e);
      }
    }
  });

  return () => {
    unsubscribe();
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
}
