import { useDraggable } from "@dnd-kit/core";
import { useState, useEffect, useRef, memo } from "react";
import { Archive, Trash2, CircleCheck, CircleX, ExternalLink, Eye, GitBranch, MessageCircle, AlertTriangle, Clock, Loader, SquarePen, TerminalSquare, UserPlus, X } from "lucide-react";
import type { AgentState, Worktree } from "../../types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { openInEditor, openInTerminal, getAppConfig, rebaseWorktree } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePrStore } from "../../stores/prStore";
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

const THINKING_VERBS = [
  "Thinking…",
  "Reading files…",
  "Writing code…",
  "Searching…",
  "Analyzing…",
  "Running commands…",
  "Editing…",
  "Reasoning…",
];

function ThinkingText() {
  const [index, setIndex] = useState(0);
  const [fade, setFade] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIndex((i) => (i + 1) % THINKING_VERBS.length);
        setFade(true);
      }, 200);
    }, 3000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, []);

  return (
    <span
      className="transition-opacity duration-200"
      style={{ opacity: fade ? 1 : 0 }}
    >
      {THINKING_VERBS[index]}
    </span>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-[3px] ml-0.5">
      <span className="w-[3px] h-[3px] rounded-full bg-status-busy animate-thinking-dot-1" />
      <span className="w-[3px] h-[3px] rounded-full bg-status-busy animate-thinking-dot-2" />
      <span className="w-[3px] h-[3px] rounded-full bg-status-busy animate-thinking-dot-3" />
    </span>
  );
}

const NEEDS_YOU_STATES = new Set(["waitingForInput", "done", "error"]);

function needsAttention(status: string): boolean {
  return NEEDS_YOU_STATES.has(status);
}

function getBorderClass(status: string): string {
  switch (status) {
    case "waitingForInput":
    case "done":
      return "border-attn";
    case "error":
      return "border-error";
    default:
      return "border-l-[3px] border-l-transparent";
  }
}

