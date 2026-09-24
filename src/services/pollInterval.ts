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
    if (state.focused) fn();
  });

  return () => {
    unsubscribe();
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
}
