import { Layers } from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { StackChain } from "../../lib/stackChain";
import type { Worktree } from "../../types";

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
      className="relative flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] text-accent-primary bg-accent-muted/40 hover:bg-accent-muted transition-colors cursor-pointer"
      aria-label={`Stack position ${chain.position} of ${chain.total} — open stack map`}
      title={`Stack ${chain.position}/${chain.total}`}
    >
      <Layers className={`h-3 w-3 ${rebasing ? "animate-spin" : ""}`} />
      {chain.position}/{chain.total}
      {chain.needsAttention && (
        <span className="absolute -top-1 -right-1 text-[10px] font-bold text-amber-400">!</span>
      )}
    </button>
  );
}

export { StackGlyph };
