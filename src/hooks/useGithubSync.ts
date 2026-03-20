import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { PrUpdatePayload } from "../types";
import { useWorkspaceStore } from "../stores/workspaceStore";

/**
 * Listens for `github:pr-update` events from the Rust background sync loop
 * and applies PR status updates to the workspace store.
 */
export function useGithubSync() {
  const applyPrUpdates = useWorkspaceStore((s) => s.applyPrUpdates);

  useEffect(() => {
    const unlisten = listen<PrUpdatePayload>("github:pr-update", (event) => {
      applyPrUpdates(event.payload.prs);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [applyPrUpdates]);
}
