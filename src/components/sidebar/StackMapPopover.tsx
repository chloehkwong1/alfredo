import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { RefreshCw, ArrowUp } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useToastStore } from "../../stores/toastStore";
import { restackStack, restackNow, resolveStackPending, getAheadBehindOrigin, pushStackBranch } from "../../api";
import type { RestackOutcome, RestackStackSummary } from "../../api";
import { resolveStackConflict } from "../../services/stackConflictHandoff";
import { formatRelativeTime } from "../changes/formatRelativeTime";
import type { StackChain } from "../../lib/stackChain";
import type { NativeStackInfo, Worktree, StackRebaseStatus, StackPendingAction } from "../../types";

/** Toast copy for a manual restack that succeeded at the git level — the
 *  outcome says whether a rebase actually ran, so the message can't claim
 *  work that a dirty-skip or no-op didn't do. */
function restackOutcomeMessage(outcome: RestackOutcome, branch: string): string {
  switch (outcome) {
    case "rebased": return `Restacked ${branch} ✓`;
    case "alreadyUpToDate": return `${branch} is already up to date`;
    case "skippedDirty": return `Restack paused — uncommitted changes in ${branch}`;
    // Conflict resolution in progress, NOT uncommitted changes to commit or
    // stash — the copy must not tell the user to do something destructive
    // mid conflict-handoff.
    case "skippedRebaseInProgress": return `Restack paused — conflict resolution in progress in ${branch}`;
    // A wire string this build doesn't know — a newer backend variant, or one
    // that today only surfaces as Err. Report it verbatim rather than guess at
    // a friendlier (and possibly opposite) meaning.
    default: return `Restack finished: ${String(outcome)}`;
  }
}

/** Toast copy for a whole-stack sync. `restack_stack` resolves Ok even when
 *  members were dirty-skipped or there was nothing to sync, so the success
 *  message must consult the summary instead of celebrating unconditionally. */
function stackSyncMessage(summary: RestackStackSummary, subject: string): string {
  if (summary.noStack) return "Nothing to sync — no stacked branches";
  const caveats: string[] = [];
  const dirty = summary.skippedDirty;
  if (dirty.length === 1) caveats.push(`${dirty[0]} paused (uncommitted changes)`);
  else if (dirty.length > 1) caveats.push(`${dirty.length} branches paused (uncommitted changes)`);
  // Conflict resolution in progress, NOT uncommitted changes — kept as its own
  // caveat so the copy never gives "commit or stash" advice mid conflict-handoff.
  const conflicting = summary.rebaseInProgress;
  if (conflicting.length === 1) caveats.push(`${conflicting[0]} paused (conflict resolution in progress)`);
  else if (conflicting.length > 1) {
    caveats.push(`${conflicting.length} branches paused (conflict resolution in progress)`);
  }
  // The root's own sync state is unknown (not a benign "already synced" skip)
  // — a bare "✓" would be a false positive, so it always earns a caveat.
  if (summary.rootSkipReason) caveats.push(`root skipped: ${summary.rootSkipReason}`);
  // Failures ride in the summary (not a rejected promise) precisely so the
  // caveats above still reach the user alongside them — and they replace the
  // subject's success claim with an honest "incomplete".
  const failed = summary.errors ?? [];
  if (failed.length === 1) caveats.push(`failed — ${failed[0]}`);
  else if (failed.length > 1) caveats.push(`${failed.length} branches failed — ${failed[0]}`);
  if (failed.length > 0) return `Stack sync incomplete — ${caveats.join("; ")}`;
  if (caveats.length > 0) return `${subject} — ${caveats.join("; ")}`;
  return `${subject} ✓`;
}

/** Run a manual single-branch restack and toast the outcome. The one path for
 *  every "Restack now"-shaped action (popover footer, conflict retry, sidebar
 *  context menu) so the toast choreography can't drift between call sites. */
