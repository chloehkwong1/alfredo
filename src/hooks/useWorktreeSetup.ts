import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface SetupCompletePayload {
  worktreeId: string;
  error: string | null;
}

/**
 * Listens for `worktree:setup-complete` from the Rust backend (emitted when a
 * worktree's background create-time setup scripts finish) and clears the
 * "Setting up…" status. On failure, `error` is surfaced via the existing
 * setupScriptError UI; on success it is cleared to null.
 */
export function useWorktreeSetup() {
  useEffect(() => {
    const unlisten = listen<SetupCompletePayload>("worktree:setup-complete", (event) => {
      const { worktreeId, error } = event.payload;
      useWorkspaceStore.getState().updateWorktree(worktreeId, {
        setupInProgress: false,
        setupScriptError: error ?? null,
      });
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}