function getDotGlowClass(status: string): string {
  switch (status) {
    case "waitingForInput":
    case "done":
      return "dot-glow-attn";
    case "error":
      return "dot-glow-error";
    default:
      return "";
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
  waitingForInput: "bg-accent-primary",
  busy: "bg-status-busy",
  idle: "bg-status-idle",
  done: "bg-accent-primary",
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

export function computeEffectiveStatus(
  agentStatus: AgentState,
  channelAlive: boolean | undefined,
  staleBusy: boolean | undefined,
  isSeen: boolean,
): string {
  const channelStatus = channelAlive === false && agentStatus !== "notRunning"
    ? "disconnected"
    : agentStatus;
  const baseStatus = channelStatus === "busy" && staleBusy ? "stale" : channelStatus;
  return baseStatus === "idle" && !isSeen ? "done" : baseStatus;
}

function useAgentItemState(worktree: Worktree) {
  const isSeen = useWorkspaceStore((s) => s.seenWorktrees.has(worktree.id));
  const prSummary = usePrStore((s) => s.prSummary[worktree.id]);
  const isServerRunning = useWorkspaceStore(
    (s) => s.runningServer?.worktreeId === worktree.id,
  );
  const effectiveStatus = computeEffectiveStatus(
    worktree.agentStatus, worktree.channelAlive, worktree.staleBusy, isSeen,
  );
  const shouldPulse = effectiveStatus === "waitingForInput";
  return { prSummary, isServerRunning, effectiveStatus, shouldPulse };
}

interface AgentItemContentProps {
  worktree: Worktree;
  effectiveStatus: string;
  shouldPulse: boolean;
  isServerRunning: boolean;
  prSummary: PrSummary | undefined;
  repoPath?: string;
  repoColors?: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  repoIndex?: number;
  showRepoTag?: boolean;
}

function AgentItemContent({
  worktree, effectiveStatus, shouldPulse, isServerRunning, prSummary,
  repoPath, repoColors, repoDisplayNames, repoIndex = 0, showRepoTag = false,
}: AgentItemContentProps) {
  return (
    <>
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
            "text-sm truncate text-text-primary",
            needsAttention(effectiveStatus)
              ? "font-semibold"
              : "font-normal",
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
        {/* Line 3: status text, diff stats, repo tag */}
        <div className="flex items-center gap-2 mt-1">
          <span className={[
            "text-xs truncate",
            (effectiveStatus as string) === "busy"
              ? "text-status-busy font-medium"
              : (effectiveStatus as string) === "waitingForInput"
                ? "text-accent-primary font-medium"
                : (effectiveStatus as string) === "done"
                  ? "text-accent-primary font-medium"
                  : (effectiveStatus as string) === "error"
                    ? "text-status-error font-medium"
                    : "text-text-tertiary",
          ].join(" ")}>
            {effectiveStatus === "busy" ? <><ThinkingText /><ThinkingDots /></> : getStatusText(effectiveStatus)}
          </span>

          <span className="flex items-center gap-1 text-xs ml-auto flex-shrink-0">
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
        {/* Line 4: PR stats row — separated by border */}
        {prSummary && hasPrStats(prSummary) && (
          <div className="pt-2 mt-2.5 border-t border-border-subtle">
            <PrStatsRow prSummary={prSummary} />
          </div>
        )}
      </div>
    </>
  );
}

function CreatingItem({ worktree }: { worktree: Worktree }) {
  return (
    <div className="w-full text-left py-2 px-3.5 flex items-start gap-2 opacity-55 pointer-events-none">
      <Loader className="mt-1 h-[8px] w-[8px] flex-shrink-0 animate-spin text-text-tertiary" size={8} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm truncate text-text-primary font-medium">
            {worktree.name}
          </span>
        </div>
        <div className="text-xs text-text-tertiary mt-1">Setting up…</div>
      </div>
    </div>
  );
}

function CreateErrorItem({ worktree }: { worktree: Worktree }) {
  const removeWorktree = useWorkspaceStore((s) => s.removeWorktree);

  return (
    <div className="w-full text-left py-2 px-3.5 flex items-start gap-2 border-l-[3px] border-l-status-error">
      <span className="mt-1 h-2 w-2 rounded-full flex-shrink-0 bg-status-error" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm truncate text-text-primary font-medium">
            {worktree.name}
          </span>
          <button
            type="button"
            onClick={() => removeWorktree(worktree.id)}
            className="ml-auto flex-shrink-0 text-text-tertiary hover:text-text-secondary cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
        <div className="text-xs text-status-error mt-1">Setup failed</div>
        {worktree.createError && (
          <div className="text-2xs text-text-tertiary mt-0.5 truncate">
            {worktree.createError}
          </div>
        )}
      </div>
    </div>
  );
}

const AgentItem = memo(function AgentItem({
  worktree, isSelected, onClick, onDelete, onArchive,
  repoPath, repoColors, repoDisplayNames, repoIndex = 0, showRepoTag = false,
}: AgentItemProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { prSummary, isServerRunning, effectiveStatus, shouldPulse } = useAgentItemState(worktree);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: worktree.id,
  });

  // Short-circuit for placeholder states (after hooks to satisfy Rules of Hooks)
  if (worktree.creating) {
    return <CreatingItem worktree={worktree} />;
  }
  if (worktree.createError) {
    return <CreateErrorItem worktree={worktree} />;
  }

  const handleOpenEditor = async () => {
    try {
      const appCfg = await getAppConfig();
      await openInEditor(worktree.path, appCfg.preferredEditor, appCfg.customEditorPath ?? undefined);
    } catch (e) {
      console.error("Failed to open editor:", e);
    }
  };

  const handleOpenTerminal = async () => {
    try {
      const appCfg = await getAppConfig();
      await openInTerminal(worktree.path, appCfg.preferredTerminal, appCfg.customTerminalPath ?? undefined);
    } catch (e) {
      console.error("Failed to open terminal:", e);
    }
  };

  const handleRebase = async () => {
    try {
      await rebaseWorktree(worktree.path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Rebase failed:", msg);
      // Surface the error since the user needs to know
      new Notification("Alfredo", { body: `Rebase failed for ${worktree.branch}: ${msg}` });
    }
  };

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
              isDragging ? "opacity-0 pointer-events-none" : "cursor-grab",
              getBorderClass(effectiveStatus),
              isSelected
                ? "bg-[rgba(255,255,255,0.07)]"
                : "hover:bg-[rgba(255,255,255,0.035)]",
            ].join(" ")}
          >
            <AgentItemContent
              worktree={worktree}
              effectiveStatus={effectiveStatus}
              shouldPulse={shouldPulse}
              isServerRunning={isServerRunning}
              prSummary={prSummary}
              repoPath={repoPath}
              repoColors={repoColors}
              repoDisplayNames={repoDisplayNames}
              repoIndex={repoIndex}
              showRepoTag={showRepoTag}
            />
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={handleOpenEditor}>
            <SquarePen className="h-4 w-4" />
            Open in Editor
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleOpenTerminal}>
            <TerminalSquare className="h-4 w-4" />
            Open in Terminal
          </ContextMenuItem>
          <ContextMenuSeparator />
          {worktree.linearTicketUrl && (
            <ContextMenuItem onSelect={() => openUrl(worktree.linearTicketUrl!)}>
              <ExternalLink className="h-4 w-4" />
              Open in Linear
            </ContextMenuItem>
          )}
          {worktree.prStatus && (
            <ContextMenuItem onSelect={() => openUrl(worktree.prStatus!.url)}>
              <ExternalLink className="h-4 w-4" />
              View PR on GitHub
            </ContextMenuItem>
          )}
          {(worktree.linearTicketUrl || worktree.prStatus) && <ContextMenuSeparator />}
          <ContextMenuItem onSelect={handleRebase}>
            <GitBranch className="h-4 w-4" />
            Rebase onto main
          </ContextMenuItem>
          <ContextMenuSeparator />
          {onArchive && (
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
});