async function restackNowWithToast(repoPath: string, worktreeName: string, branch: string): Promise<void> {
  const showToast = useToastStore.getState().show;
  try {
    const outcome = await restackNow(repoPath, worktreeName);
    showToast({ message: restackOutcomeMessage(outcome, branch) });
  } catch (e) {
    console.error("Restack failed:", e);
    showToast({ message: `Restack failed: ${e instanceof Error ? e.message : e}` });
  }
}

/** Whole-stack counterpart of `restackNowWithToast`, shared by the Alfredo
 *  skin's footer and the conflicted-root retry. */
async function syncStackWithToast(repoPath: string, worktreeName: string, subject: string): Promise<void> {
  const showToast = useToastStore.getState().show;
  try {
    const summary = await restackStack(repoPath, worktreeName);
    showToast({ message: stackSyncMessage(summary, subject) });
  } catch (e) {
    console.error("Stack sync failed:", e);
    showToast({ message: `Stack sync failed: ${e instanceof Error ? e.message : e}` });
  }
}

/** First member (display order) whose local restack awaits an explicit push
 *  — the popover's Push-now target. */
function firstNeedsPush(members: Worktree[]): Worktree | undefined {
  return members.find((w) => w.stackRebaseStatus?.kind === "needsPush");
}

/** Run the explicit push for a NeedsPush member and toast the outcome. */
async function pushNowWithToast(wt: Worktree): Promise<void> {
  const showToast = useToastStore.getState().show;
  try {
    await pushStackBranch(wt.repoPath, wt.name);
    showToast({ message: `Pushed ${wt.branch} ✓` });
  } catch (e) {
    console.error("Push failed:", e);
    showToast({ message: `Push failed: ${e instanceof Error ? e.message : e}` });
  }
}

/** "N to push" / "diverged from origin" label for a member whose local tip
 *  has commits origin lacks. Null when in sync, never published, or only
 *  behind (that's pull territory, not this cue's job). Ahead AND behind
 *  origin has two distinct causes we can't cheaply tell apart: a local
 *  rewrite (autosquash), where force-push is genuinely the fix, or origin
 *  having gained a teammate's commits on the same branch (e.g. a
 *  review-request worktree tracking someone else's PR branch), where
 *  force-pushing would destroy their work. The wording stays neutral rather
 *  than prescribing force-push. */
function originCue(ab: [number, number] | null | undefined): string | null {
  if (!ab || ab[0] === 0) return null;
  return ab[1] === 0 ? `${ab[0]} to push` : "diverged from origin";
}

/** worktree.id → [ahead, behind] vs origin for every local stack member,
 *  fetched once per popover open. The first member goes alone: the backend's
 *  per-repo fetch throttle only stamps its 30s slot AFTER a successful fetch,
 *  so a straight fan-out would race N `git fetch` subprocesses past the check
 *  on every cold open. Once the first call has stamped the slot, the rest run
 *  in parallel and coalesce onto it. */
