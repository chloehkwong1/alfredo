import { GitFork, Layers } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { StackChain } from "../../lib/stackChain";
import type { PrStatus, Worktree } from "../../types";

interface StackGlyphProps {
  worktree: Worktree;
  chain: StackChain;
  onOpenMap: () => void;
}

/** Compact `⧉ pos/total` chip marking stack membership. Hover peeks the whole
 *  stack across the sidebar; click opens the stack map popover. Lives inside a
 *  dnd-kit sortable row — every handler stops propagation. */
function StackGlyph({ worktree, chain, onOpenMap }: StackGlyphProps) {
  const setPeeked = useWorkspaceStore((s) => s.setPeekedStackRoot);
  const rebasing = worktree.stackRebaseStatus?.kind === "rebasing";
  // Roots carry the whole stack — give them a filled chip so "other branches
  // depend on this one" is visible at a glance; children stay muted.
  const isRoot = !worktree.stackParent;
  // Forked stacks swap the layers icon for a fork: position is a depth (shared
  // by siblings), and the map is where the tree shape lives.
  const Icon = chain.forked ? GitFork : Layers;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenMap();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseEnter={() => setPeeked(chain.rootId)}
      onMouseLeave={() => setPeeked(null)}
      className={`relative flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] text-accent-primary transition-colors cursor-pointer ${
        isRoot
          ? "bg-accent-primary/20 border border-accent-primary/40 font-medium hover:bg-accent-primary/30"
          : "bg-accent-muted/40 hover:bg-accent-muted"
      }`}
      aria-label={
        (isRoot
          ? `Stack root, position 1 of ${chain.total}`
          : `Stack position ${chain.position} of ${chain.total}`)
        + (chain.needsAttention ? ", a branch needs attention" : "")
        + " — open stack map"
      }
      title={
        (isRoot ? `Stack root — ${chain.position}/${chain.total}` : `Stack ${chain.position}/${chain.total}`)
        + (chain.needsAttention ? " — a branch in this stack needs attention, click for details" : "")
      }
    >
      <Icon className={`h-3 w-3 ${rebasing ? "animate-spin" : ""}`} />
      {`${chain.position}/${chain.total}`}
      {chain.needsAttention && (
        <span className="absolute -top-1 -right-1 text-[10px] font-bold text-amber-400">!</span>
      )}
    </button>
  );
}

/** "N/M" label for the native-stack chip beside the PR number pill. Null when
 *  the PR isn't a native GitHub Stack member — the chip renders nothing. */
function nativeStackChipLabel(prStatus: PrStatus | null | undefined): string | null {
  const ns = prStatus?.nativeStack;
  return ns ? `${ns.position}/${ns.size}` : null;
}

interface NativeStackChipProps {
  prStatus: PrStatus | null | undefined;
  onOpenMap: () => void;
}

/** GitHub-parity `⧉ pos/size` chip for PRs in a native GitHub Stack — mirrors
 *  the stack-count chip GitHub shows beside the PR state. Renders even when
 *  the worktree has no Alfredo stack override (native members usually don't).
 *  Click opens the same stack map popover as StackGlyph. Lives inside a
 *  dnd-kit sortable row — every handler stops propagation. */
function NativeStackChip({ prStatus, onOpenMap }: NativeStackChipProps) {
  const label = nativeStackChipLabel(prStatus);
  if (!label) return null;
  const ns = prStatus!.nativeStack!;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenMap();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] text-accent-primary bg-accent-muted/40 hover:bg-accent-muted transition-colors cursor-pointer"
      aria-label={`Stack position ${ns.position} of ${ns.size} in GitHub stack #${ns.number} — open stack map`}
      title={`Stack #${ns.number} · ${ns.position}/${ns.size} — managed by GitHub`}
    >
      <Layers className="h-3 w-3" />
      {label}
    </button>
  );
}

export { StackGlyph, NativeStackChip, nativeStackChipLabel };
