import { debugLog } from "../api";

/**
 * Backoff delays (ms) between cold-start retries. The number of entries is
 * the number of *retries* — one initial attempt plus one per delay, so the
 * default is three total attempts.
 */
export const WORKTREE_RETRY_DELAYS_MS = [400, 800];

/**
 * Retry an async operation on a thrown error, bounded to `delaysMs.length + 1`
 * total attempts with backoff between them. Resolves with the operation's
 * result on the first success, or `null` if cancelled mid-flight or every
 * attempt threw.
 *
 * Backs the cold-start session-restore loaders (useSessionRestore Effect 1).
 * A single transient backend failure in the multi-repo startup burst — an Err
 * from `load_personal_config`, the libgit2 worktree enumeration, or
 * `getActiveBranch` while several repos load at once — used to leave a repo
 * missing from the sidebar for the whole session: each loader called its
 * backend once and the error branch was terminal (no retry, and Effect 1
 * doesn't re-fire on its own). Toggling the repo selection was the only
 * workaround.
 *
 * We deliberately retry only on a thrown error and return any *successful*
 * result as-is, including an empty one. A worktree-mode repo with no linked
 * worktrees legitimately enumerates to `[]` (libgit2 excludes the primary
 * checkout — see `git_manager::list_worktrees`), and that is the common case
 * for a freshly-added repo; a genuine transient surfaces as an Err, not as a
 * successful-but-empty result, so retrying empties would tax every empty repo
 * on every launch for no benefit. Callers decide what an empty success means.
 *
 * `isCancelled` is consulted before every attempt and before every backoff
 * wait, so a superseding effect run (the `cancelled` flag flipping in the
 * effect's cleanup) aborts the retries immediately.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  isCancelled: () => boolean,
  label: string,
  delaysMs: number[] = WORKTREE_RETRY_DELAYS_MS,
): Promise<T | null> {
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    if (isCancelled()) return null;

    try {
      return await operation();
    } catch (e) {
      console.warn(`[AppShell] ${label} attempt ${attempt + 1} failed:`, e);
    }

    // Only wait + retry while attempts remain. The final pass falls straight
    // through to `return null`.
    if (attempt < delaysMs.length) {
      if (isCancelled()) return null;
      debugLog(
        `[pin-diag] effect1 retry op=${label} nextAttempt=${attempt + 2} delayMs=${delaysMs[attempt]}`,
      ).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]));
    }
  }

  return null;
}
