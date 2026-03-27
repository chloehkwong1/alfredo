import { useEffect, useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PrHeader } from "./PrHeader";
import { PrChecksSection } from "./PrChecksSection";
import { PrReviewsSection } from "./PrReviewsSection";
import { PrCommentsSection } from "./PrCommentsSection";
import { PrConflictsSection } from "./PrConflictsSection";
import { getCheckRuns, getPrDetail, getWorkflowLog, writePty } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { sessionManager } from "../../services/sessionManager";
import type { Worktree, WorkflowRunLog, PrComment } from "../../types";

/**
 * Find the first Claude tab for a worktree, look up its session in the
 * SessionManager, write a prompt to the PTY, then switch to that tab.
 */
async function sendToClaudeSession(
  worktreeId: string,
  prompt: string,
): Promise<void> {
  const store = useWorkspaceStore.getState();
  const tabs = store.tabs[worktreeId] ?? [];

  // Find the first claude tab
  const claudeTab = tabs.find((t) => t.type === "claude");
  if (!claudeTab) {
    console.warn("No Claude session found for worktree", worktreeId);
    return;
  }

  // Sessions are keyed by tab ID in SessionManager
  const session = sessionManager.getSession(claudeTab.id);
  if (!session || !session.sessionId) {
    console.warn("Claude session not yet spawned for tab", claudeTab.id);
    return;
  }

  // Encode the prompt + newline as bytes and write to the PTY
  const bytes = Array.from(new TextEncoder().encode(prompt + "\n"));
  await writePty(session.sessionId, bytes);

  // Switch to the Claude tab
  store.setActiveTabId(worktreeId, claudeTab.id);
}

interface PrDetailPanelProps {
  worktree: Worktree;
  repoPath: string;
}

