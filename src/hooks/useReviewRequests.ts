import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAppConfig } from "./useAppConfig";
import { handleReviewRequests } from "../services/reviewRequestFlow";
import type { PrUpdatePayload } from "../types";

/**
 * Auto-pull review requests: watches the PR sync feed for PRs flagged
 * `reviewRequested` and creates their worktrees. Gated on the
 * autoPullReviewRequests setting (default on).
 */
export function useReviewRequests(): void {
  const { config } = useAppConfig();
  // Fail closed while config is unloaded: the backend sync loop starts
  // emitting pr-update before the config fetch resolves (and the fetch can
  // fail outright), and auto-creating a worktree against an explicit OFF
  // setting is worse than missing one poll's worth of review requests.
  const enabled = config != null && config.autoPullReviewRequests !== false;
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
}
