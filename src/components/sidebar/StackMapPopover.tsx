import { GitBranch, RefreshCw } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { restackStack, restackNow, prepareConflictHandoff } from "../../api";
import { ensureAgentSession, writeToSession, focusAgentTab } from "../../services/agentMessenger";
import type { StackChain } from "../../lib/stackChain";
import type { Worktree, StackRebaseStatus } from "../../types";

interface StackMapPopoverProps {
  anchorWorktree: Worktree;
  chain: StackChain;
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
    default: return "up to date";
  }
}

/** Popover opened from `StackGlyph` — rail view of the whole stack chain
 *  (newest/tip first, base branch pinned at the bottom). Click-to-jump per
 *  member, plus a footer action to restack the whole chain. Lives inside a
 *  dnd-kit sortable row — every handler stops propagation so drag listeners
 *  and the row's own onClick never fire. */
function StackMapPopover({ anchorWorktree, chain, defaultBranch, onClose }: StackMapPopoverProps) {
  const worktrees = useWorkspaceStore((s) => s.worktrees);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
  const members = chain.memberIds
    .map((id) => worktrees.find((w) => w.id === id))
    .filter((w): w is Worktree => Boolean(w));
  const conflicted = members.find((m) => m.stackRebaseStatus?.kind === "conflict");

  const handleHaveClaudeResolve = async () => {
    if (!conflicted) return;
    onClose();
    try {
      const prompt = await prepareConflictHandoff(conflicted.repoPath, conflicted.name);
      if (prompt === "__no_conflict__") return;
      const session = await ensureAgentSession(conflicted.id, conflicted.repoPath, conflicted.branch);
      await writeToSession(session.sessionId, `${prompt}\n`);
      setActiveWorktree(conflicted.id);
      focusAgentTab(conflicted.id);
    } catch (e) {
      console.error("Conflict handoff failed:", e);
      new Notification("Alfredo", { body: `Handoff failed: ${e instanceof Error ? e.message : e}` });
    }
  };

  const handleRetryRestack = async () => {
    if (!conflicted) return;
    onClose();
    await restackNow(conflicted.repoPath, conflicted.name).catch(console.error);
  };

  const handleRestackStack = async () => {
    onClose();
    try {
      await restackStack(anchorWorktree.repoPath, anchorWorktree.name);
    } catch (e) {
      console.error("Restack stack failed:", e);
      new Notification("Alfredo", { body: `Restack stack failed: ${e instanceof Error ? e.message : e}` });
    }
  };

  return (
    <div
      className="w-64 rounded-md border border-border-default bg-bg-primary shadow-lg py-2"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 pb-1.5 text-[10px] uppercase tracking-wider text-text-tertiary">
        Stack · {chain.total} branches
      </div>
      {[...members].reverse().map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => { setActiveWorktree(m.id); onClose(); }}
          className={[
            "w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs",
            m.id === anchorWorktree.id ? "bg-accent-muted/40" : "hover:bg-bg-hover",
          ].join(" ")}
        >
          <GitBranch className="h-3 w-3 flex-shrink-0 opacity-50" />
          <span className="truncate flex-1">{m.branch}</span>
          <span className={`flex-shrink-0 text-[10px] ${m.stackRebaseStatus?.kind === "conflict" || m.stackRebaseStatus?.kind === "pushFailed" ? "text-status-error" : "text-text-tertiary"}`}>
            {m.id === anchorWorktree.id ? "← here" : stateText(m.stackRebaseStatus)}
          </span>
        </button>
      ))}
      <div className="px-3 pt-1.5 mt-1 border-t border-border-subtle text-[11px] text-text-tertiary">
        ↳ {defaultBranch ?? "main"}
      </div>
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
          <RefreshCw className="h-3 w-3" /> Restack stack
        </button>
      </div>
    </div>
  );
}

export { StackMapPopover };
