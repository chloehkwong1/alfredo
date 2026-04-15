import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, useEffect, useRef, memo } from "react";
import { Archive, Trash2, ExternalLink, Eye, GitBranch, Loader, X, Unlink, Copy, Pin, PinOff, Check, RefreshCw } from "lucide-react";
import type { AgentState, Worktree } from "../../types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { rebaseWorktree, setStackParent, getDefaultBranch, runSetupScripts } from "../../api";
import { useInstalledApps } from "../../hooks/useInstalledApps";
import { openInApp } from "../../api";
import { CATEGORY_ICON } from "../ui/OpenInDropdown";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePrStore } from "../../stores/prStore";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
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
import { PrSummary, hasPrStats, formatDiffStat, PrStatsRow } from "./PrStatsRow";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";

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

function InlineLabelInput({
  initialValue,
  onCommit,
  onCancel,
  className,
}: {
  initialValue: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  // Guard so Enter (which blurs the input) doesn't trigger both Enter-commit
  // and blur-commit back-to-back.
  const committedRef = useRef(false);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(value);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          committedRef.current = true;
          onCancel();
        }
      }}
      onBlur={commit}
      className={[
        "bg-bg-elevated border border-accent-primary/50 rounded px-1 py-0 outline-none",
        className ?? "",
      ].join(" ")}
    />
  );
}

const NEEDS_YOU_STATES = new Set(["waitingForInput", "done", "error", "ready"]);

function needsAttention(status: string): boolean {
  return NEEDS_YOU_STATES.has(status);
}

function getBorderClass(status: string, isUnread?: boolean): string {
  if (isUnread) {
    // Manually marked unread — dashed border to distinguish from organic state
    switch (status) {
      case "waitingForInput":
      case "done":
      case "ready":
        return "border-attn-dashed";
      case "error":
        return "border-error-dashed";
      default:
        return "border-attn-dashed";
    }
  }
  switch (status) {
    case "waitingForInput":
    case "done":
    case "ready":
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
    case "ready":
      return "dot-glow-attn";
    case "error":
      return "dot-glow-error";
    default:
      return "";
  }
}

interface AgentItemProps {
  worktree: Worktree;
  isSelected: boolean;
  isPinned?: boolean;
  isDimmed?: boolean;
  onClick: () => void;
  onDelete?: (worktreeId: string) => void;
  onArchive?: (worktreeId: string) => void;
  repoPath?: string;
  repoColors?: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  label?: string;
  onRename?: (worktreePath: string, label: string | null) => void;
  repoIndex?: number;
  showRepoTag?: boolean;
}

const statusDotColor: Record<string, string> = {
  waitingForInput: "bg-accent-primary",
  busy: "bg-status-busy",
  idle: "bg-status-idle",
  done: "bg-accent-primary",
  ready: "bg-accent-primary",
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
  ready: "Ready",
  error: "Error",
  notRunning: "Not running",
  disconnected: "Disconnected",
  stale: "Unresponsive",
};

function getStatusText(status: AgentState | string): string {
  return statusText[status] ?? "Not running";
}

export function computeEffectiveStatus(
  agentStatus: AgentState,
  channelAlive: boolean | undefined,
  staleBusy: boolean | undefined,
  isSeen: boolean,
  justCreated?: boolean,
): string {
  if (justCreated) return "ready";
  const channelStatus = channelAlive === false && agentStatus !== "notRunning"
    ? "disconnected"
    : agentStatus;
  const baseStatus = channelStatus === "busy" && staleBusy ? "stale" : channelStatus;
  if (baseStatus === "idle" && !isSeen) {
    return "done";
  }
  return baseStatus;
}

function useAgentItemState(worktree: Worktree) {
  const isSeen = useWorkspaceStore((s) => s.seenWorktrees.has(worktree.id));
  const isUnread = useWorkspaceStore((s) => s.unreadWorktrees.has(worktree.id));
  const prSummary = usePrStore((s) => s.prSummary[worktree.id]);
  const serverEntry = useWorkspaceStore(
    (s) => s.runningServers[worktree.id],
  );
  const isServerRunning = !!serverEntry;

  const effectiveSeen = isSeen && !isUnread;

  // When manually marked unread, treat as unseen so the attention state re-activates
  const effectiveStatus = computeEffectiveStatus(
    worktree.agentStatus, worktree.channelAlive, worktree.staleBusy, effectiveSeen, worktree.justCreated,
  );
  const shouldPulse = effectiveStatus === "waitingForInput";
  const serverPort = serverEntry?.port;
  return { prSummary, isServerRunning, serverPort, effectiveStatus, shouldPulse, isUnread };
}

