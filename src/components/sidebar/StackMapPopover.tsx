import { RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { restackStack, restackNow } from "../../api";
import { resolveStackConflict } from "../../services/stackConflictHandoff";
import { formatRelativeTime } from "../changes/formatRelativeTime";
import type { StackChain } from "../../lib/stackChain";
import type { NativeStackInfo, Worktree, StackRebaseStatus } from "../../types";

interface StackMapPopoverProps {
  anchorWorktree: Worktree;
  /** Null for native-only members: a native GitHub Stack needs no local
   *  stackParent override, so there may be no Alfredo chain to compute. */
  chain: StackChain | null;
  defaultBranch: string | null;
  onClose: () => void;
}

function stateText(s: StackRebaseStatus | null | undefined): string {
  switch (s?.kind) {
    case "behind": return `${s.count} behind`;
    case "rebasing": return "rebasing…";
    case "conflict": return "conflict on rebase";
    case "skippedDirty": return "paused — uncommitted changes";
    case "pushFailed": return "restacked · push failed";
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
  const isErrorState = kind === "conflict" || kind === "pushFailed" || kind === "rewrittenExternally";
  if (isErrorState) return stateText(m.stackRebaseStatus);
  if (m.prStatus?.merged) return "merged ✓";
  if (kind && kind !== "upToDate") return stateText(m.stackRebaseStatus);
  if (m.stackPending) {
    return m.stackPending.blockedBy === "nativeRestacked" ? "restacked by GitHub" : "restack queued";
  }
  return "up to date";
}

interface NativeStackPopoverProps {
  anchorWorktree: Worktree;
  nativeStack: NativeStackInfo;
  defaultBranch: string | null;
  onClose: () => void;
}

/** GitHub-parity rendering for a native GitHub Stack: "Stack #N" header,
 *  "Managed by GitHub" label, full roster in stack order (tip first, base-most
 *  last — mirroring GitHub's popover), current PR highlighted, base branch as
 *  the bottom row. Members with a local worktree focus it on click; siblings
 *  without one open their PR on GitHub. No restack actions — GitHub manages
 *  this stack server-side, Alfredo's automation stands down. */
function NativeStackPopover({ anchorWorktree, nativeStack, defaultBranch, onClose }: NativeStackPopoverProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
  // Backend sends the roster base-most first; GitHub renders tip-most on top
  // with the base branch at the bottom, so display order is reversed.
  const rows = [...nativeStack.members].sort((a, b) => b.position - a.position);

  const handleSelect = (member: NativeStackInfo["members"][number]) => {
    const local = worktrees.find(
      (w) => w.repoPath === anchorWorktree.repoPath && w.branch === member.branch && !w.archived,
    );
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
            {m.state === "MERGED" && <span className="flex-shrink-0">merged ✓</span>}
            {m.state === "CLOSED" && <span className="flex-shrink-0">closed</span>}
            {m.number === anchorWorktree.prStatus?.number && (
              <span className="flex-shrink-0 ml-auto">← here</span>
            )}
          </span>
        </button>
      ))}
      <div className="px-3 pt-1.5 mt-1 border-t border-border-subtle text-[11px] text-text-tertiary">
        ↳ {defaultBranch ?? "main"}
      </div>
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
  // Conflict owns the popover's action slot (buttons below); the pending
  // banner yields to it. Forked stacks: first blocked child in tree order.
  const pendingMember = conflicted
    ? undefined
    : rows.map((r) => r.worktree).find((m) => m.stackPending);
  const lastTrace = rows
    .map((r) => r.worktree.lastStackAction)
    .filter((t): t is { action: string; at: number } => Boolean(t))
    .sort((x, y) => y.at - x.at)[0];

  const handleHaveClaudeResolve = async () => {
    if (!conflicted) return;
    onClose();
    try {
      await resolveStackConflict(conflicted);
    } catch (e) {
      console.error("Conflict handoff failed:", e);
      new Notification("Alfredo", { body: `Handoff failed: ${e instanceof Error ? e.message : e}` });
    }
  };

  const handleRetryRestack = async () => {
    if (!conflicted) return;
    onClose();
    // A conflicted ROOT has no stack parent, so `restackNow` (restack_child)
    // would reject it outright — its retry is the sync that conflicted.
    const retry = conflicted.stackParent
      ? restackNow(conflicted.repoPath, conflicted.name)
      : restackStack(conflicted.repoPath, conflicted.name);
    await retry.catch(console.error);
  };

  const handleRestackStack = async () => {
    onClose();
    try {
      await restackStack(anchorWorktree.repoPath, anchorWorktree.name);
    } catch (e) {
      console.error("Sync stack with main failed:", e);
      new Notification("Alfredo", { body: `Sync stack with main failed: ${e instanceof Error ? e.message : e}` });
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
      <div className="px-3 pb-1.5 text-[10px] uppercase tracking-wider text-text-tertiary">
        Stack · {chain.total} branches
      </div>
      <div className="px-3 pb-1.5 mb-1 border-b border-border-subtle text-[11px] text-text-tertiary">
        ↳ {defaultBranch ?? "main"}
      </div>
      {pendingMember?.stackPending && (
        <div className="px-3 pb-1.5 mb-1 border-b border-border-subtle text-[11px] text-text-secondary leading-snug">
          {pendingMember.stackPending.blockedBy === "nativeRestacked" ? (
            <>
              {pendingMember.stackPending.mergedParent} was merged — GitHub restacked{" "}
              {pendingMember.branch} remotely; the local branch may be behind.
            </>
          ) : (
            <>
              {pendingMember.stackPending.mergedParent} was merged —{" "}
              {pendingMember.stackPending.blockedBy === "dirty"
                ? `waiting for uncommitted changes in ${pendingMember.branch} to clear`
                : `waiting for ${pendingMember.branch}'s agent to finish`}
              , then this stack rebases onto {defaultBranch ?? "main"}.
            </>
          )}
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
          <span className={`flex-shrink-0 text-[10px] ${m.stackRebaseStatus?.kind === "conflict" || m.stackRebaseStatus?.kind === "pushFailed" || m.stackRebaseStatus?.kind === "rewrittenExternally" ? "text-status-error" : "text-text-tertiary"}`}>
            {m.id === anchorWorktree.id
              ? memberStateText(m) === "up to date"
                ? "← here"
                : `← here · ${memberStateText(m)}`
              : memberStateText(m)}
          </span>
        </button>
      ))}
      {conflicted && (
        <div className="px-2 pt-2 flex flex-col gap-1">
          <button
            type="button"
            onClick={handleHaveClaudeResolve}
            className="w-full flex items-center justify-center gap-1.5 rounded border border-accent-primary/40 bg-accent-muted/30 py-1 text-[11px] text-accent-primary hover:bg-accent-muted"
          >
            ✳ Have Claude resolve
          </button>
          <button
            type="button"
            onClick={handleRetryRestack}
            className="w-full flex items-center justify-center gap-1.5 rounded border border-border-default py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
          >
            <RefreshCw className="h-3 w-3" /> Retry restack
          </button>
        </div>
      )}
      <div className="px-2 pt-2">
        <button
          type="button"
          onClick={handleRestackStack}
          className="w-full flex items-center justify-center gap-1.5 rounded border border-border-default py-1 text-[11px] text-text-secondary hover:bg-bg-hover"
        >
          <RefreshCw className="h-3 w-3" /> Sync stack with main
        </button>
      </div>
      {lastTrace && (
        <div className="px-3 pt-1.5 text-[10px] text-text-tertiary">
          ↻ {lastTrace.action} · {formatRelativeTime(lastTrace.at / 1000)}
        </div>
      )}
    </div>
  );
}

export { StackMapPopover };
