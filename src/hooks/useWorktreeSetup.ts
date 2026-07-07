import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface SetupCompletePayload {
  worktreeId: string;
  worktreePath: string;
  error: string | null;
}

/**
 * Listens for `worktree:setup-complete` from the Rust backend (emitted when a
 * worktree's background create-time setup scripts finish) and clears the
 * "Setting up…" status. Routed through markSetupComplete so a completion that
 * arrives before the worktree is in the store (fast setup scripts) is buffered
 * and applied on insert rather than lost. On failure, error is surfaced via the
 * existing setupScriptError UI.
 */
export function useWorktreeSetup() {
  useEffect(() => {
    const unlisten = listen<SetupCompletePayload>("worktree:setup-complete", (event) => {
      const { worktreeId, worktreePath, error } = event.payload;
      useWorkspaceStore.getState().markSetupComplete({
        id: worktreeId,
        path: worktreePath,
        error: error ?? null,
      });
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);
}
