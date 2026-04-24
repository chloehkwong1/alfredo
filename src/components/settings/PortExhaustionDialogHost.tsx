import { useEffect, useMemo } from "react";
import { usePortClaimStore } from "../../stores/portClaimStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useAppConfig } from "../../hooks/useAppConfig";
import { claimWorktreePort, releaseWorktreePort, listWorktrees } from "../../api";
import {
  REPO_COLOR_PALETTE,
  getRepoColor,
  resolveColorId,
  repoBadgeLabel,
} from "../sidebar/RepoSelector";
import { PortExhaustionDialog, type PortExhaustionHolder } from "./PortExhaustionDialog";

function PortExhaustionDialogHost() {
  const exhaustion = usePortClaimStore((s) => s.exhaustion);
  const updateHolders = usePortClaimStore((s) => s.updateHolders);
  const setError = usePortClaimStore((s) => s.setError);
  const resolveWithPort = usePortClaimStore((s) => s.resolveWithPort);
  const cancel = usePortClaimStore((s) => s.cancel);
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const runningServers = useWorkspaceStore((s) => s.runningServers);
  const setWorktreesForRepo = useWorkspaceStore((s) => s.setWorktreesForRepo);
  const { repoColors, repoDisplayNames, repoShortLabels, repos } = useAppConfig();

  // Defensive hygiene: if the host unmounts (dev HMR, test teardown), don't
  // leave an awaiting spawn promise hanging forever.
  useEffect(() => {
    return () => {
      if (usePortClaimStore.getState().exhaustion) {
        usePortClaimStore.getState().cancel();
      }
    };
  }, []);

  // Enrich each holder with display data by joining against the workspace store
  // and the app-config chip metadata. We fall back gracefully when a holder
  // doesn't map to a known worktree (orphaned persisted assignment).
  const enrichedHolders = useMemo<PortExhaustionHolder[]>(() => {
    if (!exhaustion) return [];
    return exhaustion.holders.map((h) => {
      const wt = worktrees.find((w) => w.id === h.worktreeName);
      const branch = wt?.branch ?? h.worktreeName;
      const repoPath = wt?.repoPath ?? exhaustion.repoPath;
      const colorId = resolveColorId(repoColors[repoPath]);
      const palette = colorId
        ? REPO_COLOR_PALETTE.find((c) => c.id === colorId)
        : undefined;
      // Prefer a neutral "slate" when we can't identify the repo, rather than
      // silently adopting repo-index-0's palette (see review M1).
      const fallbackColor =
        palette ??
        (repos.some((r) => r.path === repoPath)
          ? getRepoColor(repos.findIndex((r) => r.path === repoPath))
          : REPO_COLOR_PALETTE.find((c) => c.id === "slate") ?? REPO_COLOR_PALETTE[0]);
      return {
        worktreeName: h.worktreeName,
        branch,
        port: h.port,
        isServerRunning: !!runningServers[h.worktreeName],
        chip: {
          label: repoBadgeLabel(repoPath, repoDisplayNames, repoShortLabels),
          bg: fallbackColor.bg,
          text: fallbackColor.text,
        },
      };
    });
  }, [exhaustion, worktrees, runningServers, repoColors, repoDisplayNames, repoShortLabels, repos]);

  async function handleRelease(worktreeName: string) {
    // Snapshot everything token-scoped at entry. If the store's `exhaustion`
    // is replaced (superseded by another claim) or cleared (user cancelled)
    // while our awaits are in flight, these captured values still belong to
    // the flow we started — and the token guards in the store ensure we
    // never resolve the wrong promise.
    const current = usePortClaimStore.getState().exhaustion;
    if (!current) return;
    const { token, repoPath, worktreeId } = current;

    // Clear any leftover error from a previous attempt.
    setError(token, null);

    try {
      await releaseWorktreePort(repoPath, worktreeName);
    } catch (e) {
      console.error("[port-claim] release failed", e);
      setError(token, `Couldn't release :${worktreeName}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // Refresh the released worktree's owning repo so the sidebar drops its
    // port chip immediately. Look up the owning repo from the store; a user
    // with multiple repos configured may release a worktree in a repo
    // different from the one they're trying to claim in.
    const releasedRepoPath =
      worktrees.find((w) => w.id === worktreeName)?.repoPath ?? repoPath;
    try {
      const fresh = await listWorktrees(releasedRepoPath);
      setWorktreesForRepo(releasedRepoPath, fresh);
    } catch (e) {
      console.warn("[port-claim] post-release worktree refresh failed", e);
    }

    // Retry the original claim. If it still comes back full (another worktree
    // grabbed the slot between our release and retry), update the holders so
    // the user can release a different one.
    try {
      const result = await claimWorktreePort(repoPath, worktreeId);
      if (result.kind === "assigned") {
        resolveWithPort(token, result.port);
      } else if (result.kind === "rangeFull") {
        updateHolders(token, result.holders);
        setError(token, "Slot was taken by another worktree. Release another port to continue.");
      } else {
        // "disabled" — auto-assign was flipped off mid-flow. Surface it
        // rather than silently cancelling; the user explicitly asked to
        // start a server here and the app quietly changing behaviour would
        // be confusing.
        setError(token, "Auto-assign ports was disabled. Close this dialog and try again.");
      }
    } catch (e) {
      console.error("[port-claim] retry claim failed", e);
      setError(token, `Retry failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!exhaustion) return null;

  return (
    <PortExhaustionDialog
      open
      onOpenChange={(o) => {
        if (!o) cancel();
      }}
      rangeStart={exhaustion.rangeStart}
      rangeEnd={exhaustion.rangeEnd}
      targetBranch={exhaustion.targetBranch}
      holders={enrichedHolders}
      error={exhaustion.error}
      onRelease={handleRelease}
    />
  );
}

export { PortExhaustionDialogHost };
