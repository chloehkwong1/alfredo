import type { Worktree } from "../../types";
import { AgentItemContent, useAgentItemState, useStackHue, getBorderClass } from "./AgentItem";
import { worktreeDisplayLabel } from "../../lib/worktreeDisplayLabel";

interface AgentItemOverlayProps {
  worktree: Worktree;
  width?: number | null;
  label?: string;
}

function AgentItemOverlay({ worktree, width, label }: AgentItemOverlayProps) {
  const { prSummary, isServerRunning, serverPort, effectiveStatus, shouldPulse, isUnread } = useAgentItemState(worktree);
  // Keeps the native-stack chip's hue during drag — without it the dragged
  // card's chip falls back to the accent tint while its row is hue-coded.
  const stackHue = useStackHue(worktree.id);

  return (
    <div
      className={[
        "w-full text-left py-2 px-3 flex items-start gap-2 rounded-md",
        "bg-bg-elevated ring-1 ring-inset ring-card-ring shadow-xl cursor-grabbing",
        getBorderClass(effectiveStatus, isUnread),
      ].join(" ")}
      style={width ? { width } : undefined}
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
      />
    </div>
  );
}

export { AgentItemOverlay };
