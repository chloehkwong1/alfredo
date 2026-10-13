import type { Worktree } from "../../types";
import {
  AgentItemContent,
  useAgentItemState,
  useStackHue,
  getBorderClass,
  rowBoxClass,
} from "./AgentItem";
import { worktreeDisplayLabel } from "../../lib/worktreeDisplayLabel";

interface AgentItemOverlayProps {
  worktree: Worktree;
  width?: number | null;
  label?: string;
  /** Mirrors the grabbed row's checkbox gutter. Without it the lifted card's
   *  content sits a gutter-width left of the row it came from, so everything
   *  shifts sideways the moment the drag starts. */
  hasSelectionGutter?: boolean;
  /** Whether the grabbed row is itself part of the selection — ticks the box.
   *  Unselected rows keep the gutter with an invisible box, as they do at rest. */
  isRowSelected?: boolean;
  /** How many rows this drag will move. >1 draws the card as a deck. */
  batchCount?: number;
}

function AgentItemOverlay({
  worktree,
  width,
  label,
  hasSelectionGutter = false,
  isRowSelected = false,
  batchCount = 1,
}: AgentItemOverlayProps) {
  const { prSummary, isServerRunning, serverPort, effectiveStatus, shouldPulse, isUnread } = useAgentItemState(worktree);
  // Keeps the native-stack chip's hue during drag — without it the dragged
  // card's chip falls back to the accent tint while its row is hue-coded.
  const stackHue = useStackHue(worktree.id);

  // Peeking out below the card, so a batch reads as a deck rather than as one
  // card wearing a number. Two layers is enough — a third adds no information.
  const deckLayer = "absolute inset-0 rounded-md bg-bg-elevated ring-1 ring-inset ring-card-ring";

  return (
    <div className="relative" style={width ? { width } : undefined}>
      {batchCount > 2 && (
        <div aria-hidden className={`${deckLayer} origin-top translate-y-[11px] scale-x-[0.93]`} />
      )}
      {batchCount > 1 && (
        <div aria-hidden className={`${deckLayer} origin-top translate-y-[5px] scale-x-[0.965]`} />
      )}
      <div
        className={[
          rowBoxClass(hasSelectionGutter),
          "relative bg-bg-elevated ring-1 ring-inset ring-card-ring shadow-xl cursor-grabbing",
          getBorderClass(effectiveStatus, isUnread),
        ].join(" ")}
      >
        <AgentItemContent
          worktree={worktree}
          effectiveStatus={effectiveStatus}
          shouldPulse={shouldPulse}
          isServerRunning={isServerRunning}
          serverPort={serverPort}
          prSummary={prSummary}
          displayLabel={worktreeDisplayLabel(worktree, label)}
          stackHue={stackHue}
          isEditing={false}
          onStartEdit={() => {}}
          onCommitEdit={() => {}}
          onCancelEdit={() => {}}
          // Inert handler: it only exists to reserve the gutter, and the
          // overlay can't be clicked mid-drag.
          onToggleSelection={hasSelectionGutter ? () => {} : undefined}
          selectionActive={isRowSelected}
          isMultiSelected={isRowSelected}
        />
      </div>
      {batchCount > 1 && (
        <span
          className={[
            "absolute -top-1.5 -right-1.5 flex items-center justify-center",
            "min-w-5 h-5 px-1 rounded-full",
            "text-2xs tabular-nums font-semibold text-white bg-accent-primary",
            "ring-2 ring-bg-primary shadow-md",
          ].join(" ")}
        >
          {batchCount}
        </span>
      )}
    </div>
  );
}

export { AgentItemOverlay };
