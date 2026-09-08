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
  // Unified numbers (native roster grafted in) when the chain touches a native
  // GitHub Stack; local depth/count otherwise.
  const { position, total } = chain.unified ?? { position: chain.position, total: chain.total };
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
          ? `Stack root, position ${position} of ${total}`
          : `Stack position ${position} of ${total}`)
        + (chain.selfNeedsAttention ? ", this branch needs attention" : "")
        + " — open stack map"
      }
      title={
        (isRoot ? `Stack root — ${position}/${total}` : `Stack ${position}/${total}`)
        + (chain.selfNeedsAttention ? " — this branch needs attention, click for details" : "")
      }
    >
      <Icon className={`h-3 w-3 ${rebasing ? "animate-spin" : ""}`} />
      {`${position}/${total}`}
      {chain.selfNeedsAttention && (
        <span className="absolute -top-1 -right-1 text-[10px] font-bold text-amber-400">!</span>
      )}
    </button>
  );
}

/** The one derivation of a native chip's displayed numbers: GitHub's own
 *  position (parity with github.com) over the chain's unified total when the
 *  graft supplied one (parity with StackGlyph), else GitHub's size. Splicing
 *  the two sources is deliberate — every string on the chip must come through
 *  here so the numerator and denominator can't drift apart across call
 *  sites. */
function nativeChipNumbers(
  ns: NonNullable<PrStatus["nativeStack"]>,
  unified: { position: number; total: number } | null | undefined,
): { position: number; total: number } {
  return { position: ns.position, total: unified?.total ?? ns.size };
}

/** "N/M" label for the native-stack chip beside the PR number pill. Null when
 *  the PR isn't a native GitHub Stack member — the chip renders nothing. */
function nativeStackChipLabel(
  prStatus: PrStatus | null | undefined,
  unified?: { position: number; total: number } | null,
): string | null {
  const ns = prStatus?.nativeStack;
  if (!ns) return null;
  const { position, total } = nativeChipNumbers(ns, unified);
  return `${position}/${total}`;
}

interface NativeStackChipProps {
  prStatus: PrStatus | null | undefined;
  onOpenMap: () => void;
  /** Unified position/total from the local chain (`StackChain.unified`) —
   *  unifies the chip's denominator with StackGlyph's when local-only
   *  branches extend the native roster. Null falls back to GitHub's size. */
  unified?: { position: number; total: number } | null;
  /** Root id of the worktree's local Alfredo chain, when one still exists —
   *  converted stacks keep StackGlyph's hover-peek through this chip. */
  peekRootId?: string;
  /** THIS card's branch or restack machinery needs action — renders
   *  StackGlyph's amber "!" badge so the trouble is visible from the card,
   *  not only inside the popover. Healthy stack-mates stay unbadged. */
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
function NativeStackChip({ prStatus, onOpenMap, peekRootId, needsAttention = false, hue = null, unified = null }: NativeStackChipProps) {
  const setPeeked = useWorkspaceStore((s) => s.setPeekedStackRoot);
  const ns = prStatus?.nativeStack;
  if (!ns) return null;
  const { position, total } = nativeChipNumbers(ns, unified);
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
        `Stack position ${position} of ${total} in GitHub stack #${ns.number}`
        + (needsAttention ? ", this branch needs attention" : "")
        + " — open stack map"
      }
      title={
        `Stack #${ns.number} · ${position}/${total} — managed by GitHub`
        + (needsAttention ? " — this branch needs attention, click for details" : "")
      }
    >
      <Layers className="h-3 w-3" />
      {`${position}/${total}`}
      {needsAttention && (
        <span className="absolute -top-1 -right-1 text-[10px] font-bold text-amber-400">!</span>
      )}
    </button>
  );
}

export { StackGlyph, NativeStackChip, nativeStackChipLabel };
