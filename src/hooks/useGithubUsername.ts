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
      return cached;
    })
    .catch(() => null);
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
