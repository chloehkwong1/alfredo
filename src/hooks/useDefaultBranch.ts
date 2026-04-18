import { useEffect, useState } from "react";
import { getDefaultBranch } from "../api";

/**
 * Fetches and caches the default branch for a repo path.
 * If `override` is provided (e.g. a stack parent), returns that instead.
 */
export function useDefaultBranch(
  repoPath: string | undefined,
  override?: string | null,
): string | null {
  const [branch, setBranch] = useState<string | null>(override ?? null);

  useEffect(() => {
    if (override) {
      setBranch(override);
      return;
    }
    if (!repoPath) return;

    let cancelled = false;
    getDefaultBranch(repoPath)
      .then((b) => { if (!cancelled) setBranch(b); })
      .catch((e) => { console.warn("[useDefaultBranch] Failed to resolve:", e); });

    return () => { cancelled = true; };
  }, [repoPath, override]);

  return branch;
}
