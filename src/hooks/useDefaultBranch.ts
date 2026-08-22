import { useEffect, useState } from "react";
import { getDefaultBranch } from "../api";

// Module-level cache, one resolve per repo per session (mirrors
// useGithubUsername). A repo's default branch is stable enough that serving
// it synchronously beats flashing null for an invoke round-trip on every
// repoPath change and every override→null transition — consumers must never
// see a STALE OVERRIDE during that window, but the repo's cached default is
// exactly the right answer, not staleness.
const defaultBranchCache = new Map<string, string>();

/**
 * Fetches and caches the default branch for a repo path.
 * If `override` is provided (e.g. a stack parent), returns that instead.
 */
export function useDefaultBranch(
  repoPath: string | undefined,
  override?: string | null,
): string | null {
  const [branch, setBranch] = useState<string | null>(
    () => override ?? (repoPath ? defaultBranchCache.get(repoPath) ?? null : null),
  );

  useEffect(() => {
    if (override) {
      setBranch(override);
      return;
    }
    if (!repoPath) return;

    const known = defaultBranchCache.get(repoPath);
    // Reset synchronously (to the cached default, or null while genuinely
    // unknown) so a cleared override can't linger as a stale "default".
    setBranch(known ?? null);
    if (known) return;

    let cancelled = false;
    getDefaultBranch(repoPath)
      .then((b) => {
        if (b) defaultBranchCache.set(repoPath, b);
        if (!cancelled) setBranch(b);
      })
      .catch((e) => { console.warn("[useDefaultBranch] Failed to resolve:", e); });

    return () => { cancelled = true; };
  }, [repoPath, override]);

  return branch;
}