type PrSummary = {
  failingCheckCount?: number;
  pendingCheckCount?: number;
  unresolvedCommentCount?: number;
  reviewDecision?: string | null;
  mergeable?: boolean | null;
};

function hasPrStats(s: PrSummary): boolean {
  const { failingCheckCount, unresolvedCommentCount, reviewDecision, mergeable } = s;
  if (failingCheckCount != null) return true;
  if (reviewDecision === "approved" || reviewDecision === "changes_requested" || reviewDecision === "review_required" || reviewDecision === "review_requested") return true;
  if (unresolvedCommentCount != null && unresolvedCommentCount > 0) return true;
  if (mergeable != null) return true;
  return false;
}

function PrStatsRow({ prSummary }: { prSummary: PrSummary }) {
  const {
    failingCheckCount,
    pendingCheckCount,
    unresolvedCommentCount,
    reviewDecision,
    mergeable,
  } = prSummary;

  const checksRunning = (pendingCheckCount ?? 0) > 0;
  const checksPass = !checksRunning && failingCheckCount != null && failingCheckCount === 0;
  const checksFail = failingCheckCount != null && failingCheckCount > 0;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Check status */}
      {checksRunning && !checksFail && (
        <span className="flex items-center gap-1 text-xs text-status-busy">
          <Loader size={12} className="animate-spin" />
          Checks running
        </span>
      )}
      {checksPass && (
        <span className="flex items-center gap-1 text-xs text-status-idle">
          <CircleCheck size={12} />
          Checks pass
        </span>
      )}
      {checksFail && (
        <span className="flex items-center gap-1 text-xs text-status-error">
          <CircleX size={12} />
          {failingCheckCount} failing
        </span>
      )}

      {/* Review decision */}
      {reviewDecision === "approved" && (
        <span className="flex items-center gap-1 text-xs text-status-idle">
          <Eye size={12} />
          Approved
        </span>
      )}
      {reviewDecision === "changes_requested" && (
        <span className="flex items-center gap-1 text-xs text-status-error">
          <Eye size={12} />
          Changes requested
        </span>
      )}
      {reviewDecision === "review_requested" && (
        <span className="flex items-center gap-1 text-xs text-status-busy">
          <UserPlus size={12} />
          Review requested
        </span>
      )}
      {reviewDecision === "review_required" && (
        <span className="flex items-center gap-1 text-xs text-text-tertiary">
          <Clock size={12} />
          Needs reviewer
        </span>
      )}

      {/* Comments */}
      {unresolvedCommentCount != null && unresolvedCommentCount > 0 && (
        <span className="flex items-center gap-1 text-xs text-text-tertiary">
          <MessageCircle size={12} />
          {unresolvedCommentCount}
        </span>
      )}

      {/* Mergeable */}
      {mergeable === false && (
        <span className="flex items-center gap-1 text-xs text-status-error">
          <AlertTriangle size={12} />
          Conflict
        </span>
      )}
      {mergeable === true && reviewDecision === "approved" && checksPass && (
        <span className="flex items-center gap-1 text-xs text-status-idle">
          <CircleCheck size={12} />
          Ready to merge
        </span>
      )}
    </div>
  );
}

export { AgentItem, AgentItemContent, useAgentItemState };
export type { AgentItemProps };
