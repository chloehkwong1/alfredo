import type { Worktree } from "../../types";
import { AgentItemContent, useAgentItemState, getBorderClass } from "./AgentItem";

interface AgentItemOverlayProps {
  worktree: Worktree;
  width?: number | null;
}

function AgentItemOverlay({ worktree, width }: AgentItemOverlayProps) {
  const { prSummary, isServerRunning, effectiveStatus, shouldPulse, isUnread } = useAgentItemState(worktree);

  return (
    <div
      className={[
        "w-full text-left py-2 px-3.5 flex items-start gap-2",
        "bg-bg-elevated shadow-xl cursor-grabbing",
        getBorderClass(effectiveStatus, isUnread),
      ].join(" ")}
      style={width ? { width } : undefined}
    >
      <AgentItemContent
        worktree={worktree}
        effectiveStatus={effectiveStatus}
        shouldPulse={shouldPulse}
        isServerRunning={isServerRunning}
        prSummary={prSummary}
      />
    </div>
  );
}

export { AgentItemOverlay };
