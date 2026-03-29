import { useDraggable } from "@dnd-kit/core";
import { useState } from "react";
import { Archive, Trash2, CircleCheck, CircleX, Eye, MessageCircle, AlertTriangle, Clock } from "lucide-react";
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
import { ServerIndicator } from "./ServerIndicator";
import { RelativeTime } from "../ui/RelativeTime";
import { RepoTag } from "./RepoTag";

const ATTENTION_STATES = new Set(["waitingForInput", "done", "error"]);

function isAttentionState(status: string): boolean {
  return ATTENTION_STATES.has(status);
}

function getBleedClass(status: string): string {
  switch (status) {
    case "waitingForInput": return "bleed-waiting";
    case "done": return "bleed-done";
    case "error": return "bleed-error";
    default: return "border-l-[3px] border-l-transparent";
  }
}

function getDotGlowClass(status: string): string {
  switch (status) {
    case "waitingForInput": return "dot-glow-waiting";
    case "done": return "dot-glow-done";
    case "error": return "dot-glow-error";
    case "disconnected":
    case "stale": return "dot-glow-amber";
    default: return "";
  }
}

function formatDiffStat(n: number | null): string | null {
  if (n == null || n === 0) return null;
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

interface AgentItemProps {
  worktree: Worktree;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: (worktreeId: string) => void;
  onArchive?: (worktreeId: string) => void;
  repoPath?: string;
  repoColors?: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  repoIndex?: number;
  showRepoTag?: boolean;
}

const statusDotColor: Record<string, string> = {
  waitingForInput: "bg-status-waiting",
  busy: "bg-status-busy",
  idle: "bg-status-idle",
  done: "bg-blue-400",
  error: "bg-status-error",
  notRunning: "bg-text-tertiary",
  disconnected: "bg-amber-400",
  stale: "bg-amber-400",
};

const statusText: Record<string, string> = {
  waitingForInput: "Waiting for input",
  busy: "Thinking...",
  idle: "Idle",
  done: "Done",
  error: "Error",
  notRunning: "Not running",
  disconnected: "Disconnected",
  stale: "Unresponsive",
};

function getDotColor(status: AgentState | string): string {
  return statusDotColor[status] ?? "bg-text-tertiary";
}

function getStatusText(status: AgentState | string): string {
  return statusText[status] ?? "Not running";
}

function AgentItem({
  worktree, isSelected, onClick, onDelete, onArchive,
  repoPath, repoColors, repoDisplayNames, repoIndex = 0, showRepoTag = false,
}: AgentItemProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const isSeen = useWorkspaceStore((s) => s.seenWorktrees.has(worktree.id));
  const prSummary = useWorkspaceStore((s) => s.prSummary[worktree.id]);
  const isServerRunning = useWorkspaceStore(
    (s) => s.runningServer?.worktreeId === worktree.id,
  );
  const channelStatus = worktree.channelAlive === false ? "disconnected" : worktree.agentStatus;
  const baseStatus = channelStatus === "busy" && worktree.staleBusy ? "stale" : channelStatus;
  const effectiveStatus = baseStatus === "idle" && !isSeen ? "done" : baseStatus;
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
              "w-full text-left py-2 px-3.5 flex items-start gap-2",
              "transition-all duration-[var(--transition-fast)]",
              isDragging ? "opacity-50 cursor-grabbing" : "cursor-grab",
              getBleedClass(effectiveStatus),
              isSelected && !isAttentionState(effectiveStatus)
                ? "bg-[rgba(255,255,255,0.05)]"
                : "",
              isSelected && isAttentionState(effectiveStatus)
                ? "brightness-110"
                : "",
              !isSelected && !isAttentionState(effectiveStatus)
                ? "hover:bg-[rgba(255,255,255,0.035)]"
                : "",
            ].join(" ")}
          >
            <span
              className={[
                "mt-1 h-2 w-2 rounded-full flex-shrink-0",
                getDotColor(effectiveStatus),
                getDotGlowClass(effectiveStatus),
                shouldPulse ? "animate-pulse-dot" : "",
              ].join(" ")}
            />
            <div className="flex-1 min-w-0">
              {/* Line 1: branch name, PR number, server indicator, timestamp */}
              <div className="flex items-center gap-2">
                <span className={[
                  "text-sm truncate",
                  isAttentionState(effectiveStatus)
                    ? "font-semibold text-text-primary"
                    : "font-medium text-text-primary",
                ].join(" ")}>
                  {worktree.name}
                </span>
                {worktree.prStatus && (
                  <span className="text-xs text-text-tertiary flex-shrink-0">#{worktree.prStatus.number}</span>
                )}
                {isServerRunning && <ServerIndicator />}
                <RelativeTime
                  timestamp={worktree.lastActivityAt}
                  className="text-2xs text-text-tertiary ml-auto flex-shrink-0 tabular-nums"
                />
              </div>
              {/* Line 2: PR title (only if PR exists) */}
              {worktree.prStatus && (
                <div className="text-xs text-text-tertiary truncate mt-0.5">
                  {worktree.prStatus.title}
                </div>
              )}
              {/* Line 3: status text, diff stats, PR checks, repo tag */}
              <div className="flex items-center gap-2 mt-0.5">
                <span className={[
                  "text-xs truncate",
                  (effectiveStatus as string) === "waitingForInput"
                    ? "text-status-waiting font-medium"
                    : (effectiveStatus as string) === "done"
                      ? "text-accent-primary font-medium"
                      : (effectiveStatus as string) === "error"
                        ? "text-status-error font-medium"
                        : "text-text-tertiary",
                ].join(" ")}>
                  {getStatusText(effectiveStatus)}
                </span>

                <span className="flex items-center gap-1 text-2xs ml-auto flex-shrink-0">
                  {(() => {
                    const add = formatDiffStat(worktree.additions);
                    const del = formatDiffStat(worktree.deletions);
                    if (!add && !del) return null;
                    return (
                      <>
                        {add && <span className="text-diff-added">+{add}</span>}
                        {del && <span className="text-diff-removed">-{del}</span>}
                      </>
                    );
                  })()}
                  {showRepoTag && repoPath && repoColors && (
                    <RepoTag
                      repoPath={repoPath}
                      repoColors={repoColors}
                      repoDisplayNames={repoDisplayNames}
                      repoIndex={repoIndex}
                      visible={showRepoTag}
                    />
                  )}
                </span>
              </div>
              {/* Line 4: PR stats icon row */}
              {worktree.prStatus && prSummary && (
                <PrStatsRow prSummary={prSummary} />
              )}
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

