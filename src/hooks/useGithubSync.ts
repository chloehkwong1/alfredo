import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { PrUpdatePayload } from "../types";
import { useWorkspaceStore } from "../stores/workspaceStore";

/**
 * Listens for `github:pr-update` events from the Rust background sync loop
 * and applies PR status updates to the workspace store.
 * Also auto-archives Done worktrees whose PRs were merged more than
 * `archiveAfterDays` ago.
 */
export function useGithubSync() {
  const applyPrUpdates = useWorkspaceStore((s) => s.applyPrUpdates);

  useEffect(() => {
    const unlisten = listen<PrUpdatePayload>("github:pr-update", (event) => {
      applyPrUpdates(event.payload.prs);

      // Auto-archive check: batch-archive Done worktrees with expired mergedAt
      const state = useWorkspaceStore.getState();
      const archiveAfterMs = state.archiveAfterDays * 24 * 60 * 60 * 1000;
      const now = Date.now();

      const toArchive = state.worktrees
        .filter((wt) =>
          wt.column === "done" &&
          !wt.archived &&
          wt.prStatus?.mergedAt &&
          now - new Date(wt.prStatus.mergedAt).getTime() >= archiveAfterMs
        )
        .map((wt) => wt.id);

      if (toArchive.length > 0) {
        useWorkspaceStore.setState((s) => ({
          worktrees: s.worktrees.map((wt) =>
            toArchive.includes(wt.id) ? { ...wt, archived: true } : wt,
          ),
        }));
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [applyPrUpdates]);
}
