import { useState, useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { validateGitRepo } from "../api";

const STORE_FILE = "app-settings.json";
const STORE_KEY = "repoPath";

export function useRepoPath() {
  const [repoPath, setRepoPathState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Load persisted path on mount and validate it
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const store = await load(STORE_FILE);
        const stored = await store.get<string>(STORE_KEY);
        if (!stored) {
          if (!cancelled) setLoading(false);
          return;
        }

        const valid = await validateGitRepo(stored);
        if (!cancelled) {
          if (valid) {
            setRepoPathState(stored);
          } else {
            // Stale path — silently discard
            await store.delete(STORE_KEY);
            await store.save();
          }
          setLoading(false);
        }
      } catch {
        // Store not available (e.g., running in browser without Tauri)
        if (!cancelled) setLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const setRepoPath = useCallback(async (path: string) => {
    setError(null);
    try {
      const valid = await validateGitRepo(path);
      if (valid) {
        const store = await load(STORE_FILE);
        await store.set(STORE_KEY, path);
        await store.save();
        setRepoPathState(path);
      } else {
        setError("This folder isn't a git repository.");
      }
    } catch {
      setError("This folder isn't a git repository.");
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { repoPath, setRepoPath, error, clearError, loading } as const;
}