interface AgentItemContentProps {
  worktree: Worktree;
  effectiveStatus: string;
  isSelected?: boolean;
  isPinned?: boolean;
  shouldPulse: boolean;
  isServerRunning: boolean;
  serverPort?: number;
  prSummary: PrSummary | undefined;
  repoPath?: string;
  repoColors?: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  displayLabel: string;
  isEditing: boolean;
  onStartEdit: () => void;
  onCommitEdit: (value: string) => void;
  onCancelEdit: () => void;
  repoIndex?: number;
  showRepoTag?: boolean;
}

function getDotColor(status: AgentState | string): string {
  return statusDotColor[status] ?? "bg-text-tertiary";
}

function AgentItemContent({
  worktree, effectiveStatus, isSelected, isPinned, shouldPulse, isServerRunning, serverPort, prSummary,
  repoPath, repoColors, repoDisplayNames, displayLabel, isEditing, onStartEdit, onCommitEdit, onCancelEdit,
  repoIndex = 0, showRepoTag = false,
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
        {/* Line 1: branch name, PR number, timestamp */}
        <div className="flex items-center gap-2">
          {isEditing ? (
            <InlineLabelInput
              initialValue={displayLabel}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
              className={[
                "text-sm min-w-0 flex-1",
                isSelected ? "text-text-primary" : "text-text-secondary",
                needsAttention(effectiveStatus) ? "font-semibold" : "font-normal",
              ].join(" ")}
            />
          ) : (
            <span
              onDoubleClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                onStartEdit();
              }}
              className={[
                "text-sm truncate",
                isSelected ? "text-text-primary" : "text-text-secondary",
                needsAttention(effectiveStatus)
                  ? "font-semibold"
                  : "font-normal",
              ].join(" ")}
            >
              {displayLabel}
            </span>
          )}
          {worktree.prStatus && (
            <span className="text-xs text-text-tertiary flex-shrink-0">#{worktree.prStatus.number}</span>
          )}
          <span className="flex items-center gap-1.5 ml-auto flex-shrink-0">
            <RelativeTime
              timestamp={worktree.lastActivityAt}
              className="text-2xs text-text-tertiary tabular-nums"
            />
            {isPinned && <Pin className="h-[11px] w-[11px] text-accent-primary opacity-45" />}
          </span>
        </div>
        {/* Line 2: PR title (only if PR exists) */}
        {worktree.prStatus && (
          <div className="text-xs text-text-tertiary truncate mt-0.5">
            {worktree.prStatus.title}
          </div>
        )}
        {/* Line 3: status text, diff stats, repo tag */}
        <div className="flex items-center gap-2 mt-1">
          <span className="flex items-center gap-1.5">
            <span className={[
              "text-xs truncate",
              (effectiveStatus as string) === "busy"
                ? "text-status-busy font-medium"
                : (effectiveStatus as string) === "waitingForInput"
                  ? "text-accent-primary font-medium"
                  : (effectiveStatus as string) === "done" || (effectiveStatus as string) === "ready"
                    ? "text-accent-primary font-medium"
                    : (effectiveStatus as string) === "error"
                      ? "text-status-error font-medium"
                      : "text-text-tertiary",
            ].join(" ")}>
              {effectiveStatus === "busy" ? <><ThinkingText /><ThinkingDots /></> : getStatusText(effectiveStatus)}
            </span>
            {isServerRunning && <ServerIndicator port={serverPort} />}
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
        {/* Stack indicator */}
        {worktree.stackParent && (
          <div className="flex items-center gap-1 mt-1 text-[10px] text-text-tertiary">
            <span>on</span>
            <button
              type="button"
              className="hover:text-text-secondary transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                const parent = useWorkspaceStore.getState().worktrees.find(
                  (wt) => wt.branch === worktree.stackParent
                );
                if (parent) {
                  useWorkspaceStore.getState().setActiveWorktree(parent.id);
                }
              }}
            >
              {worktree.stackParent}
            </button>
            {worktree.stackRebaseStatus?.kind === "behind" && (
              <span>· {worktree.stackRebaseStatus.count} behind</span>
            )}
            {worktree.stackRebaseStatus?.kind === "rebasing" && (
              <span className="animate-pulse">· rebasing...</span>
            )}
            {worktree.stackRebaseStatus?.kind === "conflict" && (
              <span className="text-status-error">· conflict</span>
            )}
          </div>
        )}
        {/* Stack children indicator */}
        {worktree.stackChildren && worktree.stackChildren.length > 0 && (
          <div className="flex items-center gap-1 mt-1 text-[10px] text-accent-primary">
            <span>↓ {worktree.stackChildren.length} stacked</span>
          </div>
        )}
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
            {worktree.branch || worktree.name}
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
            {worktree.branch || worktree.name}
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
          <div className="text-2xs text-text-tertiary mt-0.5 line-clamp-3 break-all" title={worktree.createError}>
            {worktree.createError}
          </div>
        )}
      </div>
    </div>
  );
}

