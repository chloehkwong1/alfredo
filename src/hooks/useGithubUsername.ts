import { useEffect, useState } from "react";
import { githubAuthStatus } from "../api";

// Module-level cache: one `gh auth status` invoke per app session, shared by
// every sidebar row. Stays null while unresolved or when gh is
// unauthenticated — consumers (the adopt-stack cue's ownership gate) treat
// null as "fail closed", which is also the right answer mid-fetch.
let cached: string | null = null;
let fetchPromise: Promise<string | null> | null = null;

function fetchUsername(): Promise<string | null> {
  fetchPromise ??= githubAuthStatus()
    .then((s) => {
      cached = s.username;
      // Unauthenticated is retryable state, not a session-long fact: the user
      // may run `gh auth login` mid-session. Clear the latch so the next
      // mount re-asks instead of re-awaiting this settled null forever.
      if (cached === null) fetchPromise = null;
      return cached;
    })
    .catch((e) => {
      // A transient flake (the keychain race at cold launch) must not
      // disable every username-gated surface until app restart — log it and
      // clear the latch so the next mount retries.
      console.warn("[useGithubUsername] gh auth status failed (will retry on next mount):", e);
      fetchPromise = null;
      return null;
    });
  return fetchPromise;
}

/** The authenticated GitHub login, fetched once per session. */
export function useGithubUsername(): string | null {
  const [username, setUsername] = useState<string | null>(cached);
  useEffect(() => {
    if (cached !== null) return;
    let cancelled = false;
    fetchUsername().then((u) => {
      if (!cancelled && u !== null) setUsername(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return username;
}
