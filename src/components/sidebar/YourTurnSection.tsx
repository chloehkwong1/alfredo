import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { startPollInterval } from "../../services/pollInterval";
import {
  formatWaitingAge,
  mergeOrchestrations,
  orchestrationsFromLinks,
  orchestrationsFromNotes,
  orchestrationsFromRules,
  yourTurnRows,
} from "../../services/orchestrations";
import { repoBadgeLabel } from "./RepoSelector";

interface YourTurnSectionProps {
  selectedRepos: string[];
  repoDisplayNames?: Record<string, string>;
  repoShortLabels?: Record<string, string>;
  /** Hand-set worktree names, keyed by worktree path. */
  worktreeLabels?: Record<string, string>;
}

/** Worktrees inside the person's orchestrations that need them, oldest first.
 *  Renders nothing — no label, no spacing — when there are none. Navigation
 *  only: a row opens its worktree and does nothing else. */
function YourTurnSection({ selectedRepos, repoDisplayNames, repoShortLabels, worktreeLabels }: YourTurnSectionProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const rules = useWorkspaceStore((s) => s.orchestrationRules);
  const seen = useWorkspaceStore((s) => s.seenWorktrees);
  const unread = useWorkspaceStore((s) => s.unreadWorktrees);
  const since = useWorkspaceStore((s) => s.needsYouSince);
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
  const clearWorktreeSelection = useWorkspaceStore((s) => s.clearWorktreeSelection);
  const [, setTick] = useState(0);

  const { rows, reposWithOrchestrations, repoOfWorktree } = useMemo(() => {
    // Notes and rules first: `yourTurnRows` gives a worktree to the first
    // orchestration that lists it, so a link never moves a worktree they place.
    const orchestrations = selectedRepos.flatMap((repo) => [
      ...mergeOrchestrations(
        orchestrationsFromNotes(repo, worktrees),
        orchestrationsFromRules(repo, rules[repo] ?? [], worktrees),
      ),
      ...orchestrationsFromLinks(repo, worktrees, worktreeLabels ?? {}),
    ]);
    return {
      rows: yourTurnRows(orchestrations, worktrees, seen, unread, since),
      reposWithOrchestrations: new Set(orchestrations.map((o) => o.repoPath)).size,
      repoOfWorktree: new Map(worktrees.map((wt) => [wt.id, wt.repoPath])),
    };
  }, [selectedRepos, rules, worktrees, worktreeLabels, seen, unread, since]);

  const hasRows = rows.length > 0;
  useEffect(() => {
    if (!hasRows) return;
    return startPollInterval(() => setTick((t) => t + 1), 60_000);
  }, [hasRows]);

  if (!hasRows) return null;

  const now = Date.now();
  return (
    <div className="mb-1">
      <div className="flex w-full items-center px-3.5 pt-3 pb-2 select-none">
        <span className="text-xs font-bold uppercase tracking-[0.08em] text-text-primary">
          Your turn
        </span>
        <span className="flex-1 h-[1.5px] bg-gradient-to-r from-group-rule to-transparent mx-3" />
      </div>
      {rows.map((row) => {
        const isAnswer = row.kind === "answer";
        const age = formatWaitingAge(row.since, now);
        const repoPath = repoOfWorktree.get(row.worktreeId);
        const orchestrationName =
          reposWithOrchestrations > 1 && repoPath
            ? `${repoBadgeLabel(repoPath, repoDisplayNames, repoShortLabels)} · ${row.orchestrationName}`
            : row.orchestrationName;
        return (
          <div key={row.worktreeId} className="px-2 pb-1.5">
            <button
              type="button"
              onClick={() => {
                clearWorktreeSelection();
                setActiveWorktree(row.worktreeId);
              }}
              aria-current={row.worktreeId === activeWorktreeId ? "true" : undefined}
              className={[
                "w-full text-left py-2 px-3 rounded-md cursor-pointer",
                isAnswer ? "bg-accent-muted" : "bg-card ring-1 ring-inset ring-card-ring",
              ].join(" ")}
            >
              <div className="truncate text-xs text-text-primary" title={row.fullText}>
                <span
                  className={[
                    "font-semibold",
                    isAnswer ? "text-accent-primary" : "text-text-secondary",
                  ].join(" ")}
                >
                  {isAnswer ? "Answer" : "Check"}
                </span>
                {" · "}
                {row.text}
              </div>
              <div className="mt-1 flex text-[10px] text-text-tertiary">
                <span className="min-w-0 truncate">
                  {orchestrationName} · {row.itemTitle}
                </span>
                <span className="shrink-0 whitespace-pre"> · {isAnswer ? `waiting ${age}` : age}</span>
              </div>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export { YourTurnSection };
