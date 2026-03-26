import { useDraggable } from "@dnd-kit/core";
import { useState } from "react";
import { Archive, Trash2 } from "lucide-react";
import type { AgentState, Worktree } from "../../types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ui/ContextMenu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";
import { Button } from "../ui";

interface AgentItemProps {
  worktree: Worktree;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: (worktreeId: string) => void;
  onArchive?: (worktreeId: string) => void;
}

const statusDotColor: Record<string, string> = {
  waitingForInput: "bg-status-waiting",
  busy: "bg-status-busy",
  idle: "bg-status-idle",
  done: "bg-blue-400",
  error: "bg-status-error",
  notRunning: "bg-text-tertiary",
  disconnected: "bg-amber-400",
};

const statusText: Record<string, string> = {
  waitingForInput: "Waiting for input",
  busy: "Thinking...",
  idle: "Idle",
  done: "Done",
  error: "Error",
  notRunning: "Not running",
  disconnected: "Disconnected",
};

function getDotColor(status: AgentState | string): string {
  return statusDotColor[status] ?? "bg-text-tertiary";
}

function getStatusText(status: AgentState | string): string {
  return statusText[status] ?? "Not running";
}

function AgentItem({ worktree, isSelected, onClick, onDelete, onArchive }: AgentItemProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const isSeen = useWorkspaceStore((s) => s.seenWorktrees.has(worktree.id));
  const baseStatus = worktree.channelAlive === false ? "disconnected" : worktree.agentStatus;
  const effectiveStatus = baseStatus === "idle" && !isSeen ? "done" : baseStatus;
  const isWaiting = effectiveStatus === "waitingForInput";
  const shouldPulse = effectiveStatus === "busy" || effectiveStatus === "waitingForInput";
  const isDone = worktree.column === "done";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: worktree.id,
  });

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            ref={setNodeRef}
            type="button"
            onClick={onClick}
            {...attributes}
            {...listeners}
            className={[
              "w-full text-left px-4 py-2.5 flex items-start gap-2",
              "rounded-lg mb-0.5",
              "transition-colors duration-[var(--transition-fast)]",
              isDragging ? "opacity-50 cursor-grabbing" : "cursor-grab",
              isSelected
                ? "border-l-2 border-l-accent-primary bg-accent-muted"
                : "border-l-2 border-l-transparent hover:bg-bg-hover",
              isWaiting && !isSelected ? "bg-status-waiting/8" : "",
            ].join(" ")}
          >
            <span
              className={[
                "mt-1 h-[7px] w-[7px] rounded-full flex-shrink-0",
                getDotColor(effectiveStatus),
                shouldPulse ? "animate-pulse-dot" : "",
              ].join(" ")}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text-primary truncate">
                  {worktree.name}
                </span>
                {worktree.prStatus && (
                  <span className="text-2xs text-text-tertiary flex-shrink-0">
                    #{worktree.prStatus.number}
                  </span>
                )}
              </div>
              {worktree.prStatus && (
                <div className="text-xs text-text-tertiary truncate mt-1">
                  {worktree.prStatus.title}
                </div>
              )}
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs text-text-tertiary truncate">
                  {getStatusText(effectiveStatus)}
                </span>
                {worktree.column !== "done" && (worktree.additions != null || worktree.deletions != null) && (
                  <span className="flex items-center gap-1 text-2xs ml-auto flex-shrink-0">
                    {worktree.additions != null && worktree.additions > 0 && (
                      <span className="text-diff-added">+{worktree.additions}</span>
                    )}
                    {worktree.deletions != null && worktree.deletions > 0 && (
                      <span className="text-diff-removed">-{worktree.deletions}</span>
                    )}
                  </span>
                )}
              </div>
            </div>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {isDone && onArchive && (
            <>
              <ContextMenuItem onSelect={() => onArchive(worktree.id)}>
                <Archive className="h-4 w-4" />
                Archive
              </ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem
            className="text-red-400 data-[highlighted]:text-red-300"
            onSelect={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
            Delete worktree...
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="w-[420px]">
          <DialogHeader>
            <DialogTitle>Delete worktree</DialogTitle>
            <DialogDescription>
              Delete worktree and local branch <code className="text-text-secondary font-mono text-xs">{worktree.branch}</code>? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleteDialogOpen(false);
                onDelete?.(worktree.id);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export { AgentItem };
export type { AgentItemProps };
