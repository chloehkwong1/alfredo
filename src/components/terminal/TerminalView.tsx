import { useRef, useEffect } from "react";
import "@xterm/xterm/css/xterm.css";

import { TerminalHeader } from "./TerminalHeader";
import { usePty } from "../../hooks/usePty";
import { useWorkspaceStore } from "../../stores/workspaceStore";

function TerminalView() {
  const activeWorktreeId = useWorkspaceStore((s) => s.activeWorktreeId);
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === activeWorktreeId),
  );
  const setView = useWorkspaceStore((s) => s.setView);
  const setActiveWorktree = useWorkspaceStore((s) => s.setActiveWorktree);
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

  function handleBack() {
    setActiveWorktree(null);
    setView("board");
  }

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      {worktree && (
        <TerminalHeader
          branch={worktree.branch}
          agentState={agentState}
          isSeen={isSeen}
          onBack={handleBack}
        />
      )}
      <div ref={containerRef} className="flex-1 min-h-0 p-1" />
    </div>
  );
}

export { TerminalView };
