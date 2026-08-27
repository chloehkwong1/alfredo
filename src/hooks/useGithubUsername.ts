import { useEffect, useState } from "react";
import { githubAuthStatus } from "../api";

// Module-level cache: one `gh auth status` invoke per app session, shared by
// every sidebar row. Stays null while unresolved or when gh is
// unauthenticated — consumers (the adopt-stack cue's ownership gate) treat
// null as "fail closed", which is also the right answer mid-fetch.
let cached: string | null = null;
let fetchPromise: Promise<string | null> | null = null;

// Rows mounted while the fetch was failing would otherwise never hear about a
// later success — their effect ran once against null and nothing refires it
// (sidebar rows stay mounted across polls). Every interested row registers
// here; a resolving fetch broadcasts to all of them.
const subscribers = new Set<(username: string) => void>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const RETRY_MS = 30_000;

/** While rows are waiting and gh is unresolved, re-ask on a slow cadence —
 *  covers both the cold-launch keychain flake and `gh auth login` run
 *  mid-session. No subscribers → no polling. */
function scheduleRetry(): void {
  if (retryTimer !== null || subscribers.size === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (cached === null && subscribers.size > 0) void fetchUsername();
  }, RETRY_MS);
}

function fetchUsername(): Promise<string | null> {
  fetchPromise ??= githubAuthStatus()
    .then((s) => {
      cached = s.username;
      // Unauthenticated is retryable state, not a session-long fact: the user
      // may run `gh auth login` mid-session. Clear the latch so the next
      // mount (or the retry timer) re-asks instead of re-awaiting this
      // settled null forever.
      if (cached === null) {
        fetchPromise = null;
        scheduleRetry();
      } else {
        for (const notify of subscribers) notify(cached);
      }
      return cached;
    })
    .catch((e) => {
      // A transient flake (the keychain race at cold launch) must not
      // disable every username-gated surface until app restart — log it and
      // clear the latch so the next mount or the retry timer re-asks.
      console.warn("[useGithubUsername] gh auth status failed (will retry):", e);
      fetchPromise = null;
      scheduleRetry();
      return null;
    });
  return fetchPromise;
}

/** The authenticated GitHub login, fetched once per session (with slow
 *  retries while unresolved and rows are mounted). */
export function useGithubUsername(): string | null {
  const [username, setUsername] = useState<string | null>(cached);
  useEffect(() => {
    if (cached !== null) {
      // A row can mount between cache resolution and this effect running.
      setUsername(cached);
      return;
    }
    const notify = (u: string) => setUsername(u);
    subscribers.add(notify);
    void fetchUsername();
    return () => {
      subscribers.delete(notify);
    };
  }, []);
  return username;
}
