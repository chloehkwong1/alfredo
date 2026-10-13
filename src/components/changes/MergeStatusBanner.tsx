import { useEffect, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { CheckRun, PrStatus, WorkflowRunLog } from "../../types";
import { formatTimeAgo } from "./formatRelativeTime";
import { isCheckFailing, isCheckPending } from "./checkRunStatus";
import { rerunFailedChecks, fixFailingChecks, mergeAndFix } from "../../services/prActions";
import { focusAgentTab } from "../../services/agentMessenger";
import { getJobLog, getRepoMergeMethods, markPrReady, mergePr, type MergeMethod } from "../../api";
import { useToastStore } from "../../stores/toastStore";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/DropdownMenu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/Dialog";

/** Trim the `GitHub error: [409] failed to merge PR:` prefix and the trailing
 *  docs URL off a backend error so the toast leads with GitHub's own reason. */
function stripErrorNoise(detail: string): string {
  return detail
    .replace(/^GitHub error:\s*/, "")
    .replace(/^\[\d+\]\s*/, "")
    // "failed to merge PR:", "failed to mark PR ready for review:", …
    // `[^:\n]` so a context containing a URL or a newline can't over-strip.
    .replace(/^failed to [^:\n]+:\s*/, "")
    // format_octocrab_error always appends " (docs_url)", empty parens included.
    .replace(/\s*\((?:https?:\/\/\S*)?\)\s*$/, "")
    .trim();
}

/** Per-repo merge settings, cached for the session (see the fetch effect). */
const mergeMethodCache = new Map<string, MergeMethod[]>();

/** PRs merged from this session, by `${repoPath}#${number}`. Module scope so a
 *  worktree switch (which remounts this component) can't re-arm the button
 *  while the sync that marks the PR merged is still in flight. */
const mergedHerePrs = new Set<string>();

/** When a PR was taken out of draft from this session, by
 *  `${repoPath}#${number}`. Same reason as `mergedHerePrs`: the undraft isn't
 *  in the polled payload yet, and until it is the banner would keep offering
 *  an action already taken.
 *
 *  Time-stamped rather than a bare Set because the entry cannot be cleaned up
 *  reliably — a worktree switch unmounts the only code that clears it, and a
 *  PR converted back to draft on GitHub would make a stale entry mean the
 *  opposite of the truth. An expiring entry self-heals instead of disarming
 *  the undraft for the rest of the session. */
const markedReadyAt = new Map<string, number>();

/** How long a local undraft outranks `pr.draft`. Comfortably past the 60s
 *  focused poll that confirms it, short enough that a stranded entry heals. */
const READY_HOLD_MS = 90_000;

/** Labels for the combined press. Not derived from MERGE_METHOD_LABELS, whose
 *  "Squash & merge" folds into the clumsy "Mark ready & squash and merge" —
 *  and the short form keeps the button from wrapping in a narrow panel. */
const MERGE_METHOD_READY_LABELS: Record<MergeMethod, string> = {
  squash: "Mark ready & squash",
  merge: "Mark ready & merge",
  rebase: "Mark ready & rebase",
};

const MERGE_METHOD_LABELS: Record<MergeMethod, string> = {
  squash: "Squash & merge",
  merge: "Create merge commit",
  rebase: "Rebase & merge",
};

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
  const [loading, setLoading] = useState<
    "rerun" | "fix" | "fixConflicts" | "readying" | "merging" | null
  >(null);
  const [checksExpanded, setChecksExpanded] = useState(false);
  const [failureLogs, setFailureLogs] = useState<Record<number, WorkflowRunLog | null>>({});
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [logsLoading, setLogsLoading] = useState(false);
  const [methods, setMethods] = useState<MergeMethod[] | null>(null);
  const [pickedMethod, setPickedMethod] = useState<MergeMethod | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Adding to the module-level Set doesn't re-render; this does.
  const [justMerged, setJustMerged] = useState<string | null>(null);
  // Writing to the module-level Map doesn't re-render; this does.
  const [, bumpReadyHold] = useState(0);
  const mergeKey = `${repoPath}#${pr.number}`;
  // Derived each render, not seeded once: the same mounted banner can move on
  // to a new PR number, which must not inherit the previous PR's merged flag.
  const mergedHere = mergedHerePrs.has(mergeKey) || justMerged === mergeKey;
  // True only while a local undraft is still newer than the poll that will
  // confirm it. Both halves of the window matter: `pr.draft` keeps a
  // now-irrelevant entry from claiming anything about a PR GitHub already
  // reports as ready, and the expiry keeps one stranded by a remount — or made
  // wrong by the PR being converted back to draft — from disarming the undraft
  // for the rest of the session.
  const readiedAt = markedReadyAt.get(mergeKey);
  const readiedHere =
    pr.draft && readiedAt !== undefined && Date.now() - readiedAt < READY_HOLD_MS;
  // `pr.draft` is only as fresh as the last poll. Once this session has taken
  // the PR out of draft, the merge button must stop offering to do it again —
  // it reads as an untaken step, and a retry after a refused merge would spend
  // a pointless round-trip re-undrafting an already-ready PR.
  const needsUndraft = pr.draft && !readiedHere;

  const failedChecks = checkRuns.filter(isCheckFailing);
  // Checks still running keep the merge button away, so the merge can't land
  // ahead of CI on a repo that doesn't mark its checks required — same rule as
  // the sidebar's Ready-to-merge chip (PrStatsRow.tsx).
  //
  // A draft does NOT disqualify on its own: GitHub refuses to merge one, so
  // the button undrafts first (see `handleMerge`).
  const checksRunning = checkRuns.some(isCheckPending);
  // Undrafting can be what *starts* CI — workflows are commonly gated on
  // `draft == false` or triggered by `ready_for_review` — and a draft with no
  // check runs at all gives `checksRunning` nothing to see. Chaining a merge
  // onto the undraft there would land a head SHA that has never been tested,
  // which is the exact thing the guard above exists to prevent. So the
  // combined press needs evidence that checks already ran on this PR; without
  // it the banner offers the undraft alone, and the ordinary merge button arms
  // on the next poll (immediately, on a repo that has no CI at all).
  const hasCheckEvidence = checkRuns.length > 0;
  const isReady =
    mergeable === true &&
    reviewDecision === "approved" &&
    !checksRunning &&
    !mergedHere &&
    // `pr.draft`, not `needsUndraft`: the latter goes false the instant this
    // session undrafts locally, which made this guard vacuous and let the full
    // merge button arm on a head SHA with no checks at all. Both draft-ish
    // states — still a draft, and undrafted here but awaiting the poll that
    // confirms it — have to show evidence. `pr.draft` only clears on a poll,
    // so this still arms "on the next poll" as intended, immediately on a repo
    // with no CI at all.
    (!pr.draft || hasCheckEvidence);

  // Merge settings never change between polls, so they're fetched once per repo
  // and cached for the session — ChangesPanel remounts on every worktree
  // switch, and a repeated GET /repos/{o}/{r} spends the same hourly REST
  // budget the sync loop is already competing for.
  useEffect(() => {
    if (!isReady) return;
    const cached = mergeMethodCache.get(repoPath);
    if (cached) {
      setMethods(cached);
      return;
    }
    let stale = false;
    getRepoMergeMethods(repoPath)
      .then((result) => {
        mergeMethodCache.set(repoPath, result);
        if (!stale) setMethods(result);
      })
      .catch((e) => {
        if (stale) return;
        // Same rule as the backend's parse_allowed_merge_methods: unknown
        // settings mean "offer all three", not "assume squash".
        console.warn("Failed to load repo merge methods; offering all three:", e);
        setMethods(["squash", "merge", "rebase"]);
      });
    return () => {
      stale = true;
    };
  }, [repoPath, isReady]);

  // A poll can flip the banner out of the ready state while the dialog is open,
  // unmounting it with `confirmOpen` still true — which would pop the merge
  // confirmation back up, unprompted, the moment the PR looks ready again.
  // The `loading` guard matters now that the undraft triggers a sync of its
  // own: a poll landing mid-merge can flip `isReady` false and would otherwise
  // unmount the dialog while the merge it is reporting on is still in flight.
  useEffect(() => {
    if (!isReady && loading === null) setConfirmOpen(false);
  }, [isReady, loading]);

  // Once a poll confirms the undraft, drop the entry so the banner goes back to
  // reflecting GitHub rather than what this session did. A fast path only —
  // READY_HOLD_MS is what guarantees an entry this never reaches stops mattering.
  useEffect(() => {
    if (!pr.draft) markedReadyAt.delete(mergeKey);
  }, [pr.draft, mergeKey]);

  const method: MergeMethod =
    pickedMethod && methods?.includes(pickedMethod) ? pickedMethod : methods?.[0] ?? "squash";
  const baseBranch = pr.baseBranch ?? null;

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
      if (sent) focusAgentTab(worktreeId);
    } finally {
      setLoading(null);
    }
  };

  const handleMergeAndFix = async () => {
    setLoading("fixConflicts");
    try {
      await mergeAndFix(worktreeId, repoPath, pr.baseBranch ?? "main");
    } catch (e) {
      console.error("Merge failed:", e);
    } finally {
      setLoading(null);
    }
  };

  /** Take the PR out of draft and nothing else. No confirmation: GitHub undoes
   *  it in one click ("Convert to draft"), so a dialog would cost more than the
   *  mistake. */
  const handleMarkReady = async () => {
    const showToast = useToastStore.getState().show;
    setLoading("readying");
    try {
      await markPrReady(repoPath, pr.number);
      markedReadyAt.set(mergeKey, Date.now());
      bumpReadyHold((n) => n + 1);
      showToast({ message: `#${pr.number} is ready for review` });
    } catch (e) {
      console.error("Mark PR ready failed:", e);
      const detail = e instanceof Error ? e.message : String(e);
      showToast({
        message: `Couldn't mark #${pr.number} ready — ${stripErrorNoise(detail)}`,
        durationMs: 12000,
      });
    } finally {
      setLoading(null);
    }
  };

  /** Merge, undrafting first when the PR is still a draft — GitHub refuses to
   *  merge a draft outright.
   *
   *  The two steps can't be atomic, and the failure between them is a real one:
   *  undrafting requests reviews from any code owners, so a repo whose
   *  protection requires their approval will refuse the merge that follows.
   *  That leaves the PR undrafted and unmerged, which is a fine place to be —
   *  so the toast says exactly that rather than reporting a flat "merge
   *  failed", and the next poll re-renders the banner with the ordinary merge
   *  button for the retry. */
  const handleMerge = async () => {
    const showToast = useToastStore.getState().show;
    let readied = false;
    try {
      if (needsUndraft) {
        setLoading("readying");
        await markPrReady(repoPath, pr.number);
        readied = true;
      }
      setLoading("merging");
      await mergePr(repoPath, pr.number, method, pr.headSha!);
      // The sync that moves the card to Done is seconds away (serialised behind
      // the poll lock); until it lands, `mergedHere` keeps the banner from
      // re-arming a button whose second press GitHub would reject.
      mergedHerePrs.add(mergeKey);
      setJustMerged(mergeKey);
      showToast({ message: `Merged #${pr.number}${baseBranch ? ` into ${baseBranch}` : ""}` });
    } catch (e) {
      // Three outcomes, not two: the undraft can fail before the merge is even
      // attempted, and reporting that as "Merge failed" would send the user
      // looking at the wrong thing.
      const failedUndrafting = needsUndraft && !readied;
      console.error(
        failedUndrafting
          ? "Mark PR ready failed (merge not attempted):"
          : readied
            ? "Merge after undraft failed:"
            : "Merge PR failed:",
        e
      );
      const detail = stripErrorNoise(e instanceof Error ? e.message : String(e));
      if (readied) {
        // The undraft stuck; hold that half so the banner stops offering it.
        markedReadyAt.set(mergeKey, Date.now());
        bumpReadyHold((n) => n + 1);
      }
      showToast({
        message: failedUndrafting
          ? `Couldn't mark #${pr.number} ready — ${detail}`
          : readied
            ? `Marked #${pr.number} ready, but the merge was refused — ${detail}`
            : `Merge failed — ${detail}`,
        durationMs: 12000,
      });
    } finally {
      setConfirmOpen(false);
      setLoading(null);
    }
  };

  const handleExpandChecks = async () => {
    const next = !checksExpanded;
    setChecksExpanded(next);

    if (!next) return;

    // Fetch logs for failed checks we haven't fetched yet
    const toFetch = failedChecks.filter((run) => !(run.id in failureLogs));
    if (toFetch.length === 0) return;

    setLogsLoading(true);
    try {
      const results = await Promise.allSettled(
        toFetch.map((run) => getJobLog(repoPath, run.id, run.name)),
      );

      const newLogs: Record<number, WorkflowRunLog | null> = { ...failureLogs };
      toFetch.forEach((run, i) => {
        const result = results[i];
        newLogs[run.id] = result.status === "fulfilled" ? result.value : null;
      });
      setFailureLogs(newLogs);
    } finally {
      setLogsLoading(false);
    }
  };

  const toggleLogExpand = (key: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // ── Merged ──
  if (pr.merged) {
    return (
      <div className="px-2.5 py-1.5 bg-accent-primary/10 border-t border-accent-primary/20 text-xs text-accent-primary font-semibold shrink-0">
        Merged{pr.mergedAt ? ` · ${formatTimeAgo(pr.mergedAt)}` : ""}
      </div>
    );
  }

  // ── Cancelled (closed without merge) ──
  if (pr.state === "closed") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        Cancelled
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
          onClick={handleMergeAndFix}
          disabled={loading !== null}
          className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
        >
          {loading === "fixConflicts" ? "Sending\u2026" : "Fix conflicts"}
        </Button>
      </div>
    );
  }

  // ── Priority 2: Failing checks (expandable) ──
  if (failedChecks.length > 0) {
    // Build a map from check name to log entries for display
    const logsByCheck = new Map<string, { jobName: string; stepName: string; excerpt: string; htmlUrl: string }[]>();
    for (const check of failedChecks) {
      const entries: { jobName: string; stepName: string; excerpt: string; htmlUrl: string }[] = [];
      const log = failureLogs[check.id];
      if (log) {
        entries.push({
          jobName: log.jobName,
          stepName: log.stepName,
          excerpt: log.logExcerpt,
          htmlUrl: check.htmlUrl,
        });
      }
      if (entries.length === 0) {
        entries.push({
          jobName: check.name,
          stepName: "",
          excerpt: "",
          htmlUrl: check.htmlUrl,
        });
      }
      logsByCheck.set(check.name, entries);
    }

    return (
      <div className="bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        {/* Header row */}
        <div className="px-2.5 py-1.5 flex items-center gap-2">
          <button
            onClick={handleExpandChecks}
            className="flex-1 flex items-center gap-1.5 text-left"
          >
            <svg
              className={`w-3 h-3 transition-transform ${checksExpanded ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {failedChecks.length} check{failedChecks.length !== 1 ? "s" : ""} failing
          </button>
          {!checksExpanded && (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRerun}
                disabled={loading !== null}
                className="text-[10px] px-2 py-0.5 h-auto bg-bg-secondary border border-border-default text-text-secondary hover:bg-bg-hover disabled:opacity-50 font-medium"
              >
                {loading === "rerun" ? "Rerunning\u2026" : "Rerun"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleFixChecks}
                disabled={loading !== null}
                className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
              >
                {loading === "fix" ? "Sending\u2026" : "Fix with agent"}
              </Button>
            </>
          )}
        </div>

        {/* Expanded failure list */}
        {checksExpanded && (
          <div className="border-t border-diff-removed/20">
            <div className="max-h-[40vh] overflow-y-auto">
              {[...logsByCheck.entries()].map(([checkName, entries]) => (
                <div key={checkName} className="px-2.5 py-1.5 border-b border-diff-removed/10 last:border-b-0">
                  {entries.map((entry, i) => {
                    const logKey = `${checkName}-${i}`;
                    const lines = entry.excerpt.split("\n");
                    const collapsed = lines.length > 5 && !expandedLogs.has(logKey);
                    const displayLines = collapsed ? lines.slice(0, 5) : lines;

                    return (
                      <div key={logKey}>
                        <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
                          <span className="font-semibold text-diff-removed truncate">
                            {entry.jobName}{entry.stepName ? ` / ${entry.stepName}` : ""}
                          </span>
                          {entry.htmlUrl && (
                            <IconButton
                              size="sm"
                              label="View on GitHub"
                              className="h-auto w-auto p-0 text-diff-removed hover:text-diff-removed/80 shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                openUrl(entry.htmlUrl);
                              }}
                            >
                              <ExternalLink size={11} />
                            </IconButton>
                          )}
                        </div>
                        {entry.excerpt ? (
                          <>
                            <pre className="text-[10px] font-mono text-text-secondary bg-bg-primary/50 rounded px-1.5 py-1 overflow-x-auto whitespace-pre-wrap">
                              {displayLines.join("\n")}
                            </pre>
                            {collapsed && (
                              <button
                                onClick={() => toggleLogExpand(logKey)}
                                className="text-[10px] text-accent-primary hover:underline mt-0.5"
                              >
                                Show more ({lines.length - 5} more lines)
                              </button>
                            )}
                            {!collapsed && lines.length > 5 && (
                              <button
                                onClick={() => toggleLogExpand(logKey)}
                                className="text-[10px] text-accent-primary hover:underline mt-0.5"
                              >
                                Show less
                              </button>
                            )}
                          </>
                        ) : logsLoading ? (
                          <div className="text-[10px] text-text-tertiary italic">
                            Loading logs…
                          </div>
                        ) : (
                          <div className="text-[10px] text-text-tertiary italic">
                            No logs available — agent will check CI output
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* Bulk actions at bottom */}
            <div className="px-2.5 py-1.5 flex items-center justify-end gap-2 border-t border-diff-removed/20">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRerun}
                disabled={loading !== null}
                className="text-[10px] px-2 py-0.5 h-auto bg-bg-secondary border border-border-default text-text-secondary hover:bg-bg-hover disabled:opacity-50 font-medium"
              >
                {loading === "rerun" ? "Rerunning\u2026" : "Rerun all"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleFixChecks}
                disabled={loading !== null}
                className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
              >
                {loading === "fix" ? "Sending\u2026" : "Fix with agent"}
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Ready to merge (undrafting first when the PR is still a draft) ──
  if (isReady) {
    const mergeDisabled = loading !== null || methods === null || !pr.headSha;
    const dialogBusy = loading === "readying" || loading === "merging";
    // "Squash & merge" alone, or "Mark ready & squash merge" when it has to
    // undraft first — one press, both steps named.
    const mergeLabel = needsUndraft
      ? MERGE_METHOD_READY_LABELS[method]
      : MERGE_METHOD_LABELS[method];
    const buttonClass =
      "text-[10px] py-0.5 h-auto bg-diff-added/10 border border-diff-added/30 text-diff-added hover:bg-diff-added/20 disabled:opacity-50 font-medium";
    return (
      <div className="px-2.5 py-1.5 bg-diff-added/10 border-t border-diff-added/20 text-xs text-diff-added font-semibold shrink-0 flex items-center gap-2">
        <span className="flex-1 min-w-0">
          {needsUndraft ? "Approved — still a draft" : "Ready to merge"}
        </span>
        {/* `title` lives on the wrapper: Button sets `disabled:pointer-events-none`,
            which would suppress hover on the disabled button itself. */}
        <div className="flex items-center" title={!pr.headSha ? "Waiting for PR data" : undefined}>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setConfirmOpen(true)}
            disabled={mergeDisabled}
            className={`${buttonClass} px-2 ${methods && methods.length > 1 ? "rounded-r-none" : ""}`}
          >
            {mergeLabel}
          </Button>
          {methods && methods.length > 1 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={loading !== null}
                  aria-label="Choose merge method"
                  className={`${buttonClass} px-1 rounded-l-none border-l-0`}
                >
                  <ChevronDown size={11} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {methods.map((m) => (
                  <DropdownMenuItem key={m} onSelect={() => setPickedMethod(m)}>
                    {MERGE_METHOD_LABELS[m]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <Dialog
          open={confirmOpen}
          onOpenChange={(open) => {
            // Stay open until the in-flight merge settles.
            if (!open && !dialogBusy) setConfirmOpen(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {needsUndraft ? <>Mark #{pr.number} ready and merge?</> : <>Merge #{pr.number}?</>}
              </DialogTitle>
              <DialogDescription>
                This will {needsUndraft ? "take the PR out of draft, then " : ""}
                {MERGE_METHOD_LABELS[method].toLowerCase()} on GitHub
                {baseBranch ? <> into <code>{baseBranch}</code></> : " into the PR's base branch"}.
                This can't be undone from Alfredo.
                {needsUndraft && (
                  <>
                    {" "}
                    Marking it ready requests reviews from any code owners, so a repo that
                    requires their approval may refuse the merge — the PR would stay open,
                    out of draft.
                  </>
                )}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={dialogBusy}>
                Cancel
              </Button>
              <Button onClick={handleMerge} disabled={dialogBusy}>
                {loading === "readying"
                  ? "Marking ready\u2026"
                  : loading === "merging"
                    ? "Merging\u2026"
                    : "Merge"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Used by both draft banners below: the plain undraft, with no merge attached.
  // Absent once pressed — the lead carries "Ready for review — updating…" until
  // the poll confirms it, so the row never shows the action and its own result
  // side by side.
  const readiedLead = "Ready for review — updating…";
  const markReadyControl = readiedHere ? null : (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleMarkReady}
      disabled={loading !== null}
      className="text-[10px] px-2 py-0.5 h-auto bg-accent-primary/10 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/20 disabled:opacity-50 font-medium"
    >
      {loading === "readying" ? "Marking ready\u2026" : "Mark ready for review"}
    </Button>
  );

  // ── Approved, but not yet mergeable from here (checks still running) ──
  if (mergeable === true && reviewDecision === "approved" && !mergedHere) {
    return (
      <div className="px-2.5 py-1.5 bg-diff-added/10 border-t border-diff-added/20 text-xs text-diff-added font-semibold shrink-0 flex items-center gap-2">
        <span className="flex-1 min-w-0">
          {readiedHere
            ? readiedLead
            : needsUndraft
              ? checksRunning
                ? "Approved — draft, waiting on checks"
                : // No check runs at all: the undraft may be what starts them.
                  "Approved — still a draft"
              : "Approved — waiting on checks"}
        </span>
        {/* Undrafting mid-CI is safe; it's the merge that has to wait, so the
            combined button stays away and this one doesn't. */}
        {pr.draft && markReadyControl}
      </div>
    );
  }

  // ── Merged from here, waiting for the sync to catch up ──
  if (mergedHere) {
    return (
      <div className="px-2.5 py-1.5 bg-diff-added/10 border-t border-diff-added/20 text-xs text-diff-added font-semibold shrink-0">
        Merged &mdash; updating&hellip;
      </div>
    );
  }

  // ── Changes requested ──
  if (reviewDecision === "changes_requested") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        Changes requested
      </div>
    );
  }

  // ── Draft, not yet approved ──
  // Last of the draft branches on purpose: a conflict, a failing check or a
  // changes-requested verdict all say something more urgent than "it's a
  // draft", and each returns above.
  if (pr.draft) {
    return (
      <div className="px-2.5 py-1.5 bg-bg-secondary border-t border-border-default text-xs text-text-secondary font-semibold shrink-0 flex items-center gap-2">
        <span className="flex-1 min-w-0">{readiedHere ? readiedLead : "Draft"}</span>
        {markReadyControl}
      </div>
    );
  }

  return null;
}
