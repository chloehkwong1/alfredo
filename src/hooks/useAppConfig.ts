import { useState, useEffect, useCallback, useRef } from "react";
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
import { useWorkspaceStore } from "../stores/workspaceStore";

// Module-level serialization for updateConfig. Multiple useAppConfig
// instances (AppShell + Sidebar + dialogs) can race read-merge-write cycles
// on app.json. Without serialization, two concurrent updateConfig calls
// can both read the same pre-mutation snapshot, then their writes will
// last-writer-wins — clobbering each other's patches. This queue ensures
// each update sees the result of the previous one.
let updateConfigQueue: Promise<unknown> = Promise.resolve();

/** Assigns a chip colour to every repo missing one. Repos added before the
 *  palette rework have no saved colour and otherwise fall through to an
 *  index-based fallback that can collide with a sibling's saved legacy id. */
async function backfillRepoColors(c: GlobalAppConfig): Promise<GlobalAppConfig> {
  const missing = c.repos.filter((r) => !c.repoColors[r.path]);
  if (missing.length === 0) return c;
  let next = c;
  for (const repo of missing) {
    const colorId = pickNextRepoColorId(next.repoColors, next.repos.findIndex((r) => r.path === repo.path));
    try {
      next = await setRepoColorApi(repo.path, colorId);
    } catch (e) {
      console.warn("backfill repo colour failed", repo.path, e);
    }
  }
  return next;
}

export function useAppConfig() {
  const [config, setConfig] = useState<GlobalAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Mirror of `config` for use inside stable callbacks. Lets updateConfig /
  // updateRepoMode read cached state without re-creating the callback on every
  // config update — important for consumers like useStatePersistence that pass
  // the callback into a subscription effect.
  const configRef = useRef<GlobalAppConfig | null>(null);
  useEffect(() => { configRef.current = config; }, [config]);

  useEffect(() => {
    let cancelled = false;
    getAppConfig()
      .then(async (c) => {
        if (cancelled) return;
        // Backfill chip colours for any repo that predates the palette rework
        // and has no saved colour. Without this they fall through to an index
        // fallback that can collide with another repo's saved legacy id.
        const migrated = await backfillRepoColors(c);
        if (cancelled) return;
        setConfig(migrated);
        // Sync default agent to localStorage so tabStore can read it
        // synchronously. Write "claude" when unset so stale localStorage
        // values from a previous session don't override the intended default.
        localStorage.setItem("alfredo-default-agent", migrated.defaultAgent ?? "claude");
        // Sync archive/delete settings to workspace store
        useWorkspaceStore.setState({
          archiveAfterDays: migrated.archiveAfterDays ?? 2,
          deleteAfterDays: migrated.deleteAfterDays ?? 0,
        });
        setLoading(false);
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
      // Auto-assign a chip colour from the first unused palette slot so the
      // new repo is immediately distinguishable in the sidebar. Don't clobber
      // an already-set colour (shouldn't happen on add, but cheap guard).
      let next = updated;
      if (!updated.repoColors[path]) {
        const nextColorId = pickNextRepoColorId(updated.repoColors, updated.repos.length - 1);
        try {
          next = await setRepoColorApi(path, nextColorId);
        } catch (colorErr) {
          console.warn("auto-assign repo colour failed", colorErr);
        }
      }
      setConfig(next);
      return next;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  const updateConfig = useCallback(async (
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
        console.warn("updateConfig: failed to refresh config before write, using cached state", e);
        if (!configRef.current) return;
        current = configRef.current;
      }
      const patch = typeof patchOrUpdater === "function"
        ? patchOrUpdater(current)
        : patchOrUpdater;
      const updated = { ...current, ...patch };
      await saveAppConfig(updated);
      setConfig(updated);
      // useAppConfig is mounted in multiple components (AppShell + Sidebar),
      // each with its own useState. The event tells the other instances to
      // re-fetch so a write made via one instance is observable by the other —
      // notably for showMainCardRepos: Sidebar pins, AppShell's useSessionRestore
      // needs to see the change to insert the synthetic main-card worktree.
      window.dispatchEvent(new Event("config-changed"));
    });
    // Swallow errors on the queue so one failed write doesn't poison subsequent calls.
    updateConfigQueue = next.catch((e) => {
      console.warn("updateConfig: queued call failed", e);
    });
    return next;
  }, []);

  const removeRepo = useCallback(async (path: string) => {
    const updated = await removeRepoApi(path);
    setConfig(updated);
    // Prune the removed path from showMainCardRepos so app.json doesn't
    // accumulate dead pin entries across repo add/remove cycles. Goes through
    // updateConfig so it's serialized against any other concurrent writers.
    if ((updated.showMainCardRepos ?? []).includes(path)) {
      await updateConfig((prev) => ({
        showMainCardRepos: (prev.showMainCardRepos ?? []).filter((p) => p !== path),
      }));
    }
    return updated;
  }, [updateConfig]);

  const switchRepo = useCallback(async (path: string) => {
    await setActiveRepoApi(path);
    setConfig((prev) =>
      prev ? { ...prev, activeRepo: path } : prev,
    );
  }, []);

  const updateRepoMode = useCallback(async (path: string, mode: RepoMode) => {
    // Read fresh to avoid clobbering fields another writer (dialog, backend
    // command) may have just persisted to disk. See updateConfig for rationale.
    let current: GlobalAppConfig;
    try {
      current = await getAppConfig();
    } catch (e) {
      console.warn("updateRepoMode: failed to refresh config before write, using cached state", e);
      if (!configRef.current) return;
      current = configRef.current;
    }
    const updated = {
      ...current,
      repos: current.repos.map((r) =>
        r.path === path ? { ...r, mode } : r,
      ),
    };
    await saveAppConfig(updated);
    setConfig(updated);
  }, []);

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

  const setRepoShortLabel = useCallback(async (repoPath: string, label: string | null) => {
    const updated = await setRepoShortLabelApi(repoPath, label);
    setConfig(updated);
  }, []);

  const setRepoColor = useCallback(async (repoPath: string, color: string) => {
    const updated = await setRepoColorApi(repoPath, color);
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
