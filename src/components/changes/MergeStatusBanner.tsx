import { useState } from "react";
import type { CheckRun, PrStatus } from "../../types";
import { formatTimeAgo } from "./formatRelativeTime";
import { rerunFailedChecks, fixFailingChecks, fixMergeConflicts } from "../../services/prActions";
import { useTabStore } from "../../stores/tabStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { Button } from "../ui/Button";

export function MergeStatusBanner({
  worktreeId,
  pr,
  checkRuns,
  mergeable,
  reviewDecision,
  repoPath,
}: {
  worktreeId: string;
  pr: PrStatus;
  checkRuns: CheckRun[];
  mergeable: boolean | null;
  reviewDecision: string | null;
  repoPath: string;
}) {
  const [loading, setLoading] = useState<"rerun" | "fix" | "conflicts" | null>(null);

  const failedChecks = checkRuns.filter(
    (r) => r.status === "completed" && r.conclusion !== "success" && r.conclusion !== "skipped" && r.conclusion !== null,
  );

  const switchToClaudeTab = () => {
    const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
    const claudeTab = tabs.find((t) => t.type === "claude");
    if (claudeTab) {
      const layout = useLayoutStore.getState();
      const paneId = layout.findPaneForTab(worktreeId, claudeTab.id);
      if (paneId) {
        layout.setPaneActiveTab(worktreeId, paneId, claudeTab.id);
      }
    }
  };

  const handleRerun = async () => {
    setLoading("rerun");
    try {
      await rerunFailedChecks(repoPath, failedChecks);
    } finally {
      setLoading(null);
    }
  };

  const handleFixChecks = async () => {
    setLoading("fix");
    try {
      const sent = await fixFailingChecks(worktreeId, repoPath, failedChecks);
      if (sent) switchToClaudeTab();
    } finally {
      setLoading(null);
    }
  };

  const handleFixConflicts = async () => {
    setLoading("conflicts");
    try {
      const sent = await fixMergeConflicts(worktreeId, pr.baseBranch ?? "main");
      if (sent) switchToClaudeTab();
    } finally {
      setLoading(null);
    }
  };

  // ── Merged ──
  if (pr.merged) {
    return (
      <div className="px-2.5 py-1.5 bg-accent-primary/10 border-t border-accent-primary/20 text-xs text-accent-primary font-semibold shrink-0">
        Merged{pr.mergedAt ? ` · ${formatTimeAgo(pr.mergedAt)}` : ""}
      </div>
    );
  }

  // ── Closed ──
  if (pr.state === "closed") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        Closed
      </div>
    );
  }

  // ── Priority 1: Merge conflict ──
  if (mergeable === false) {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0 flex items-center gap-2">
        <span className="flex-1">Merge conflict</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleFixConflicts}
          disabled={loading !== null}
          className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
        >
          {loading === "conflicts" ? "Sending…" : "Fix conflicts"}
        </Button>
      </div>
    );
  }

  // ── Priority 2: Failing checks ──
  if (failedChecks.length > 0) {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0 flex items-center gap-2">
        <span className="flex-1">{failedChecks.length} check{failedChecks.length !== 1 ? "s" : ""} failing</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleRerun}
          disabled={loading !== null}
          className="text-[10px] px-2 py-0.5 h-auto bg-bg-secondary border border-border-default text-text-secondary hover:bg-bg-hover disabled:opacity-50 font-medium"
        >
          {loading === "rerun" ? "Rerunning…" : "Rerun"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleFixChecks}
          disabled={loading !== null}
          className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
        >
          {loading === "fix" ? "Sending…" : "Fix with agent"}
        </Button>
      </div>
    );
  }

  // ── Ready to merge ──
  if (mergeable === true && reviewDecision === "APPROVED") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-added/10 border-t border-diff-added/20 text-xs text-diff-added font-semibold shrink-0">
        Ready to merge
      </div>
    );
  }

  // ── Changes requested ──
  if (reviewDecision === "CHANGES_REQUESTED") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        Changes requested
      </div>
    );
  }

  return null;
}
