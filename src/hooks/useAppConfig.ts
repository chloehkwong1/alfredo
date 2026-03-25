import { useState, useEffect, useCallback } from "react";
import {
  getAppConfig,
  saveAppConfig,
  addRepo as addRepoApi,
  removeRepo as removeRepoApi,
  setActiveRepo as setActiveRepoApi,
  validateGitRepo,
} from "../api";
import type { GlobalAppConfig, RepoMode } from "../types";

export function useAppConfig() {
  const [config, setConfig] = useState<GlobalAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAppConfig()
      .then((c) => {
        if (!cancelled) {
          setConfig(c);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load app config");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  const activeRepo = config?.activeRepo ?? null;
  const repos = config?.repos ?? [];

  const addRepo = useCallback(async (path: string, mode: RepoMode = "branch") => {
    setError(null);
    const valid = await validateGitRepo(path);
    if (!valid) {
      setError("This folder isn't a git repository.");
      return null;
    }
    try {
      const updated = await addRepoApi(path, mode);
      setConfig(updated);
      return updated;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const removeRepo = useCallback(async (path: string) => {
    const updated = await removeRepoApi(path);
    setConfig(updated);
    return updated;
  }, []);

  const switchRepo = useCallback(async (path: string) => {
    await setActiveRepoApi(path);
    setConfig((prev) =>
      prev ? { ...prev, activeRepo: path } : prev,
    );
  }, []);

  const updateRepoMode = useCallback(async (path: string, mode: RepoMode) => {
    if (!config) return;
    const updated = {
      ...config,
      repos: config.repos.map((r) =>
        r.path === path ? { ...r, mode } : r,
      ),
    };
    await saveAppConfig(updated);
    setConfig(updated);
  }, [config]);

  const updateGlobalSettings = useCallback(async (patch: Partial<Pick<GlobalAppConfig, "theme" | "notifications">>) => {
    if (!config) return;
    const updated = { ...config, ...patch };
    await saveAppConfig(updated);
    setConfig(updated);
  }, [config]);

  const clearError = useCallback(() => setError(null), []);

  return {
    config,
    loading,
    error,
    clearError,
    activeRepo,
    repos,
    addRepo,
    removeRepo,
    switchRepo,
    updateRepoMode,
    updateGlobalSettings,
  } as const;
}
