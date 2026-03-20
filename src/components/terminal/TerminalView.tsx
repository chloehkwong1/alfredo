import { useRef, useEffect } from "react";
import "@xterm/xterm/css/xterm.css";

import { usePty } from "../../hooks/usePty";
import { useWorkspaceStore } from "../../stores/workspaceStore";

function TerminalView() {
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === activeWorktreeId),
  );
  const markWorktreeSeen = useWorkspaceStore((s) => s.markWorktreeSeen);
  const isSeen = useWorkspaceStore((s) =>
    activeWorktreeId ? s.seenWorktrees.has(activeWorktreeId) : false,
  );

  const containerRef = useRef<HTMLDivElement>(null);

  const { agentState } = usePty({
    worktreeId: activeWorktreeId ?? "",
    worktreePath: worktree?.path ?? "",
    containerRef,
  });

  // Mark as seen when user is viewing a terminal that's idle or waiting
  useEffect(() => {
    if (
      activeWorktreeId &&
      !isSeen &&
      (agentState === "idle" || agentState === "waitingForInput")
    ) {
      markWorktreeSeen(activeWorktreeId);
    }
  }, [activeWorktreeId, agentState, isSeen, markWorktreeSeen]);

  if (!activeWorktreeId) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        Select a worktree to get started
      </div>
    );
  }

  if (!worktree) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        Starting session...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      <div ref={containerRef} className="flex-1 min-h-0 p-1" />
    </div>
  );
}

export { TerminalView };
