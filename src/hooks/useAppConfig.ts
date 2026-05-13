import { useCallback, useRef, useEffect, useState } from "react";
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
  setRepoShortLabel as setRepoShortLabelApi,
  setRepoColor as setRepoColorApi,
  setWorktreeLabel as setWorktreeLabelApi,
  setCommentChips as setCommentChipsApi,
} from "../api";
import { pickNextRepoColorId } from "../components/sidebar/RepoSelector";
import type { GlobalAppConfig, RepoMode } from "../types";
import { useAppConfigStore, useAppConfigValue } from "../stores/appConfigStore";

// Module-level serialization for updateConfig. Multiple useAppConfig
// instances (AppShell + Sidebar + dialogs) can race read-merge-write cycles
// on app.json. Without serialization, two concurrent updateConfig calls
// can both read the same pre-mutation snapshot, then their writes will
// last-writer-wins — clobbering each other's patches. This queue ensures
// each update sees the result of the previous one.
let updateConfigQueue: Promise<unknown> = Promise.resolve();

/**
 * Thin wrapper over `useAppConfigStore`. The store owns the cached config
 * and the single `config-changed` listener (registered once in App.tsx);
 * this hook preserves the legacy surface so existing callsites compile
 * unchanged. Prefer `useAppConfigValue(selector)` for new code.
 */