function PrDetailPanel({ worktree, repoPath }: PrDetailPanelProps) {
  const checkRuns = useWorkspaceStore((s) => s.checkRuns[worktree.id]) ?? [];
  const setCheckRuns = useWorkspaceStore((s) => s.setCheckRuns);
  const prDetail = useWorkspaceStore((s) => s.prDetail[worktree.id]);
  const setPrDetail = useWorkspaceStore((s) => s.setPrDetail);
  const [refreshing, setRefreshing] = useState(false);

  const fetchChecks = useCallback(async () => {
    try {
      const ref = worktree.prStatus?.headSha ?? worktree.branch;
      const runs = await getCheckRuns(repoPath, ref);
      setCheckRuns(worktree.id, runs);
    } catch (err) {
      console.error("Failed to fetch check runs:", err);
    }
  }, [repoPath, worktree.branch, worktree.prStatus?.headSha, worktree.id, setCheckRuns]);

  const fetchDetail = useCallback(async () => {
    if (!worktree.prStatus) return;
    try {
      const detail = await getPrDetail(repoPath, worktree.prStatus.number);
      setPrDetail(worktree.id, detail);
    } catch (err) {
      console.error("Failed to fetch PR detail:", err);
    }
  }, [repoPath, worktree.prStatus, worktree.id, setPrDetail]);

  const hasPr = !!worktree.prStatus;

  useEffect(() => {
    if (!hasPr) return;
    fetchChecks();
    fetchDetail();
    const interval = setInterval(() => {
      fetchChecks();
      fetchDetail();
    }, 30_000);
    return () => clearInterval(interval);
  }, [hasPr, fetchChecks, fetchDetail]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchChecks(), fetchDetail()]);
    setRefreshing(false);
  };

  if (!worktree.prStatus) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        No pull request for this branch
      </div>
    );
  }

  // Calculate blocker counts
  const failingChecks = checkRuns.filter(
    (r) => r.conclusion === "failure" || r.conclusion === "timed_out",
  ).length;
  const hasChangesRequested = prDetail?.reviews?.some(
    (r) => r.state === "changes_requested",
  );
  const unresolvedComments = prDetail?.comments?.length ?? 0;
  const hasConflicts = prDetail?.mergeable === false;

  const unresolvedCount =
    (failingChecks > 0 ? 1 : 0) +
    (hasChangesRequested ? 1 : 0) +
    (unresolvedComments > 0 ? 1 : 0) +
    (hasConflicts ? 1 : 0);

  const handleAskClaudeFix = async (logs: WorkflowRunLog[]) => {
    // If no logs provided (from "fix all" button), fetch them for all failing checks
    let allLogs = logs;
    if (allLogs.length === 0) {
      const failingRuns = checkRuns.filter(
        (r) =>
          (r.conclusion === "failure" || r.conclusion === "timed_out") &&
          r.checkSuiteId,
      );
      const logPromises = failingRuns.map((r) =>
        getWorkflowLog(repoPath, r.checkSuiteId!).catch(() => []),
      );
      const results = await Promise.all(logPromises);
      allLogs = results.flat();
    }

    if (allLogs.length === 0) {
      console.warn("No failure logs to send to Claude");
      return;
    }

    const logSection = allLogs
      .map(
        (log) =>
          `### ${log.jobName} / ${log.stepName}\n\`\`\`\n${log.logExcerpt}\n\`\`\``,
      )
      .join("\n\n");

    const prompt = `CI is failing on this branch. Here are the failure logs:

${logSection}

Please triage each failure:
1. Is this a real bug in my code, a flaky test, or a test that needs updating?
2. Skip flaky tests (timing issues, network flakes) — just flag them
3. If the test is correct and code is wrong, fix the code. If code is correct and test is wrong, fix the test.
4. Report back what you found and what you're fixing before pushing`;

    await sendToClaudeSession(worktree.id, prompt);
  };

  const handleJumpToComment = (comment: PrComment) => {
    const store = useWorkspaceStore.getState();
    const tabs = store.tabs[worktree.id] ?? [];
    const changesTab = tabs.find((t) => t.type === "changes");
    if (!changesTab) return;

    // Switch to the Changes tab
    store.setActiveTabId(worktree.id, changesTab.id);

    // After the tab renders, scroll to the relevant file (and line if possible)
    setTimeout(() => {
      if (comment.path) {
        const fileEl = document.querySelector<HTMLElement>(
          `[data-file-path="${CSS.escape(comment.path)}"]`,
        );
        if (fileEl) {
          fileEl.scrollIntoView({ behavior: "smooth", block: "start" });

          // If there's a target line, try to find the line row within the file card
          if (comment.line != null) {
            // Lines render their new/old line numbers in <span> siblings;
            // the closest we can do is find the line by searching within the card.
            // Each line row has two number spans — look for one whose text matches.
            const lineEls = fileEl.querySelectorAll<HTMLElement>(".font-mono > div > div");
            for (const row of lineEls) {
              const spans = row.querySelectorAll<HTMLElement>("span.w-12");
              for (const span of spans) {
                if (span.textContent?.trim() === String(comment.line)) {
                  row.scrollIntoView({ behavior: "smooth", block: "center" });
                  break;
                }
              }
            }
          }
        }
      }
    }, 150);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center">
        <div className="flex-1">
          <PrHeader
            pr={worktree.prStatus}
            blockerCount={4}
            resolvedCount={4 - unresolvedCount}
          />
        </div>
        <div className="px-2 border-b border-border-subtle flex items-center">
          <button
            type="button"
            onClick={handleRefresh}
            className="p-1 text-text-tertiary hover:text-text-secondary"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <PrChecksSection
          checkRuns={checkRuns}
          repoPath={repoPath}
          onAskClaudeFix={handleAskClaudeFix}
        />
        <PrReviewsSection reviews={prDetail?.reviews ?? []} />
        <PrCommentsSection
          comments={prDetail?.comments ?? []}
          onJumpToComment={handleJumpToComment}
        />
        <PrConflictsSection mergeable={prDetail?.mergeable ?? null} />
      </div>
    </div>
  );
}

export { PrDetailPanel };
