import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppConfig } from "./useAppConfig";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { handleReviewRequests, pasteReviewPromptOnActivation } from "../services/reviewRequestFlow";
import type { PrUpdatePayload } from "../types";

/**
 * Auto-pull review requests: watches the PR sync feed for PRs flagged
 * `reviewRequested` and creates their worktrees, and pastes the review prompt
 * the first time such a worktree is activated. Gated on the
 * autoPullReviewRequests setting (default on).
 */
export function useReviewRequests(): void {
  const { config } = useAppConfig();
  const enabled = config?.autoPullReviewRequests !== false;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const unlisten = listen<PrUpdatePayload>("github:pr-update", (event) => {
      if (!enabledRef.current) return;
      void handleReviewRequests(event.payload.prs);
    });
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    return useWorkspaceStore.subscribe((state, prev) => {
      if (state.activeWorktreeId && state.activeWorktreeId !== prev.activeWorktreeId) {
        void pasteReviewPromptOnActivation(state.activeWorktreeId);
      }
    });
  }, []);
}
