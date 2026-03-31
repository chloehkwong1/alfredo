import type { Worktree } from "../../types";
import { AgentItemContent, useAgentItemState } from "./AgentItem";

interface AgentItemOverlayProps {
  worktree: Worktree;
  width?: number | null;
}

function AgentItemOverlay({ worktree, width }: AgentItemOverlayProps) {
  const { prSummary, isServerRunning, effectiveStatus, shouldPulse } = useAgentItemState(worktree);

  return (
    <div
      className="rounded-md bg-accent-muted border border-accent-primary/50 ring-1 ring-accent-primary/20 shadow-lg py-2 px-3.5 flex items-start gap-2 cursor-grabbing"
      style={width ? { width } : undefined}
    >
      <AgentItemContent
        worktree={worktree}
        isSelected={false}
        effectiveStatus={effectiveStatus}
        shouldPulse={shouldPulse}
        isServerRunning={isServerRunning}
        prSummary={prSummary}
      />
    </div>
  );
}

export { AgentItemOverlay };