function useOriginSync(members: Worktree[]): Record<string, [number, number] | null> {
  const [sync, setSync] = useState<Record<string, [number, number] | null>>({});
  const memberKey = members.map((w) => w.id).join("\n");
  useEffect(() => {
    let cancelled = false;
    const fetchOne = async (w: Worktree) => {
      try {
        return [w.id, await getAheadBehindOrigin(w.path, w.repoPath)] as const;
      } catch {
        return [w.id, null] as const;
      }
    };
    (async () => {
      if (members.length === 0) return;
      const first = await fetchOne(members[0]);
      const rest = await Promise.all(members.slice(1).map(fetchOne));
      if (!cancelled) setSync(Object.fromEntries([first, ...rest]));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey]);
  return sync;
}

/** Amber push-state cue for a stack-member row — one rendering for both
 *  popover skins. `sep` adds the Alfredo skin's trailing dot separator.
 *  Renders nothing when the member is in sync with origin. */
function OriginCue({ ab, sep = false }: { ab: [number, number] | null | undefined; sep?: boolean }) {
  const cue = originCue(ab);
  if (!cue) return null;
  return <span className="flex-shrink-0 text-[10px] text-amber-400">{cue}{sep ? " ·" : ""}</span>;
}

/** Dense footer action shared by every popover action row — deliberately
 *  smaller than the ui/Button sizes, which are dialog-scaled. */
function PopoverActionButton({ onClick, title, children }: {
  onClick: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="w-full flex items-center justify-center gap-1.5 rounded border border-border-default py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
    >
      {children}
    </button>
  );
}

interface StackMapPopoverProps {
  anchorWorktree: Worktree;
  /** Null for native-only members: a native GitHub Stack needs no local
   *  stackParent override, so there may be no Alfredo chain to compute. */
  chain: StackChain | null;
  defaultBranch: string | null;
  onClose: () => void;
}

/** States that mean the branch needs action (rendered error-red) rather than
 *  merely being in flux — shared by both skins' row colouring and the
 *  merged-outranking rule in `memberStateText`. */
const STACK_ERROR_KINDS = new Set(["conflict", "pushFailed", "rewrittenExternally"]);

function isStackErrorKind(kind: string | undefined): boolean {
  return kind != null && STACK_ERROR_KINDS.has(kind);
}

function stateText(s: StackRebaseStatus | null | undefined): string {
  switch (s?.kind) {
    case "behind": return `${s.count} behind`;
    case "rebasing": return "rebasing…";
    case "conflict": return "conflict on rebase";
    case "skippedDirty": return "paused — uncommitted changes";
    case "pushFailed": return "restacked · push failed";
    case "needsPush": return "restacked · push to update PR";
    case "rewrittenExternally": return "rebased outside Alfredo — restack manually";
    default: return "up to date";
  }
}

/** Row label: error state > merged > active status > queued pending > up to
 *  date. Merged is terminal, so only conflict/pushFailed/rewrittenExternally
 *  — states that mean the branch itself needs action even though its PR
 *  landed — may outrank it; behind/rebasing/skippedDirty must not, or a
 *  merged PR would show a stale "5 behind" that self-resolves once the poll
 *  catches up. Without this ordering "merged ✓" hid those error states while
 *  the row's className still rendered error-red — a contradictory row. */
function memberStateText(m: Worktree): string {
  const kind = m.stackRebaseStatus?.kind;
  if (isStackErrorKind(kind)) return stateText(m.stackRebaseStatus);
  if (m.prStatus?.merged) return "merged ✓";
  if (kind && kind !== "upToDate") return stateText(m.stackRebaseStatus);
  if (m.stackPending) {
    return m.stackPending.blockedBy === "nativeRestacked" ? "restacked by GitHub" : "restack queued";
  }
  return "up to date";
}

/** Row-state colour, shared by both skins: error states red, benign states
 *  ("up to date", "merged ✓") muted — and everything in between amber, so the
 *  text explaining the chip's amber "!" is visually tied to it instead of
 *  hiding in the same grey as the branch name. */
function memberStateClass(m: Worktree): string {
  if (isStackErrorKind(m.stackRebaseStatus?.kind)) return "text-status-error";
  const st = memberStateText(m);
  return st === "up to date" || st === "merged ✓" ? "text-text-tertiary" : "text-amber-400";
}

/** Banner copy for a merged-parent pending — one wording for both popover
 *  skins, covering every blockedBy variant so no pending can light the chip's
 *  amber "!" without the popover explaining it. */
function stackPendingNotice(pending: StackPendingAction, branch: string, defaultBranch: string | null): string {
  if (pending.blockedBy === "nativeRestacked") {
    return `${pending.mergedParent} was merged — GitHub restacked ${branch} remotely; the local branch may be behind.`;
  }
  const waiting =
    pending.blockedBy === "dirty"
      ? `waiting for uncommitted changes in ${branch} to clear`
      : pending.blockedBy === "rebaseInProgress"
        ? `waiting for ${branch}'s in-progress rebase to finish`
        : `waiting for ${branch}'s agent to finish`;
  return `${pending.mergedParent} was merged — ${waiting}, then this stack rebases onto ${defaultBranch ?? "main"}.`;
}

interface NativeStackPopoverProps {
  anchorWorktree: Worktree;
  nativeStack: NativeStackInfo;
  defaultBranch: string | null;
  onClose: () => void;
}

/** "Have Claude resolve" + "Retry restack" for a conflicted stack member.
 *  Shared by both popover skins: a conflict is always local, so the actions
 *  apply even when GitHub manages the stack itself. */
function ConflictActions({ conflicted, onClose }: { conflicted: Worktree; onClose: () => void }) {
  const handleHaveClaudeResolve = async () => {
    onClose();
    try {
      await resolveStackConflict(conflicted);
    } catch (e) {
      console.error("Conflict handoff failed:", e);
      new Notification("Alfredo", { body: `Handoff failed: ${e instanceof Error ? e.message : e}` });
    }
  };

  const handleRetryRestack = () => {
    onClose();
    // A conflicted ROOT has no stack parent, so `restackNow` (restack_child)
    // would reject it outright — its retry is the sync that conflicted.
    if (conflicted.stackParent) {
      void restackNowWithToast(conflicted.repoPath, conflicted.name, conflicted.branch);
    } else {
      void syncStackWithToast(conflicted.repoPath, conflicted.name, `Synced ${conflicted.branch}'s stack`);
    }
  };

  return (
    <div className="px-2 pt-2 flex flex-col gap-1">
      <button
        type="button"
        onClick={handleHaveClaudeResolve}
        className="w-full flex items-center justify-center gap-1.5 rounded border border-accent-primary/40 bg-accent-muted/30 py-1 text-[11px] text-accent-primary hover:bg-accent-muted"
      >
        ✳ Have Claude resolve
      </button>
      <PopoverActionButton onClick={handleRetryRestack}>
        <RefreshCw className="h-3 w-3" /> Retry restack
      </PopoverActionButton>
    </div>
  );
}

/** Roster note for native-stack members the backend query can't return: it
 *  only fetches OPEN PRs, so merged/closed members vanish from `members`
 *  while `size` still counts them. Null when the full roster is present. */
function hiddenMembersNote(size: number, shownCount: number): string | null {
  const hidden = size - shownCount;
  if (hidden <= 0) return null;
  return `${hidden} merged or closed PR${hidden === 1 ? "" : "s"} not shown`;
}

/** GitHub-parity rendering for a native GitHub Stack: "Stack #N" header,
 *  "Managed by GitHub" label, full roster in stack order (tip first, base-most
 *  last — mirroring GitHub's popover), current PR highlighted, base branch as
 *  the bottom row. Members with a local worktree focus it on click; siblings
 *  without one open their PR on GitHub. GitHub's automation only restacks
 *  around merges — local parent rewrites still need Alfredo's restack, so
 *  members that keep a local stack link get restack/conflict actions in the
 *  footer; pure native members (no local link) get none. */
function NativeStackPopover({ anchorWorktree, nativeStack, defaultBranch, onClose }: NativeStackPopoverProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
  // The backend no longer auto-sweeps nativeRestacked pendings — the notice
  // persists until the user dismisses it here (resolve_stack_pending).
  const [pendingDismissed, setPendingDismissed] = useState(false);
  // Backend sends the roster base-most first; GitHub renders tip-most on top
  // with the base branch at the bottom, so display order is reversed.
  const rows = [...nativeStack.members].sort((a, b) => b.position - a.position);
  const hiddenNote = hiddenMembersNote(nativeStack.size, rows.length);
  // The one branch→local-worktree predicate for this skin — row cues and
  // click-to-focus must agree on what counts as "local".
  const localFor = (branch: string) =>
    worktrees.find(
      (w) => w.repoPath === anchorWorktree.repoPath && w.branch === branch && !w.archived,
    );
  const localByBranch = new Map(
    rows
      .map((m) => localFor(m.branch))
      .filter((w): w is Worktree => Boolean(w))
      .map((w) => [w.branch, w] as const),
  );
  // A rebase conflict is always a local-tree problem, so the resolve/retry
  // actions stay reachable here. First conflicted local member in tip-first
  // display order, mirroring AlfredoStackPopover's pick.
  const conflicted = rows
    .map((m) => localByBranch.get(m.branch))
    .find((w) => w?.stackRebaseStatus?.kind === "conflict");
  // A local restack that hasn't been pushed yet — the popover's other
  // footer-eligible action. Conflict takes precedence over it too.
  const needsPushWt = conflicted
    ? undefined
    : firstNeedsPush([anchorWorktree, ...localByBranch.values()]);
  // Conflict owns the popover's action slot, so the pending banner yields to
  // it (mirroring AlfredoStackPopover). The anchor's pending wins, then roster
  // locals in tip-first order — the chip's "!" scans the whole local chain, so
  // the pending that lit it may belong to a sibling, not the anchor.
  const pendingWt = conflicted
    ? undefined
    : [anchorWorktree, ...localByBranch.values()].find((w) => w.stackPending);
  const originSync = useOriginSync([...localByBranch.values()]);

  const handleRestackNow = () => {
    onClose();
    void restackNowWithToast(anchorWorktree.repoPath, anchorWorktree.name, anchorWorktree.branch);
  };

  const handleDismissPending = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!pendingWt) return;
    setPendingDismissed(true);
    resolveStackPending(pendingWt.repoPath, pendingWt.name).catch((err) => {
      console.error("Failed to resolve stack pending:", err);
    });
  };

  const handleSelect = (member: NativeStackInfo["members"][number]) => {
    const local = localFor(member.branch);
    onClose();
    if (local) {
      setActiveWorktree(local.id);
    } else if (member.url) {
      openUrl(member.url).catch((e) => console.error("Failed to open PR:", e));
    }
  };

  return (
    <div
      className="w-72 rounded-md border border-border-default bg-bg-primary shadow-lg py-2"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 pb-0.5 text-[10px] uppercase tracking-wider text-text-tertiary">
        Stack #{nativeStack.number} · {nativeStack.size} PRs
      </div>
      <div className="px-3 pb-1.5 mb-1 border-b border-border-subtle text-[11px] text-text-tertiary">
        Managed by GitHub
      </div>
      {pendingWt?.stackPending && !pendingDismissed && (
        <div className="px-3 pb-1.5 mb-1 border-b border-border-subtle text-[11px] text-text-secondary leading-snug flex items-start gap-2">
          <span className="flex-1">
            {stackPendingNotice(pendingWt.stackPending, pendingWt.branch, defaultBranch)}
          </span>
          {/* Deferred restacks auto-clear when the restack runs; only the
              nativeRestacked notice persists until dismissed, so only it gets
              the × (matching the Alfredo skin, which has no dismiss at all). */}
          {pendingWt.stackPending.blockedBy === "nativeRestacked" && (
            <button
              type="button"
              aria-label="Dismiss restacked notice"
              onClick={handleDismissPending}
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              className="flex-shrink-0 px-1 -mr-1 text-text-tertiary hover:text-text-primary"
            >
              ×
            </button>
          )}
        </div>
      )}
      {rows.map((m) => (
        <button
          key={m.number}
          type="button"
          onClick={() => handleSelect(m)}
          className={[
            "w-full flex flex-col gap-0.5 px-3 py-1.5 text-left text-xs",
            m.number === anchorWorktree.prStatus?.number ? "bg-accent-muted/40" : "hover:bg-bg-hover",
          ].join(" ")}
        >
          <span className="flex items-center gap-2">
            <span className="truncate flex-1">{m.title}</span>
            <span className="flex-shrink-0 text-text-tertiary">#{m.number}</span>
          </span>
          <span className="flex items-center gap-2 text-[10px] text-text-tertiary">
            <span className="truncate font-mono">{m.branch}</span>
            {(() => {
              const local = localByBranch.get(m.branch);
              if (!local) return null;
              // Same row-state text as the Alfredo skin — every state that can
              // light the chip's "!" must be nameable here. "merged ✓" is
              // skipped: the roster's own MERGED label below already covers it.
              const st = memberStateText(local);
              return (
                <>
                  <OriginCue ab={originSync[local.id]} />
                  {st !== "up to date" && st !== "merged ✓" && (
                    <span className={`flex-shrink-0 ${memberStateClass(local)}`}>
                      {st}
                    </span>
                  )}
                </>
              );
            })()}
            {m.state === "MERGED" && <span className="flex-shrink-0">merged ✓</span>}
            {m.state === "CLOSED" && <span className="flex-shrink-0">closed</span>}
            {m.number === anchorWorktree.prStatus?.number && (
              <span className="flex-shrink-0 ml-auto">← here</span>
            )}
          </span>
        </button>
      ))}
      {hiddenNote && (
        <div className="px-3 py-1.5 text-[10px] italic text-text-tertiary">{hiddenNote}</div>
      )}
      <div className="px-3 pt-1.5 mt-1 border-t border-border-subtle text-[11px] text-text-tertiary">
        ↳ {defaultBranch ?? "main"}
      </div>
      {conflicted ? (
        <ConflictActions conflicted={conflicted} onClose={onClose} />
      ) : (
        anchorWorktree.stackParent && (
          <div className="px-2 pt-2">
            <PopoverActionButton
              onClick={handleRestackNow}
              title={`Rebase this branch onto its local parent (${anchorWorktree.stackParent}) — GitHub only restacks around merges`}
            >
              <RefreshCw className="h-3 w-3" /> Restack now
            </PopoverActionButton>
          </div>
        )
      )}
      {needsPushWt && (
        <div className="px-2 pt-2">
          <PopoverActionButton
            onClick={() => { onClose(); void pushNowWithToast(needsPushWt); }}
            title={`Push ${needsPushWt.branch} (with lease) to update its PR`}
          >
            <ArrowUp className="h-3 w-3" /> Push {needsPushWt.branch}
          </PopoverActionButton>
        </div>
      )}
    </div>
  );
}