function SetupScriptErrorItem({ worktree }: { worktree: Worktree }) {
  const updateWorktree = useWorkspaceStore((s) => s.updateWorktree);
  const [copied, setCopied] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  const error = worktree.setupScriptError ?? "";

  const dismiss = () => updateWorktree(worktree.id, { setupScriptError: null });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(error);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("Failed to copy setup script error:", e);
    }
  };

  const handleRerun = async () => {
    setRerunning(true);
    try {
      await runSetupScripts(worktree.repoPath, worktree.path);
      updateWorktree(worktree.id, { setupScriptError: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      updateWorktree(worktree.id, { setupScriptError: msg });
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="w-full text-left py-2 px-3.5 flex items-start gap-2 border-l-[3px] border-l-status-error">
      <span className="mt-1 h-2 w-2 rounded-full flex-shrink-0 bg-status-error" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm truncate text-text-primary font-medium">
            {worktree.branch || worktree.name}
          </span>
          <button
            type="button"
            onClick={dismiss}
            className="ml-auto flex-shrink-0 text-text-tertiary hover:text-text-secondary cursor-pointer"
            title="Dismiss error (worktree stays)"
          >
            <X size={12} />
          </button>
        </div>
        <div className="text-xs text-status-error mt-1 font-medium">Setup script failed</div>
        <div className="text-2xs text-text-tertiary mt-0.5 line-clamp-3 break-all font-mono" title={error}>
          {error}
        </div>
        <div className="flex gap-1.5 mt-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className={`text-2xs px-2 py-0.5 rounded border inline-flex items-center gap-1 cursor-pointer transition-colors ${
              copied
                ? "text-status-idle border-status-idle/30"
                : "text-text-secondary border-border-subtle hover:bg-white/5 hover:text-text-primary hover:border-border-hover"
            }`}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? "Copied" : "Copy full error"}
          </button>
          <button
            type="button"
            onClick={handleRerun}
            disabled={rerunning}
            className="text-2xs px-2 py-0.5 rounded border border-border-subtle text-text-secondary hover:bg-white/5 hover:text-text-primary hover:border-border-hover inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={10} className={rerunning ? "animate-spin" : ""} />
            {rerunning ? "Running…" : "Re-run setup"}
          </button>
        </div>
      </div>
    </div>
  );
}

const AgentItem = memo(function AgentItem({
  worktree, isSelected, isPinned, isDimmed, onClick, onDelete, onArchive,
  repoPath, repoColors, repoDisplayNames, label, onRename, repoIndex = 0, showRepoTag = false,
}: AgentItemProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [createFromOpen, setCreateFromOpen] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const displayLabel = label ?? worktree.branch ?? worktree.name;
  const handleStartEdit = () => setIsEditingLabel(true);
  const handleCancelEdit = () => setIsEditingLabel(false);
  const handleCommitEdit = (next: string) => {
    setIsEditingLabel(false);
    if (!onRename) return;
    const trimmed = next.trim();
    const branchName = worktree.branch ?? worktree.name;
    if (trimmed === "" || trimmed === branchName) {
      if (label != null) onRename(worktree.path, null);
      return;
    }
    if (trimmed === label) return;
    onRename(worktree.path, trimmed);
  };
  const deleteConfirmRef = useRef<HTMLButtonElement>(null);
  const { prSummary, isServerRunning, serverPort, effectiveStatus, shouldPulse, isUnread } = useAgentItemState(worktree);
  const markUnread = useWorkspaceStore((s) => s.markWorktreeUnread);
  const markRead = useWorkspaceStore((s) => s.markWorktreeRead);
  const togglePin = useWorkspaceStore((s) => s.togglePinWorktree);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: worktree.id,
  });
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);
  useEffect(() => {
    if (!worktree.stackParent && worktree.repoPath) {
      getDefaultBranch(worktree.repoPath)
        .then((b) => setDefaultBranch(b))
        .catch((e) => console.error("Failed to get default branch:", e));
    }
  }, [worktree.stackParent, worktree.repoPath]);

  const installedApps = useInstalledApps();

  // Short-circuit for placeholder states (after hooks to satisfy Rules of Hooks)
  if (worktree.creating) {
    return <CreatingItem worktree={worktree} />;
  }
  if (worktree.createError) {
    return <CreateErrorItem worktree={worktree} />;
  }
  if (worktree.setupScriptError) {
    return <SetupScriptErrorItem worktree={worktree} />;
  }

  const handleRebase = async () => {
    try {
      await rebaseWorktree(worktree.path, worktree.stackParent);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Rebase failed:", msg);
      // Surface the error since the user needs to know
      new Notification("Alfredo", { body: `Rebase failed for ${worktree.branch}: ${msg}` });
    }
  };

  const handleDetachFromStack = async () => {
    try {
      await setStackParent(worktree.repoPath, worktree.name, null);
      useWorkspaceStore.getState().updateWorktree(worktree.id, {
        stackParent: null,
        stackRebaseStatus: null,
      });
    } catch (e) {
      console.error("Failed to detach from stack:", e);
    }
  };

  const rowClassName = isDragging
    ? "w-full pointer-events-none mx-3.5 my-1 rounded-md border border-dashed border-accent-primary/30 bg-accent-muted/[0.04]"
    : [
        "w-full text-left py-2 px-3.5 flex items-start gap-2",
        "transition-all duration-[var(--transition-fast)]",
        isEditingLabel ? "cursor-default" : "cursor-grab",
        getBorderClass(effectiveStatus, isUnread),
        isSelected
          ? "bg-[rgba(255,255,255,0.07)]"
          : "hover:bg-[rgba(255,255,255,0.035)]",
        isDimmed && !isSelected
          ? "opacity-45 hover:opacity-70"
          : "",
      ].join(" ");
  const rowStyle = { transform: CSS.Transform.toString(transform), transition };
  const rowContent = isDragging ? (
    <div className="h-10" />
  ) : (
    <AgentItemContent
      worktree={worktree}
      effectiveStatus={effectiveStatus}
      isSelected={isSelected}
      isPinned={isPinned}
      shouldPulse={shouldPulse}
      isServerRunning={isServerRunning}
      serverPort={serverPort}
      prSummary={prSummary}
      repoPath={repoPath}
      repoColors={repoColors}
      repoDisplayNames={repoDisplayNames}
      displayLabel={displayLabel}
      isEditing={isEditingLabel}
      onStartEdit={handleStartEdit}
      onCommitEdit={handleCommitEdit}
      onCancelEdit={handleCancelEdit}
      repoIndex={repoIndex}
      showRepoTag={showRepoTag}
    />
  );

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {isEditingLabel ? (
            // While editing, render a div so the nested <input> is valid HTML
            // and dnd-kit listeners / row onClick are suspended.
            <div ref={setNodeRef} style={rowStyle} className={rowClassName}>
              {rowContent}
            </div>
          ) : (
          <button
            ref={setNodeRef}
            type="button"
            onClick={onClick}
            {...attributes}
            {...listeners}
            style={rowStyle}
            className={rowClassName}
          >
            {rowContent}
          </button>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ExternalLink className="h-4 w-4" />
              Open in
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {installedApps.map((app) => {
                const Icon = CATEGORY_ICON[app.category] ?? ExternalLink;
                return (
                  <ContextMenuItem
                    key={app.id}
                    onSelect={() =>
                      openInApp(app.id, worktree.path).catch((e) =>
                        console.error(`Failed to open in ${app.id}:`, e),
                      )
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {app.name}
                  </ContextMenuItem>
                );
              })}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onSelect={() => togglePin(worktree.id)}>
            {isPinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            {isPinned ? "Unpin" : "Pin"}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => isUnread ? markRead(worktree.id) : markUnread(worktree.id)}
          >
            <Eye className="h-4 w-4" />
            {isUnread ? "Mark as Read" : "Mark as Unread"}
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => navigator.clipboard.writeText(worktree.branch || worktree.name).catch(console.error)}
          >
            <Copy className="h-4 w-4" />
            Copy Branch Name
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
            {worktree.stackParent
              ? `Rebase onto ${worktree.stackParent}`
              : `Rebase onto ${defaultBranch ?? "base branch"}`}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setCreateFromOpen(true)}>
            <GitBranch className="h-4 w-4" />
            Create branch from this
          </ContextMenuItem>
          {worktree.stackParent && (
            <ContextMenuItem onSelect={handleDetachFromStack}>
              <Unlink className="h-4 w-4" />
              Detach from stack
            </ContextMenuItem>
          )}
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
        <DialogContent
          className="w-[420px]"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            deleteConfirmRef.current?.focus();
          }}
        >
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
              ref={deleteConfirmRef}
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

      <CreateWorktreeDialog
        open={createFromOpen}
        onOpenChange={setCreateFromOpen}
        repoPath={repoPath ?? worktree.repoPath}
        lockedBaseBranch={worktree.branch}
      />
    </>
  );
});

export { AgentItem, AgentItemContent, useAgentItemState, getBorderClass };
export type { AgentItemProps };