export function useAppConfig() {
  const config = useAppConfigValue((s) => s.config);
  const loading = useAppConfigValue((s) => s.loading);
  const error = useAppConfigValue((s) => s.error);
  // Local error state for client-side validation errors (addRepo etc.) that
  // shouldn't poison the shared store. Kept per-hook-instance so a validation
  // error on a Sidebar add-repo flow doesn't bleed into AppShell.
  const [localError, setLocalError] = useState<string | null>(null);

  // Mirror of `config` for use inside stable callbacks. Lets updateConfig /
  // updateRepoMode read cached state without re-creating the callback on every
  // config update — important for consumers like useStatePersistence that pass
  // the callback into a subscription effect.
  const configRef = useRef<GlobalAppConfig | null>(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const activeRepo = config?.activeRepo ?? null;
  const repos = config?.repos ?? [];

  const clearError = useCallback(() => setLocalError(null), []);

  const addRepo = useCallback(
    async (path: string, mode: RepoMode = "worktree") => {
      setLocalError(null);
      const valid = await validateGitRepo(path);
      if (!valid) {
        setLocalError("This folder isn't a git repository.");
        return null;
      }
      try {
        const updated = await addRepoApi(path, mode);
        // Auto-assign a chip colour from the first unused palette slot so the
        // new repo is immediately distinguishable in the sidebar. Don't clobber
        // an already-set colour (shouldn't happen on add, but cheap guard).
        let next = updated;
        if (!updated.repoColors[path]) {
          const nextColorId = pickNextRepoColorId(
            updated.repoColors,
            updated.repos.length - 1,
          );
          try {
            next = await setRepoColorApi(path, nextColorId);
          } catch (colorErr) {
            console.warn("auto-assign repo colour failed", colorErr);
          }
        }
        useAppConfigStore.getState().setConfig(next);
        return next;
      } catch (e) {
        setLocalError(e instanceof Error ? e.message : String(e));
        return null;
      }
    },
    [],
  );

  const updateConfig = useCallback(
    async (
      patchOrUpdater:
        | Partial<GlobalAppConfig>
        | ((prev: GlobalAppConfig) => Partial<GlobalAppConfig>),
    ) => {
      // Serialize through the module-level queue. Without this, two concurrent
      // calls (e.g. Sidebar unpin + useStatePersistence activeWorktreeId write)
      // can both read the same pre-mutation snapshot from disk and last-writer-
      // wins clobbers one of the patches. Reading fresh from disk inside the
      // critical section is necessary but not sufficient on its own — the reads
      // must also be ordered relative to each other's writes.
      //
      // The updater form (patchOrUpdater as function) is required for any patch
      // that derives from existing state (e.g. appending to showMainCardRepos):
      // it runs inside the critical section after the fresh disk read, so two
      // back-to-back pins from different components both see each other's writes.
      // The plain-object form is fine for full replacements.
      const next = updateConfigQueue.then(async () => {
        let current: GlobalAppConfig;
        try {
          current = await getAppConfig();
        } catch (e) {
          console.warn(
            "updateConfig: failed to refresh config before write, using cached state",
            e,
          );
          if (!configRef.current) return;
          current = configRef.current;
        }
        const patch =
          typeof patchOrUpdater === "function"
            ? patchOrUpdater(current)
            : patchOrUpdater;
        const updated = { ...current, ...patch };
        await saveAppConfig(updated);
        useAppConfigStore.getState().setConfig(updated);
        // Notify any DOM-level listeners (e.g. WorkspaceSettingsDialog which
        // still uses the event to refresh its per-repo `getConfig` snapshot).
        // The store itself listens once at the App root.
        window.dispatchEvent(new Event("config-changed"));
      });
      // Swallow errors on the queue so one failed write doesn't poison subsequent calls.
      updateConfigQueue = next.catch((e) => {
        console.warn("updateConfig: queued call failed", e);
      });
      return next;
    },
    [],
  );

  const removeRepo = useCallback(
    async (path: string) => {
      const updated = await removeRepoApi(path);
      useAppConfigStore.getState().setConfig(updated);
      // Prune the removed path from showMainCardRepos so app.json doesn't
      // accumulate dead pin entries across repo add/remove cycles. Goes through
      // updateConfig so it's serialized against any other concurrent writers.
      if ((updated.showMainCardRepos ?? []).includes(path)) {
        await updateConfig((prev) => ({
          showMainCardRepos: (prev.showMainCardRepos ?? []).filter(
            (p) => p !== path,
          ),
        }));
      }
      return updated;
    },
    [updateConfig],
  );

  const switchRepo = useCallback(async (path: string) => {
    await setActiveRepoApi(path);
    const prev = useAppConfigStore.getState().config;
    if (prev) {
      useAppConfigStore.getState().setConfig({ ...prev, activeRepo: path });
    }
  }, []);

  const updateRepoMode = useCallback(async (path: string, mode: RepoMode) => {
    // Read fresh to avoid clobbering fields another writer (dialog, backend
    // command) may have just persisted to disk. See updateConfig for rationale.
    let current: GlobalAppConfig;
    try {
      current = await getAppConfig();
    } catch (e) {
      console.warn(
        "updateRepoMode: failed to refresh config before write, using cached state",
        e,
      );
      if (!configRef.current) return;
      current = configRef.current;
    }
    const updated = {
      ...current,
      repos: current.repos.map((r) => (r.path === path ? { ...r, mode } : r)),
    };
    await saveAppConfig(updated);
    useAppConfigStore.getState().setConfig(updated);
  }, []);

  const toggleRepo = useCallback(
    async (path: string) => {
      if (!config) return;
      const current = config.selectedRepos ?? [];
      const next = current.includes(path)
        ? current.filter((p) => p !== path)
        : [...current, path];
      if (next.length === 0) return; // Don't allow deselecting all
      const updated = await setSelectedReposApi(next);
      useAppConfigStore.getState().setConfig(updated);
    },
    [config],
  );

  const setWorkspaceName = useCallback(async (name: string | null) => {
    const updated = await setDisplayNameApi(name);
    useAppConfigStore.getState().setConfig(updated);
  }, []);

  const setRepoDisplayName = useCallback(
    async (repoPath: string, name: string | null) => {
      const updated = await setRepoDisplayNameApi(repoPath, name);
      useAppConfigStore.getState().setConfig(updated);
    },
    [],
  );

  const setRepoShortLabel = useCallback(
    async (repoPath: string, label: string | null) => {
      const updated = await setRepoShortLabelApi(repoPath, label);
      useAppConfigStore.getState().setConfig(updated);
    },
    [],
  );

  const setRepoColor = useCallback(async (repoPath: string, color: string) => {
    const updated = await setRepoColorApi(repoPath, color);
    useAppConfigStore.getState().setConfig(updated);
  }, []);

  const setWorktreeLabel = useCallback(
    async (worktreePath: string, label: string | null) => {
      const updated = await setWorktreeLabelApi(worktreePath, label);
      useAppConfigStore.getState().setConfig(updated);
    },
    [],
  );

  const setCommentChips = useCallback(async (chips: string[]) => {
    const updated = await setCommentChipsApi(chips);
    useAppConfigStore.getState().setConfig(updated);
    window.dispatchEvent(new Event("config-changed"));
  }, []);

  return {
    config,
    loading,
    error: localError ?? error,
    clearError,
    activeRepo,
    repos,
    addRepo,
    removeRepo,
    switchRepo,
    updateRepoMode,
    updateConfig,
    selectedRepos: config?.selectedRepos ?? [],
    displayName: config?.displayName ?? null,
    repoColors: config?.repoColors ?? {},
    repoDisplayNames: config?.repoDisplayNames ?? {},
    repoShortLabels: config?.repoShortLabels ?? {},
    worktreeLabels: config?.worktreeLabels ?? {},
    toggleRepo,
    setWorkspaceName,
    setRepoDisplayName,
    setRepoShortLabel,
    setRepoColor,
    setWorktreeLabel,
    setCommentChips,
  } as const;
}