/** Popover opened from `StackGlyph` — tree view of the whole stack (base
 *  branch pinned at the top, root→tips reading downward like a file tree, so
 *  forks stay legible). Click-to-jump per member, plus a footer action to
 *  restack the whole tree. Lives inside a dnd-kit sortable row — every handler
 *  stops propagation so drag listeners and the row's own onClick never fire.
 *  Native GitHub Stack members render GitHub-style instead (one surface, two
 *  skins) — see NativeStackPopover. */
function StackMapPopover({ anchorWorktree, chain, defaultBranch, onClose }: StackMapPopoverProps) {
  const nativeStack = anchorWorktree.prStatus?.nativeStack;
  if (nativeStack) {
    return (
      <NativeStackPopover
        anchorWorktree={anchorWorktree}
        nativeStack={nativeStack}
        defaultBranch={defaultBranch}
        onClose={onClose}
      />
    );
  }
  if (!chain) return null;
  return <AlfredoStackPopover anchorWorktree={anchorWorktree} chain={chain} defaultBranch={defaultBranch} onClose={onClose} />;
}

/** Alfredo-managed (non-native) stack rendering — unchanged behaviour. */
function AlfredoStackPopover({ anchorWorktree, chain, defaultBranch, onClose }: StackMapPopoverProps & { chain: StackChain }) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
  const rows = chain.members
    .map((member) => ({ member, worktree: worktrees.find((w) => w.id === member.id) }))
    .filter((r): r is { member: (typeof chain.members)[number]; worktree: Worktree } => Boolean(r.worktree));
  const conflicted = rows.map((r) => r.worktree).find((m) => m.stackRebaseStatus?.kind === "conflict");
  // A local restack that hasn't been pushed yet — conflict still takes
  // precedence over it for the footer's action slot.
  const needsPushWt = conflicted ? undefined : firstNeedsPush(rows.map((r) => r.worktree));
  const originSync = useOriginSync(rows.map((r) => r.worktree));
  // Conflict owns the popover's action slot (buttons below); the pending
  // banner yields to it. Forked stacks: first blocked child in tree order.
  const pendingMember = conflicted
    ? undefined
    : rows.map((r) => r.worktree).find((m) => m.stackPending);
  const lastTrace = rows
    .map((r) => r.worktree.lastStackAction)
    .filter((t): t is { action: string; at: number } => Boolean(t))
    .sort((x, y) => y.at - x.at)[0];

  const handleRestackStack = () => {
    onClose();
    void syncStackWithToast(anchorWorktree.repoPath, anchorWorktree.name, "Stack synced with main");
  };

  return (
    <div
      className="w-72 rounded-md border border-border-default bg-bg-primary shadow-lg py-2"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 pb-1.5 text-[10px] uppercase tracking-wider text-text-tertiary">
        Stack · {chain.total} branches
      </div>
      <div className="px-3 pb-1.5 mb-1 border-b border-border-subtle text-[11px] text-text-tertiary">
        ↳ {defaultBranch ?? "main"}
      </div>
      {pendingMember?.stackPending && (
        <div className="px-3 pb-1.5 mb-1 border-b border-border-subtle text-[11px] text-text-secondary leading-snug">
          {stackPendingNotice(pendingMember.stackPending, pendingMember.branch, defaultBranch)}
        </div>
      )}
      {rows.map(({ member, worktree: m }) => (
        <button
          key={m.id}
          type="button"
          onClick={() => { setActiveWorktree(m.id); onClose(); }}
          className={[
            "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs",
            m.id === anchorWorktree.id ? "bg-accent-muted/40" : "hover:bg-bg-hover",
          ].join(" ")}
        >
          <span className="flex-shrink-0 font-mono text-[11px] leading-none whitespace-pre text-text-tertiary opacity-60">
            {member.prefix}
          </span>
          <span className="truncate flex-1">{m.branch}</span>
          <OriginCue ab={originSync[m.id]} sep />

          <span className={`flex-shrink-0 text-[10px] ${memberStateClass(m)}`}>
            {m.id === anchorWorktree.id
              ? memberStateText(m) === "up to date"
                ? "← here"
                : `← here · ${memberStateText(m)}`
              : memberStateText(m)}
          </span>
        </button>
      ))}
      {conflicted && <ConflictActions conflicted={conflicted} onClose={onClose} />}
      <div className="px-2 pt-2">
        <PopoverActionButton onClick={handleRestackStack}>
          <RefreshCw className="h-3 w-3" /> Sync stack with main
        </PopoverActionButton>
      </div>
      {needsPushWt && (
        <div className="px-2 pt-2">
          <PopoverActionButton
            onClick={() => { onClose(); void pushNowWithToast(needsPushWt); }}
            title={`Push ${needsPushWt.branch} (with lease) to update its PR`}
          >
            <ArrowUp className="h-3 w-3" /> Push {needsPushWt.branch}
          </PopoverActionButton>
        </div>
      )}
      {lastTrace && (
        <div className="px-3 pt-1.5 text-[10px] text-text-tertiary">
          ↻ {lastTrace.action} · {formatRelativeTime(lastTrace.at / 1000)}
        </div>
      )}
    </div>
  );
}

export { StackMapPopover, hiddenMembersNote, restackOutcomeMessage, stackSyncMessage, restackNowWithToast, originCue, memberStateText, memberStateClass, stackPendingNotice, firstNeedsPush };