function PrStatsRow({ prSummary }: {
  prSummary: {
    failingCheckCount?: number;
    unresolvedCommentCount?: number;
    reviewDecision?: string | null;
    mergeable?: boolean | null;
  };
}) {
  const {
    failingCheckCount,
    unresolvedCommentCount,
    reviewDecision,
    mergeable,
  } = prSummary;

  const checksPass = failingCheckCount != null && failingCheckCount === 0;
  const checksFail = failingCheckCount != null && failingCheckCount > 0;

  return (
    <div className="flex items-center gap-2.5 pt-[5px] mt-[5px] border-t border-border-subtle">
      {/* Check status */}
      {checksPass && (
        <span className="flex items-center gap-[3px] text-[10px] text-status-idle">
          <CircleCheck size={11} />
          pass
        </span>
      )}
      {checksFail && (
        <span className="flex items-center gap-[3px] text-[10px] text-status-error">
          <CircleX size={11} />
          {failingCheckCount}
        </span>
      )}

      {/* Review decision */}
      {reviewDecision === "APPROVED" && (
        <span className="flex items-center gap-[3px] text-[10px] text-status-idle">
          <Eye size={11} />
          Approved
        </span>
      )}
      {reviewDecision === "CHANGES_REQUESTED" && (
        <span className="flex items-center gap-[3px] text-[10px] text-status-error">
          <Eye size={11} />
          Changes
        </span>
      )}
      {reviewDecision === "REVIEW_REQUIRED" && (
        <span className="flex items-center gap-[3px] text-[10px] text-status-busy">
          <Clock size={11} />
          Pending
        </span>
      )}

      {/* Comments */}
      {unresolvedCommentCount != null && unresolvedCommentCount > 0 && (
        <span className="flex items-center gap-[3px] text-[10px] text-text-tertiary">
          <MessageCircle size={11} />
          {unresolvedCommentCount}
        </span>
      )}

      {/* Mergeable */}
      {mergeable === false && (
        <span className="flex items-center gap-[3px] text-[10px] text-status-error">
          <AlertTriangle size={11} />
          Conflict
        </span>
      )}
      {mergeable === true && reviewDecision === "APPROVED" && checksPass && (
        <span className="flex items-center gap-[3px] text-[10px] text-status-idle">
          <CircleCheck size={11} />
          Ready
        </span>
      )}
    </div>
  );
}

export { AgentItem };
export type { AgentItemProps };
