import { create } from "zustand";
import { getAppConfig, setRepoColor as setRepoColorApi } from "../api";
import type { GlobalAppConfig } from "../types";
import { pickNextRepoColorId } from "../components/sidebar/RepoSelector";
import { useWorkspaceStore } from "./workspaceStore";

/**
 * Shared, single-instance cache of the global app config.
 *
 * Before: every component that called `useAppConfig` registered its own
 * `config-changed` listener and made an independent `getAppConfig()` IPC
 * call on every save — fanning out to 6 concurrent reads per dispatch.
 *
 * After: one store, one refetch per dispatch. Consumers subscribe through
 * `useAppConfig` (back-compat) or `useAppConfigValue(selector)` for slice
 * subscriptions. The `config-changed` listener lives once at the App root.
 */

interface AppConfigState {
  config: GlobalAppConfig | null;
  loading: boolean;
  error: string | null;
  /** True once the first fetch has been kicked off, so we don't double-fetch. */
  initialFetchStarted: boolean;
  /** Used by consumers (and the App-root listener) to refresh from disk. */
  refetch: () => Promise<void>;
  /** Sync mutation hook so callers that already hold a fresh GlobalAppConfig
   *  (e.g. after a saveAppConfig round-trip) can publish it without an
   *  extra IPC. */
  setConfig: (next: GlobalAppConfig) => void;
}

/** Assigns a chip colour to every repo missing one. Repos added before the
 *  palette rework have no saved colour and otherwise fall through to an
 *  index-based fallback that can collide with a sibling's saved legacy id. */
async function backfillRepoColors(c: GlobalAppConfig): Promise<GlobalAppConfig> {
  const missing = c.repos.filter((r) => !c.repoColors[r.path]);
  if (missing.length === 0) return c;
  let next = c;
  for (const repo of missing) {
    const colorId = pickNextRepoColorId(
      next.repoColors,
      next.repos.findIndex((r) => r.path === repo.path),
    );
    try {
      next = await setRepoColorApi(repo.path, colorId);
    } catch (e) {
      console.warn("backfill repo colour failed", repo.path, e);
    }
  }
  return next;
}

function syncWorkspaceArchiveSettings(c: GlobalAppConfig): void {
  useWorkspaceStore.setState({
    archiveAfterDays: c.archiveAfterDays ?? 2,
    deleteAfterDays: c.deleteAfterDays ?? 0,
  });
}

export const useAppConfigStore = create<AppConfigState>((set) => ({
  config: null,
  loading: true,
  error: null,
  initialFetchStarted: false,
  refetch: async () => {
    try {
      const c = await getAppConfig();
      // Backfill only runs meaningfully on the initial load; subsequent
      // refetches typically hit a config that already has every repo coloured.
      const migrated = await backfillRepoColors(c);
      // Sync default agent to localStorage so tabStore can read it
      // synchronously. Write "claude" when unset so stale localStorage
      // values from a previous session don't override the intended default.
      localStorage.setItem(
        "alfredo-default-agent",
        migrated.defaultAgent ?? "claude",
      );
      syncWorkspaceArchiveSettings(migrated);
      set({ config: migrated, loading: false, error: null });
    } catch (e) {
      set({
        error: e instanceof Error ? e.message : "Failed to load app config",
        loading: false,
      });
    }
  },
  setConfig: (next) => {
    syncWorkspaceArchiveSettings(next);
    set({ config: next, loading: false, error: null });
  },
}));

/**
 * Kicks off the first fetch lazily on the first hook subscription. Avoids
 * doing IPC at module-import time (which Vite HMR could re-trigger).
 */
function ensureInitialFetch(): void {
  if (useAppConfigStore.getState().initialFetchStarted) return;
  useAppConfigStore.setState({ initialFetchStarted: true });
  void useAppConfigStore.getState().refetch();
}

/**
 * Selector hook for subscribing to a slice of the app config store.
 *
 * Prefer this over destructuring the whole state object — it both avoids
 * unnecessary re-renders and prevents accidental stale-closure capture of
 * a `config` object reference.
 */
export function useAppConfigValue<T>(selector: (state: AppConfigState) => T): T {
  // Trigger the lazy initial fetch on first subscription. Cheap and idempotent.
  ensureInitialFetch();
  return useAppConfigStore(selector);
}
