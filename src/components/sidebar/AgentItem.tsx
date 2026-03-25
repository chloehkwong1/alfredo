import { useDraggable } from "@dnd-kit/core";
import type { AgentState, Worktree } from "../../types";

interface AgentItemProps {
  worktree: Worktree;
  isSelected: boolean;
  onClick: () => void;
}

const statusDotColor: Record<string, string> = {
  waitingForInput: "bg-status-waiting",
  busy: "bg-status-busy",
  idle: "bg-status-idle",
  error: "bg-status-error",
  notRunning: "bg-text-tertiary",
};

const statusText: Record<string, string> = {
  waitingForInput: "Waiting for input",
  busy: "Thinking...",
  idle: "Idle",
  error: "Error",
  notRunning: "Not running",
};

function getDotColor(status: AgentState | string): string {
  return statusDotColor[status] ?? "bg-text-tertiary";
}

function getStatusText(status: AgentState | string): string {
  return statusText[status] ?? "Not running";
}

function AgentItem({ worktree, isSelected, onClick }: AgentItemProps) {
  const isWaiting = worktree.agentStatus === "waitingForInput";
  const shouldPulse = worktree.agentStatus === "busy" || worktree.agentStatus === "waitingForInput";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: worktree.id,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      {...attributes}
      {...listeners}
      className={[
        "w-full text-left px-3 py-3 flex items-start gap-2",
        "mx-2 rounded-lg mb-1",
        "transition-colors duration-[var(--transition-fast)]",
        isDragging ? "opacity-50 cursor-grabbing" : "cursor-grab",
        isSelected
          ? "border-l-2 border-l-accent-primary bg-[rgba(147,51,234,0.08)]"
          : "border-l-2 border-l-transparent bg-[rgba(255,255,255,0.02)] hover:bg-[rgba(255,255,255,0.06)]",
        isWaiting && !isSelected ? "bg-[color-mix(in_srgb,var(--status-waiting)_8%,transparent)]" : "",
      ].join(" ")}
    >
      {/* Status dot */}
      <span
        className={[
          "mt-1 h-[7px] w-[7px] rounded-full flex-shrink-0",
          getDotColor(worktree.agentStatus),
          shouldPulse ? "animate-pulse-dot" : "",
        ].join(" ")}
      />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-body font-medium text-text-primary truncate">
            {worktree.branch}
          </span>
          {worktree.prStatus && (
            <span className="text-micro text-text-tertiary flex-shrink-0">
              #{worktree.prStatus.number}
            </span>
          )}
        </div>
        {/* PR title */}
        {worktree.prStatus && (
          <div className="text-caption text-text-tertiary truncate mt-1">
            {worktree.prStatus.title}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-text-tertiary truncate">
            {getStatusText(worktree.agentStatus)}
          </span>
          {/* Diff stats */}
          {(worktree.additions != null || worktree.deletions != null) && (
            <span className="flex items-center gap-1 text-micro ml-auto flex-shrink-0">
              {worktree.additions != null && worktree.additions > 0 && (
                <span className="text-text-tertiary">+{worktree.additions}</span>
              )}
              {worktree.deletions != null && worktree.deletions > 0 && (
                <span className="text-text-tertiary">-{worktree.deletions}</span>
              )}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

export { AgentItem };
export type { AgentItemProps };
