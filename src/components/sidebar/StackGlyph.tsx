import type { CSSProperties } from "react";
import { GitFork, Layers } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { StackChain } from "../../lib/stackChain";
import type { PrStatus, Worktree } from "../../types";

/** Shared chip styling; hue-coded when ≥2 stacks coexist (`hue` set by
 *  AgentItem), accent-tinted otherwise. `.stack-hue` lives in globals.css and
 *  reads the palette slot from the inline `--stack-chip-hue` property. */
function chipClassName(hue: number | null | undefined): string {
  return [
    "relative flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] transition-colors cursor-pointer",
    hue != null ? "stack-hue" : "text-accent-primary bg-accent-muted/40 hover:bg-accent-muted",
  ].join(" ");
}

function chipStyle(hue: number | null | undefined): CSSProperties | undefined {
  return hue != null ? { ["--stack-chip-hue" as string]: `var(--stack-hue-${hue})` } : undefined;
}

interface StackGlyphProps {
  worktree: Worktree;
  chain: StackChain;
  onOpenMap: () => void;
  /** Palette slot distinguishing this stack from other visible ones; null
   *  keeps the accent tint (single stack on screen). */
  hue?: number | null;
}

/** Compact `⧉ pos/total` chip marking stack membership. Hover peeks the whole
 *  stack across the sidebar; click opens the stack map popover. Lives inside a
 *  dnd-kit sortable row — every handler stops propagation. */
function StackGlyph({ worktree, chain, onOpenMap, hue = null }: StackGlyphProps) {
  const setPeeked = useWorkspaceStore((s) => s.setPeekedStackRoot);
  const rebasing = worktree.stackRebaseStatus?.kind === "rebasing";
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
      className={chipClassName(hue)}
      style={chipStyle(hue)}
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
  /** Root id of the worktree's local Alfredo chain, when one still exists —
   *  converted stacks keep StackGlyph's hover-peek through this chip. */
  peekRootId?: string;
  /** A branch in the stack (or this card's own restack machinery) needs
   *  action — renders StackGlyph's amber "!" badge so the trouble is visible
   *  from the card, not only inside the popover. */
  needsAttention?: boolean;
  /** Palette slot distinguishing this stack from other visible ones; null
   *  keeps the accent tint (single stack on screen). */
  hue?: number | null;
}

/** GitHub-parity `⧉ pos/size` chip for PRs in a native GitHub Stack — mirrors
 *  the stack-count chip GitHub shows beside the PR state. Renders even when
 *  the worktree has no Alfredo stack override (native members usually don't).
 *  Click opens the same stack map popover as StackGlyph. Lives inside a
 *  dnd-kit sortable row — every handler stops propagation. */
function NativeStackChip({ prStatus, onOpenMap, peekRootId, needsAttention = false, hue = null }: NativeStackChipProps) {
  const setPeeked = useWorkspaceStore((s) => s.setPeekedStackRoot);
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
      onMouseEnter={() => peekRootId && setPeeked(peekRootId)}
      onMouseLeave={() => peekRootId && setPeeked(null)}
      className={chipClassName(hue)}
      style={chipStyle(hue)}
      aria-label={
        `Stack position ${ns.position} of ${ns.size} in GitHub stack #${ns.number}`
        + (needsAttention ? ", a branch needs attention" : "")
        + " — open stack map"
      }
      title={
        `Stack #${ns.number} · ${ns.position}/${ns.size} — managed by GitHub`
        + (needsAttention ? " — a branch in this stack needs attention, click for details" : "")
      }
    >
      <Layers className="h-3 w-3" />
      {label}
      {needsAttention && (
        <span className="absolute -top-1 -right-1 text-[10px] font-bold text-amber-400">!</span>
      )}
    </button>
  );
}

export { StackGlyph, NativeStackChip, nativeStackChipLabel };
