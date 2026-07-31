import { useCallback, useEffect, useRef, useState } from "react";
import { getWhatsNew, markWhatsNewSeen } from "../api";
import type { WhatsNewEntry } from "../types";
import { useAppConfigStore, useAppConfigValue } from "../stores/appConfigStore";

export interface WhatsNewDecision {
  show: boolean;
  entries: WhatsNewEntry[];
  /** When set, persist this marker silently without showing the dialog. */
  seedVersion: string | null;
}

/** Numeric `major.minor.patch` compare. Unparseable segments count as 0. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const segs = v.split(".");
    return [0, 1, 2].map((i) => {
      const n = Number(segs[i]);
      return Number.isFinite(n) ? n : 0;
    });
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

export function newestVersion(entries: WhatsNewEntry[]): string | null {
  if (entries.length === 0) return null;
  return entries.reduce(
    (max, e) => (compareVersions(e.version, max) > 0 ? e.version : max),
    entries[0].version,
  );
}

/**
 * Decide whether to pop the dialog, and with which entries.
 *
 * A fresh install has no marker AND no repos — that user is being onboarded,
 * not caught up, so seed the marker silently. An existing user with no marker
 * is upgrading into this feature for the first time and sees everything.
 */
export function decideWhatsNew({
  entries,
  lastSeen,
  repoCount,
}: {
  entries: WhatsNewEntry[];
  lastSeen: string | null;
  repoCount: number;
}): WhatsNewDecision {
  const newest = newestVersion(entries);
  if (newest === null) return { show: false, entries: [], seedVersion: null };

  if (lastSeen === null) {
    if (repoCount === 0) return { show: false, entries: [], seedVersion: newest };
    return { show: true, entries, seedVersion: null };
  }

  const missed = entries.filter((e) => compareVersions(e.version, lastSeen) > 0);
  if (missed.length === 0) return { show: false, entries: [], seedVersion: null };
  return { show: true, entries: missed, seedVersion: null };
}

/**
 * Claims the "act now" slot exactly once for a `{ current: boolean }` ref,
 * refusing the claim if already cancelled or already claimed.
 *
 * This is not just a React-StrictMode dev-mode concern — it is
 * production-reachable. `useStatePersistence` writes `activeWorktreeId` via
 * `updateConfig` shortly after launch, which replaces the store's config
 * object identity; if that lands inside this effect's `getWhatsNew()` await
 * window, `config` in the deps array changes, the in-flight effect run is
 * cancelled, and a second run starts. Whichever invocation's promise settles
 * first must not win the claim just by finishing first — only a
 * non-cancelled invocation may claim it. Claiming only here, after the async
 * work settles and with the invocation's own `cancelled` flag in hand, means
 * any cancelled invocation (StrictMode's phantom double-invoke, or the real
 * production race above) can never win the claim, regardless of settle order.
 * A naive guard that claims *before* the await would let a cancelled
 * invocation grab the slot first and silently suppress the popup.
 */
export function claimOnce(ref: { current: boolean }, cancelled: boolean): boolean {
  if (cancelled || ref.current) return false;
  ref.current = true;
  return true;
}

export function useWhatsNew() {
  const config = useAppConfigValue((s) => s.config);
  const [entries, setEntries] = useState<WhatsNewEntry[]>([]);
  const [open, setOpen] = useState(false);
  // Set once a decision has actually been committed (see claimOnce), so a
  // later config-changed refetch's effect run bails out at the top here
  // without re-fetching or re-deciding.
  const decidedRef = useRef(false);

  useEffect(() => {
    if (decidedRef.current || !config) return;
    let cancelled = false;

    void (async () => {
      let fetched: WhatsNewEntry[];
      try {
        fetched = await getWhatsNew();
      } catch (e) {
        console.error("[whats-new] fetch failed:", e);
        return;
      }
      // Must stay AFTER the `await` above — claiming before it would let a
      // cancelled invocation win the slot and silently suppress the popup,
      // with every existing test still green. See claimOnce's doc comment.
      if (!claimOnce(decidedRef, cancelled)) return;

      const decision = decideWhatsNew({
        entries: fetched,
        lastSeen: config.whatsNewLastSeen ?? null,
        repoCount: config.repos.length,
      });

      if (decision.seedVersion) {
        markWhatsNewSeen(decision.seedVersion)
          .then((next) => useAppConfigStore.getState().setConfig(next))
          .catch((e) => console.error("[whats-new] seed failed:", e));
        return;
      }
      if (decision.show) {
        setEntries(decision.entries);
        setOpen(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [config]);

  const dismiss = useCallback(() => {
    setOpen(false);
    const newest = newestVersion(entries);
    if (newest) {
      markWhatsNewSeen(newest)
        .then((next) => useAppConfigStore.getState().setConfig(next))
        .catch((e) => console.error("[whats-new] mark seen failed:", e));
    }
  }, [entries]);

  return { entries, open, dismiss };
}
