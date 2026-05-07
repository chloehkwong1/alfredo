import { useState, useEffect, useCallback } from "react";
import {
  getRepoConfigLayers,
  writeAlfredoJson,
  resetRepoOverrides,
} from "../api";
import type { AppConfig, RepoOverrideFlags, RepoSharedConfig } from "../types";

function buildSharedPayload(config: AppConfig): RepoSharedConfig {
  return {
    ...(config.setupScripts != null && { setupScripts: config.setupScripts }),
    ...(config.runScript != null && { runScript: config.runScript }),
    ...(config.archiveScript != null && { archiveScript: config.archiveScript }),
    ...(config.portEnvVar != null && { portEnvVar: config.portEnvVar }),
    ...(config.portRangeStart != null && { portRangeStart: config.portRangeStart }),
    ...(config.portRangeEnd != null && { portRangeEnd: config.portRangeEnd }),
  };
}

export function useRepoConfig(repoPath: string | null | undefined): {
  config: AppConfig | null;
  overrides: RepoOverrideFlags | null;
  upstream: RepoSharedConfig | null;
  upstreamInGit: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  resetAll: () => Promise<void>;
  saveToAlfredoJson: () => Promise<void>;
  createAlfredoJson: () => Promise<void>;
} {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [overrides, setOverrides] = useState<RepoOverrideFlags | null>(null);
  const [upstream, setUpstream] = useState<RepoSharedConfig | null>(null);
  const [upstreamInGit, setUpstreamInGit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Core fetch — returns a promise so actions can await it.
  // Accepts a cancellation flag so stale in-flight fetches are ignored.
  const fetchLayers = useCallback(
    async (cancelled: { value: boolean }) => {
      if (!repoPath) {
        setConfig(null);
        setOverrides(null);
        setUpstream(null);
        setUpstreamInGit(false);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await getRepoConfigLayers(repoPath);
        if (cancelled.value) return;
        setConfig(result.effective);
        setOverrides(result.overrides);
        setUpstream(result.upstream);
        setUpstreamInGit(result.upstreamInGit);
        setLoading(false);
      } catch (e) {
        if (cancelled.value) return;
        console.error("useRepoConfig: failed to load config layers", e);
        setError(e instanceof Error ? e.message : "Failed to load repo config");
        setLoading(false);
      }
    },
    [repoPath],
  );

  // Initial fetch + re-fetch when repoPath changes. Cancel stale results.
  useEffect(() => {
    const cancelled = { value: false };
    fetchLayers(cancelled);
    return () => { cancelled.value = true; };
  }, [fetchLayers]);

  // Re-fetch on config-changed (cross-component sync, same pattern as useAppConfig).
  useEffect(() => {
    let currentCancelled = { value: false };
    const handler = () => {
      currentCancelled.value = true;
      currentCancelled = { value: false };
      void fetchLayers(currentCancelled);
    };
    window.addEventListener("config-changed", handler);
    return () => {
      currentCancelled.value = true;
      window.removeEventListener("config-changed", handler);
    };
  }, [fetchLayers]);

  // Re-fetch on window focus (picks up hand-edits to alfredo.json outside the app).
  useEffect(() => {
    let currentCancelled = { value: false };
    const handler = () => {
      currentCancelled.value = true;
      currentCancelled = { value: false };
      void fetchLayers(currentCancelled);
    };
    window.addEventListener("focus", handler);
    return () => {
      currentCancelled.value = true;
      window.removeEventListener("focus", handler);
    };
  }, [fetchLayers]);

  const refetch = useCallback(async () => {
    const cancelled = { value: false };
    await fetchLayers(cancelled);
  }, [fetchLayers]);

  const resetAll = useCallback(async () => {
    if (!repoPath) return;
    await resetRepoOverrides(repoPath);
    await refetch();
  }, [repoPath, refetch]);

  const saveToAlfredoJson = useCallback(async () => {
    if (!repoPath || !config) return;
    const payload = buildSharedPayload(config);
    await writeAlfredoJson(repoPath, payload);
    await resetRepoOverrides(repoPath);
    await refetch();
  }, [repoPath, config, refetch]);

  const createAlfredoJson = useCallback(async () => {
    if (!repoPath) return;
    const payload: RepoSharedConfig = config ? buildSharedPayload(config) : {};
    await writeAlfredoJson(repoPath, payload);
    await resetRepoOverrides(repoPath);
    await refetch();
  }, [repoPath, config, refetch]);

  return {
    config,
    overrides,
    upstream,
    upstreamInGit,
    loading,
    error,
    refetch,
    resetAll,
    saveToAlfredoJson,
    createAlfredoJson,
  };
}
