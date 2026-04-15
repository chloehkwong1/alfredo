import { useState, useEffect, useCallback } from "react";
import {
  getAppConfig,
  saveAppConfig,
  addRepo as addRepoApi,
  removeRepo as removeRepoApi,
  setActiveRepo as setActiveRepoApi,
  validateGitRepo,
  setSelectedRepos as setSelectedReposApi,
  setDisplayName as setDisplayNameApi,
  setRepoDisplayName as setRepoDisplayNameApi,
  setWorktreeLabel as setWorktreeLabelApi,
  setCommentChips as setCommentChipsApi,
} from "../api";
import type { GlobalAppConfig, RepoMode } from "../types";
import { useWorkspaceStore } from "../stores/workspaceStore";

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
          // Sync default agent to localStorage so tabStore can read it
          // synchronously. Write "claude" when unset so stale localStorage
          // values from a previous session don't override the intended default.
          localStorage.setItem("alfredo-default-agent", c.defaultAgent ?? "claude");
          // Sync archive/delete settings to workspace store
          useWorkspaceStore.setState({
            archiveAfterDays: c.archiveAfterDays ?? 2,
            deleteAfterDays: c.deleteAfterDays ?? 0,
          });
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

  // Re-fetch when config changes (e.g. mode switch from settings dialog)
  useEffect(() => {
    const handler = () => {
      getAppConfig().then((c) => {
        setConfig(c);
        useWorkspaceStore.setState({
          archiveAfterDays: c.archiveAfterDays ?? 2,
          deleteAfterDays: c.deleteAfterDays ?? 0,
        });
      }).catch((e) => console.error("Failed to reload app config:", e));
    };
    window.addEventListener("config-changed", handler);
    return () => window.removeEventListener("config-changed", handler);
  }, []);

  const activeRepo = config?.activeRepo ?? null;
  const repos = config?.repos ?? [];

  const addRepo = useCallback(async (path: string, mode: RepoMode = "worktree") => {
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

  const updateConfig = useCallback(async (patch: Partial<GlobalAppConfig>) => {
    if (!config) return;
    const updated = { ...config, ...patch };
    await saveAppConfig(updated);
    setConfig(updated);
  }, [config]);

  const clearError = useCallback(() => setError(null), []);

  const toggleRepo = useCallback(async (path: string) => {
    if (!config) return;
    const current = config.selectedRepos ?? [];
    const next = current.includes(path)
      ? current.filter((p) => p !== path)
      : [...current, path];
    if (next.length === 0) return; // Don't allow deselecting all
    const updated = await setSelectedReposApi(next);
    setConfig(updated);
  }, [config]);

  const setWorkspaceName = useCallback(async (name: string | null) => {
    const updated = await setDisplayNameApi(name);
    setConfig(updated);
  }, []);

  const setRepoDisplayName = useCallback(async (repoPath: string, name: string | null) => {
    const updated = await setRepoDisplayNameApi(repoPath, name);
    setConfig(updated);
  }, []);

  const setWorktreeLabel = useCallback(async (worktreePath: string, label: string | null) => {
    const updated = await setWorktreeLabelApi(worktreePath, label);
    setConfig(updated);
  }, []);

  const setCommentChips = useCallback(async (chips: string[]) => {
    const updated = await setCommentChipsApi(chips);
    setConfig(updated);
    window.dispatchEvent(new Event("config-changed"));
  }, []);

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
    updateConfig,
    selectedRepos: config?.selectedRepos ?? [],
    displayName: config?.displayName ?? null,
    repoColors: config?.repoColors ?? {},
    repoDisplayNames: config?.repoDisplayNames ?? {},
    worktreeLabels: config?.worktreeLabels ?? {},
    toggleRepo,
    setWorkspaceName,
    setRepoDisplayName,
    setWorktreeLabel,
    setCommentChips,
  } as const;
}
