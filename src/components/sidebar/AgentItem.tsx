import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useState, useEffect, useLayoutEffect, useMemo, useRef, memo } from "react";
import { createPortal } from "react-dom";
import { Archive, Trash2, ExternalLink, Eye, GitBranch, Loader, X, Unlink, Copy, Pin, PinOff, Check, RefreshCw, ArrowRightLeft, ArrowUpRight, Settings, Pencil } from "lucide-react";
import { openWorkspaceSettings } from "../settings/openWorkspaceSettings";
import type { AgentState, Worktree } from "../../types";
import { openUrl } from "@tauri-apps/plugin-opener";
import { rebaseWorktree, setStackParent, runSetupScripts, setWorktreeColumn, getCommitsBehindMain, STACK_ADOPT_NOT_CLEAN } from "../../api";
import { stopServerAndReleasePort } from "../../services/portReclaim";
import { useDefaultBranch } from "../../hooks/useDefaultBranch";
import { useGithubUsername } from "../../hooks/useGithubUsername";
import { useInstalledApps } from "../../hooks/useInstalledApps";
import { openInApp } from "../../api";
import { CATEGORY_ICON } from "../ui/OpenInDropdown";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePrStore } from "../../stores/prStore";
import { worktreeDisplayLabel } from "../../lib/worktreeDisplayLabel";
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
import { DeleteWorktreeConfirm } from "./DeleteWorktreeConfirm";
import { ServerIndicator } from "./ServerIndicator";
import { RelativeTime } from "../ui/RelativeTime";
import { RepoTag } from "./RepoTag";
import { PrSummary, hasPrStats, formatDiffStat, PrStatsRow } from "./PrStatsRow";
import { CreateWorktreeDialog } from "../kanban/CreateWorktreeDialog";
import { ChangeBaseBranchDialog } from "./ChangeBaseBranchDialog";
import { columnIcon, columnLabel, COLUMN_ORDER } from "./StatusGroup";
import { copyText } from "../../lib/clipboard";
import { StackGlyph, NativeStackChip } from "./StackGlyph";
import { StackMapPopover, restackNowWithToast } from "./StackMapPopover";
import { useToastStore } from "../../stores/toastStore";
import { computeStackChain, stackHuesFor, detectAdoptableParent, type StackChain } from "../../lib/stackChain";
import { isTerminalPr, toTerminalFlags } from "../../lib/prStatus";
import { applyStackBaseChange } from "../../services/stackBase";
import { Button } from "../ui/Button";

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
  placeholder,
  onCommit,
  onCancel,
  className,
}: {
  placeholder: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Guard so Enter (which blurs the input) doesn't trigger both Enter-commit
  // and blur-commit back-to-back.
  const committedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
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
      placeholder={placeholder}
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
        "bg-bg-elevated border border-accent-primary/50 rounded px-1 py-0 outline-none placeholder:text-text-tertiary",
        className ?? "",
      ].join(" ")}
    />
  );
}

export const NEEDS_YOU_STATES = new Set(["waitingForInput", "done", "error", "ready"]);

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
  repoShortLabels?: Record<string, string>;
  label?: string;
  onRename?: (worktreePath: string, label: string | null) => void;
  repoIndex?: number;
  showRepoTag?: boolean;
}

export const statusDotColor: Record<string, string> = {
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

export const statusText: Record<string, string> = {
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
  setupInProgress?: boolean,
): string {
  // Background setup scripts run off the critical path, so an agent can be
  // spawned while they're still installing. Show "Setting up…" only while no
  // agent is live yet — once one is running, its real state (busy /
  // waitingForInput / done / error) must win, or the setup label swallows the
  // attention signal and no dock badge fires.
  if (setupInProgress && agentStatus === "notRunning") return "settingUp";
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
  const storeSummary = usePrStore((s) => s.prSummary[worktree.id]);
  // Restored cards have a hydrated prStatus but no live summary until the
  // first sync tick — derive the terminal chips (Merged/Cancelled) locally.
  const prSummary =
    storeSummary ??
    (worktree.prStatus && isTerminalPr(worktree.prStatus)
      ? toTerminalFlags(worktree.prStatus)
      : undefined);
  const serverEntry = useWorkspaceStore(
    (s) => s.runningServers[worktree.id],
  );
  const isServerRunning = !!serverEntry;

  const effectiveSeen = isSeen && !isUnread;

  // When manually marked unread, treat as unseen so the attention state re-activates
  const effectiveStatus = computeEffectiveStatus(
    worktree.agentStatus, worktree.channelAlive, worktree.staleBusy, effectiveSeen, worktree.justCreated, worktree.setupInProgress,
  );
  const shouldPulse = effectiveStatus === "waitingForInput";
  const serverPort = serverEntry?.port;
  const assignedPort = worktree.assignedPort;
  return { prSummary, isServerRunning, serverPort, assignedPort, effectiveStatus, shouldPulse, isUnread };
}

interface AgentItemContentProps {
  worktree: Worktree;
  effectiveStatus: string;
  isSelected?: boolean;
  isPinned?: boolean;
  shouldPulse: boolean;
  isServerRunning: boolean;
  serverPort?: number;
  assignedPort?: number | null;
  prSummary: PrSummary | undefined;
  repoPath?: string;
  repoColors?: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  repoShortLabels?: Record<string, string>;
  displayLabel: string;
  isEditing: boolean;
  onStartEdit: () => void;
  onCommitEdit: (value: string) => void;
  onCancelEdit: () => void;
  repoIndex?: number;
  showRepoTag?: boolean;
  stackChain?: StackChain | null;
  stackHue?: number | null;
  onOpenStackMap?: () => void;
  adoptableParent?: string | null;
  /** True while the popover is open (aria-expanded) and while set-up runs. */
  adoptOpen?: boolean;
  adoptWorking?: boolean;
  onToggleAdopt?: () => void;
  onDismissAdoptCue?: () => void;
}

function getDotColor(status: AgentState | string): string {
  return statusDotColor[status] ?? "bg-text-tertiary";
}

function AgentItemContent({
  worktree, effectiveStatus, isPinned, shouldPulse, isServerRunning, serverPort, assignedPort, prSummary,
  repoPath, repoColors, repoDisplayNames, repoShortLabels, displayLabel, isEditing, onStartEdit, onCommitEdit, onCancelEdit,
  repoIndex = 0, showRepoTag = false, stackChain = null, stackHue = null, onOpenStackMap = () => {},
  adoptableParent = null, adoptOpen = false, adoptWorking = false,
  onToggleAdopt = () => {}, onDismissAdoptCue = () => {},
}: AgentItemContentProps) {
  // Secondary, not tertiary: these lines (status, PR title, timestamp, stack
  // position) are the card's information payload, and tertiary only clears
  // WCAG AA by a hair. Tertiary is reserved for decorative/hover-revealed text.
  const mutedTextClass = "text-text-secondary";
  // Once GitHub owns the stack, the title-row native chip is the single stack
  // indicator — the Alfredo chain row below would duplicate it (and imply
  // Alfredo still restacks a stack it has stood down on).
  const isNativeStackMember = Boolean(worktree.prStatus?.nativeStack);
  // ...except when this card's own restack machinery needs eyes: conflict,
  // push-failed, behind, dirty-pause, queued restack. The popover names those
  // too, but the chain row is the card's only at-a-glance surface for them —
  // suppressing it for native members would hide e.g. a background-restack
  // conflict behind a click. (`nativeRestacked` and `foreignPrNotPushed` are
  // excluded — each has its own notice row below.)
  const ownStackKind = worktree.stackRebaseStatus?.kind;
  const stackTrouble =
    (ownStackKind != null && ownStackKind !== "upToDate") ||
    (worktree.stackPending != null &&
      worktree.stackPending.blockedBy !== "nativeRestacked" &&
      worktree.stackPending.blockedBy !== "foreignPrNotPushed");
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
              placeholder={displayLabel}
              onCommit={onCommitEdit}
              onCancel={onCancelEdit}
              className={[
                "text-sm min-w-0 flex-1",
                "text-text-primary",
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
                "text-text-primary",
                needsAttention(effectiveStatus)
                  ? "font-semibold"
                  : "font-normal",
              ].join(" ")}
            >
              {displayLabel}
            </span>
          )}
          {worktree.prStatus && (
            <span className={`text-xs ${mutedTextClass} flex-shrink-0`}>#{worktree.prStatus.number}</span>
          )}
          {/* GitHub-parity "N/M" stack-count chip for native GitHub Stack
              members — opens the same stack popover as the glyph. Renders
              nothing for non-members. */}
          <NativeStackChip
            prStatus={worktree.prStatus}
            onOpenMap={onOpenStackMap}
            peekRootId={stackChain?.rootId}
            needsAttention={Boolean(stackChain?.needsAttention) || stackTrouble}
            hue={stackHue}
          />
          <span className="flex items-center gap-1.5 ml-auto flex-shrink-0">
            <RelativeTime
              timestamp={worktree.lastActivityAt}
              className={`text-2xs ${mutedTextClass} tabular-nums`}
            />
            {isPinned && <Pin className="h-[11px] w-[11px] text-accent-primary opacity-45" />}
          </span>
        </div>
        {/* Line 2: PR title (only if PR exists) */}
        {worktree.prStatus && (
          <div className={`text-xs ${mutedTextClass} truncate mt-0.5`}>
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
                      : mutedTextClass,
            ].join(" ")}>
              {effectiveStatus === "settingUp"
                ? <>Setting up<ThinkingDots /></>
                : effectiveStatus === "busy"
                  ? (worktree.runningAgents && worktree.runningAgents > 0
                      ? <>Running {worktree.runningAgents} agent{worktree.runningAgents === 1 ? "" : "s"}<ThinkingDots /></>
                      : worktree.monitorPending
                        ? <>Monitoring<ThinkingDots /></>
                        : <><ThinkingText /><ThinkingDots /></>)
                  : getStatusText(effectiveStatus)}
            </span>
            {isServerRunning && <ServerIndicator port={serverPort} />}
            {!isServerRunning && assignedPort && (
              <span className="inline-flex items-center h-4 px-[5px] text-[11px] font-mono tabular-nums text-text-secondary border border-border-default rounded-sm">
                :{assignedPort}
              </span>
            )}
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
                repoShortLabels={repoShortLabels}
                repoIndex={repoIndex}
                visible={showRepoTag}
              />
            )}
          </span>
        </div>
        {/* Stack indicator: glyph + position + current status. Suppressed for
            native GitHub Stack members while healthy — the title-row chip
            covers position — but never while in trouble (see stackTrouble).
            When it does render for a native member, the glyph is omitted: the
            local chain's pos/total counts only live worktrees, so it disagrees
            with the native chip's roster count (which includes merged PRs) and
            a second chip reads as membership in a second stack. The native
            chip stays the card's one stack identity; this row is status only,
            like the nativeRestacked notice below. */}
        {stackChain && (!isNativeStackMember || stackTrouble) && (
          <div className={`flex items-center gap-1.5 mt-1 text-[10px] ${mutedTextClass} min-w-0`}>
            {!isNativeStackMember && (
              <StackGlyph worktree={worktree} chain={stackChain} onOpenMap={onOpenStackMap} hue={stackHue} />
            )}
            <span className="truncate" title={worktree.stackParent ?? undefined}>
              {worktree.stackParent
                ? `on ${worktree.stackParent}`
                : `${stackChain.total - 1} stacked on top`}
            </span>
            {worktree.stackRebaseStatus?.kind === "behind" && (
              <span className="flex-shrink-0">· {worktree.stackRebaseStatus.count} behind</span>
            )}
            {worktree.stackRebaseStatus?.kind === "rebasing" && (
              <span className="flex-shrink-0 animate-pulse">· rebasing...</span>
            )}
            {worktree.stackRebaseStatus?.kind === "conflict" && (
              <span className="flex-shrink-0 text-status-error">· conflict</span>
            )}
            {worktree.stackRebaseStatus?.kind === "skippedDirty" && (
              <span className="flex-shrink-0">· uncommitted changes — restack paused</span>
            )}
            {worktree.stackPending?.blockedBy === "agentBusy" &&
              worktree.stackRebaseStatus?.kind !== "skippedDirty" && (
              <span className="flex-shrink-0">· restack queued — agent busy</span>
            )}
            {worktree.stackRebaseStatus?.kind === "pushFailed" && (
              <span className="flex-shrink-0 text-status-error">· restacked, push failed</span>
            )}
            {worktree.stackRebaseStatus?.kind === "needsPush" && (
              <span className="flex-shrink-0 text-amber-400">· restacked — push to update PR</span>
            )}
            {worktree.stackRebaseStatus?.kind === "rewrittenExternally" && (
              <span className="flex-shrink-0 text-status-error">· rebased outside Alfredo</span>
            )}
          </div>
        )}
        {/* The chain row has no nativeRestacked span (and for native-stack
            members usually doesn't render at all, or the chain dissolved with
            a merged parent) — surface the nativeRestacked notice on its own
            row. */}
        {(!stackChain || isNativeStackMember) &&
          worktree.stackPending?.blockedBy === "nativeRestacked" && (
          <div className={`flex items-center gap-1.5 mt-1 text-[10px] ${mutedTextClass} min-w-0`}>
            <span className="truncate">restacked by GitHub — local branch may be behind</span>
          </div>
        )}
        {/* A dissolve always ends the chain, so this notice can never rely on
            the chain row — it gets its own, amber because the colleague's PR
            is stale until someone pushes deliberately. */}
        {worktree.stackPending?.blockedBy === "foreignPrNotPushed" && (
          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-amber-400 min-w-0">
            <span className="truncate">someone else's PR — restacked locally, not pushed</span>
          </div>
        )}
        {/* GitHub says this PR is stacked (base = a sibling worktree's branch)
            but no local stack is recorded — offer set-up through change_base.
            The cue itself never mutates: clicking it opens an explainer
            popover (AdoptStackPopover, rendered by the parent) and the action
            lives in there, labelled with its consequence. Neutral colour on
            purpose — this is an offer, not trouble, and amber is reserved for
            in-flux/attention states. Detection never auto-adopts; see
            detectAdoptableParent. */}
        {adoptableParent && (
          <div className="flex items-center gap-1 mt-1 text-[10px] min-w-0">
            {adoptWorking ? (
              <span className="flex items-center gap-1 min-w-0 text-text-tertiary animate-pulse">
                <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
                <span className="truncate">Setting up stack…</span>
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="flex items-center gap-1 min-w-0 -ml-1 px-1 py-0.5 rounded text-text-tertiary hover:text-text-secondary hover:bg-hover-wash cursor-pointer transition-colors"
                  title={`On GitHub, this PR's base is ${adoptableParent}`}
                  onClick={(e) => { e.stopPropagation(); onToggleAdopt(); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-haspopup="dialog"
                  aria-expanded={adoptOpen}
                  aria-label={`Stacked on ${adoptableParent} on GitHub — open stack set-up`}
                >
                  <GitBranch className="h-2.5 w-2.5 flex-shrink-0" />
                  <span className="truncate">Stacked on {adoptableParent} — set up?</span>
                  <span className="flex-shrink-0 opacity-70">›</span>
                </button>
                <button
                  type="button"
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-text-tertiary hover:text-text-secondary cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); onDismissAdoptCue(); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  aria-label="Dismiss for this session"
                  title="Dismiss for this session"
                >
                  ✕
                </button>
              </>
            )}
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

/** Fixed-position frame for the stack map popover, portaled to <body> so the
 *  status group's overflow-hidden collapse wrapper (StatusGroup) and the
 *  sidebar scroll container can't clip it. Opens below the anchor row,
 *  flipping above when the popover would spill past the viewport bottom.
 *  Hidden until the first measure so the flip never flashes. */
function StackMapFrame({ anchorRef, frameRef, remeasureKey, children }: {
  anchorRef: React.RefObject<HTMLDivElement | null>;
  frameRef: React.RefObject<HTMLDivElement | null>;
  /** Change this when the popover's content height changes after mount (e.g.
   *  an async probe resolving) so the below/above flip is re-decided. */
  remeasureKey?: unknown;
  children: React.ReactNode;
}) {
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", visibility: "hidden" });
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const frame = frameRef.current;
    if (!anchor || !frame) return;
    const rect = anchor.getBoundingClientRect();
    const height = frame.offsetHeight;
    const margin = 8;
    const fitsBelow = rect.bottom + 4 + height + margin <= window.innerHeight;
    const top = fitsBelow || rect.top - height - 4 < margin
      ? rect.bottom + 4
      : rect.top - height - 4;
    setStyle({ position: "fixed", top, left: rect.left + 14, zIndex: 50 });
  }, [anchorRef, frameRef, remeasureKey]);
  return createPortal(
    <div ref={frameRef} style={style}>{children}</div>,
    document.body,
  );
}

/** Close an anchored row popover on outside click or Escape. Interactions
 *  inside the anchor row or the popover frame don't count as outside — the
 *  popovers' own roots stop propagation, so a document-level listener only
 *  ever sees genuine outside clicks. Shared by the stack-map and adopt
 *  popovers; with the mutual-exclusion in their open handlers, at most one
 *  listener pair is ever armed, so Escape can't close two popovers at once. */
function usePopoverDismiss(
  active: boolean,
  anchorRef: React.RefObject<HTMLDivElement | null>,
  frameRef: React.RefObject<HTMLDivElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!active) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inRow = anchorRef.current?.contains(target) ?? false;
      const inPopover = frameRef.current?.contains(target) ?? false;
      if (!inRow && !inPopover) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}

/** Consequence line for the adopt popover: names exactly what clicking the
 *  primary will (and won't) do. A failed probe (behind == null) hedges but
 *  still warns — fail closed, never fail reassuring. Exported for tests. */
export function adoptConsequence(
  parent: string,
  probed: boolean,
  behind: number | null,
): { tone: "checking" | "safe" | "warn"; text: string } {
  if (!probed) return { tone: "checking", text: "Checking whether a rebase is needed…" };
  if (behind === 0) return { tone: "safe", text: "Nothing changes now — no rebase, no push." };
  if (behind == null) {
    return {
      tone: "warn",
      text: `Couldn't compare against ${parent} — setting up may rebase this branch onto it and push the update to the PR.`,
    };
  }
  return {
    tone: "warn",
    text: `${parent} has moved (${behind} commit${behind === 1 ? "" : "s"}) — setting up will rebase this branch onto it and push the update to the PR.`,
  };
}

/** Primary-button label carries the consequence. Exported for tests. */
export function adoptActionLabel(probed: boolean, behind: number | null): string {
  return probed && behind !== 0 ? "Rebase & set up" : "Set up stack";
}

/** Explainer popover behind the "Stacked on <parent> — set up?" cue. The cue
 *  never mutates; this popover is where the (labelled) action lives. */
function AdoptStackPopover({ parent, branch, prNumber, defaultBranch, probed, behind, onConfirm, onNotNow }: {
  parent: string;
  branch: string;
  prNumber: number | null;
  defaultBranch: string | null;
  probed: boolean;
  behind: number | null;
  onConfirm: () => void;
  onNotNow: () => void;
}) {
  const consequence = adoptConsequence(parent, probed, behind);
  const containerRef = useRef<HTMLDivElement>(null);
  // Focus stays on the container; the primary is deliberately NEVER
  // auto-focused. Moving focus to it when the probe resolves (or on the
  // not-clean reopen, where it would mount enabled) lets a held or repeated
  // Enter fire "Rebase & set up" before the warning is read — the exact
  // acts-without-a-deliberate-read failure this popover exists to prevent.
  // Reaching the buttons costs one Tab.
  useEffect(() => { containerRef.current?.focus(); }, []);
  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Set up stack"
      className="w-[264px] rounded-lg border border-border-default bg-bg-elevated p-3 shadow-lg outline-none"
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
        <GitBranch className="h-3 w-3 text-text-secondary" />
        Stacked pull request
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-text-secondary">
        On GitHub, {prNumber != null ? `PR #${prNumber}` : "this PR"}&apos;s base is{" "}
        <code className="text-text-primary">{parent}</code> — it builds on that branch, not{" "}
        <code className="text-text-primary">{defaultBranch ?? "main"}</code>. Alfredo isn&apos;t
        tracking this stack yet. Set it up to see both branches in the stack map and have{" "}
        <code className="text-text-primary">{branch}</code> rebased automatically when{" "}
        <code className="text-text-primary">{parent}</code> moves.
      </p>
      <div className={`mt-2 flex items-start gap-1.5 text-[11px] leading-snug ${consequence.tone === "warn" ? "text-amber-400" : "text-text-tertiary"}`}>
        {consequence.tone !== "checking" && (
          <span className="flex-shrink-0">{consequence.tone === "warn" ? "⚠" : "✓"}</span>
        )}
        <span>{consequence.text}</span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" disabled={!probed} onClick={onConfirm}>
          {adoptActionLabel(probed, behind)}
        </Button>
        <Button size="sm" variant="ghost" onClick={onNotNow}>
          Not now
        </Button>
      </div>
      <div className="mt-2.5 border-t border-border-subtle pt-2 text-[10px] text-text-tertiary">
        Undo any time: right-click the worktree → Detach from stack.
      </div>
    </div>
  );
}

function CreatingItem({ worktree }: { worktree: Worktree }) {
  return (
    <div className="w-full text-left py-2 px-3 flex items-start gap-2 rounded-md bg-card ring-1 ring-inset ring-card-ring opacity-55 pointer-events-none">
      <Loader className="mt-1 h-[8px] w-[8px] flex-shrink-0 animate-spin text-text-tertiary" size={8} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm truncate text-text-primary font-medium">
            {worktree.branch || worktree.name}
          </span>
        </div>
        <div className="text-xs text-text-secondary mt-1">Setting up…</div>
      </div>
    </div>
  );
}

function CreateErrorItem({ worktree }: { worktree: Worktree }) {
  const removeWorktree = useWorkspaceStore((s) => s.removeWorktree);
  const [copied, setCopied] = useState(false);

  const error = worktree.createError ?? "";

  const handleCopy = async () => {
    try {
      await copyText(error);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("Failed to copy create error:", e);
    }
  };

  return (
    <div className="w-full text-left py-2 px-3 flex items-start gap-2 rounded-md bg-card ring-1 ring-inset ring-card-ring border-l-[3px] border-l-status-error">
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
        <div className="text-xs text-status-error mt-1 font-medium">Setup failed</div>
        {error && (
          <>
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
                    : "text-text-secondary border-border-subtle hover:bg-hover-wash hover:text-text-primary hover:border-border-hover"
                }`}
              >
                {copied ? <Check size={10} /> : <Copy size={10} />}
                {copied ? "Copied" : "Copy full error"}
              </button>
            </div>
          </>
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
      await copyText(error);
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
    <div className="w-full text-left py-2 px-3 flex items-start gap-2 rounded-md bg-card ring-1 ring-inset ring-card-ring border-l-[3px] border-l-status-error">
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
                : "text-text-secondary border-border-subtle hover:bg-hover-wash hover:text-text-primary hover:border-border-hover"
            }`}
          >
            {copied ? <Check size={10} /> : <Copy size={10} />}
            {copied ? "Copied" : "Copy full error"}
          </button>
          <button
            type="button"
            onClick={handleRerun}
            disabled={rerunning}
            className="text-2xs px-2 py-0.5 rounded border border-border-subtle text-text-secondary hover:bg-hover-wash hover:text-text-primary hover:border-border-hover inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={10} className={rerunning ? "animate-spin" : ""} />
            {rerunning ? "Running…" : "Re-run setup"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Palette slot for this worktree's stack chips, or null for the accent tint.
 *  Hue-codes only when ≥2 stacks have at least one non-archived, non-branch-
 *  mode member (the gate deliberately counts rows hidden by collapse or the
 *  pin filter — they're one toggle from view, and excluding them would make
 *  hues flicker on collapse). Shared with AgentItemOverlay so the dragged
 *  card matches its row; stackHuesFor memoizes per store update. */
function useStackHue(worktreeId: string): number | null {
  const allWorktrees = useWorkspaceStore((s) => s.worktrees);
  return stackHuesFor(allWorktrees).get(worktreeId) ?? null;
}

const AgentItem = memo(function AgentItem({
  worktree, isSelected, isPinned, isDimmed, onClick, onDelete, onArchive,
  repoPath, repoColors, repoDisplayNames, repoShortLabels, label, onRename, repoIndex = 0, showRepoTag = false,
}: AgentItemProps) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [createFromOpen, setCreateFromOpen] = useState(false);
  const [changeBaseOpen, setChangeBaseOpen] = useState(false);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [stackMapOpen, setStackMapOpen] = useState(false);
  const rowContainerRef = useRef<HTMLDivElement>(null);
  // The stack map lives in a portal (see StackMapFrame), so outside-click
  // detection must check it separately from the row.
  const stackMapFrameRef = useRef<HTMLDivElement>(null);
  // When Rename is picked from the context menu, Radix restores focus to the
  // trigger row on close, stealing it from the freshly mounted label input.
  const renameViaMenuRef = useRef(false);
  const displayLabel = worktreeDisplayLabel(worktree, label);
  const handleStartEdit = () => setIsEditingLabel(true);
  const handleCancelEdit = () => setIsEditingLabel(false);
  const handleCommitEdit = (next: string) => {
    setIsEditingLabel(false);
    if (!onRename) return;
    const trimmed = next.trim();
    // The input starts empty, so an empty commit means "left untouched" — keep
    // the current label. Typing the branch name resets a custom label instead.
    if (trimmed === "") return;
    if (trimmed === worktreeDisplayLabel(worktree, null)) {
      if (label != null) onRename(worktree.path, null);
      return;
    }
    if (trimmed === label) return;
    onRename(worktree.path, trimmed);
  };
  const { prSummary, isServerRunning, serverPort, assignedPort, effectiveStatus, shouldPulse, isUnread } = useAgentItemState(worktree);
  const markUnread = useWorkspaceStore((s) => s.markWorktreeUnread);
  const markRead = useWorkspaceStore((s) => s.markWorktreeRead);
  const togglePin = useWorkspaceStore((s) => s.togglePinWorktree);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: worktree.id,
  });
  const defaultBranch = useDefaultBranch(worktree.repoPath, worktree.stackParent);
  const parentWorktreeId = useWorkspaceStore((s) =>
    worktree.stackParent
      ? s.worktrees.find((wt) => wt.branch === worktree.stackParent)?.id
      : undefined,
  );
  const hasParentWorktree = !!parentWorktreeId;
  const goToParent = () => {
    if (parentWorktreeId) {
      useWorkspaceStore.getState().setActiveWorktree(parentWorktreeId);
    }
  };
  const allWorktrees = useWorkspaceStore((s) => s.worktrees);
  const peekedStackRootId = useWorkspaceStore((s) => s.peekedStackRootId);
  const stackChain = useMemo(
    () => computeStackChain(allWorktrees, worktree.id),
    [allWorktrees, worktree.id],
  );
  const githubUsername = useGithubUsername();
  const adoptableParent = useMemo(
    () => detectAdoptableParent(allWorktrees, worktree.id, defaultBranch, githubUsername),
    [allWorktrees, worktree.id, defaultBranch, githubUsername],
  );
  const showAdoptCue = useWorkspaceStore(
    (s) => adoptableParent != null && !s.isStackAdoptionDismissed(worktree.id, adoptableParent),
  );
  // Every non-idle stage carries the parent it was armed against, so a
  // detection flip (PR sync retargeting baseBranch) can't leave a stale
  // confirm armed for a parent that was never probed — the effect below
  // resets the flow whenever the armed parent no longer matches detection.
  const [adoptState, setAdoptState] = useState<
    | { stage: "idle" }
    | { stage: "open"; parent: string; probed: boolean; behind: number | null }
    | { stage: "adopting"; parent: string }
  >({ stage: "idle" });
  const adoptFrameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setAdoptState((s) =>
      s.stage !== "idle" && s.stage !== "adopting" && s.parent !== adoptableParent
        ? { stage: "idle" }
        : s,
    );
  }, [adoptableParent]);
  const stackHue = useStackHue(worktree.id);
  const isPeeked = stackChain != null && peekedStackRootId === stackChain.rootId;

  usePopoverDismiss(stackMapOpen, rowContainerRef, stackMapFrameRef, () => setStackMapOpen(false));

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
    if (worktree.stackParent) {
      // Shared restack path — outcome + errors toast like every other
      // "Restack now" surface, so the choreography can't drift.
      await restackNowWithToast(worktree.repoPath, worktree.name, worktree.branch);
      return;
    }
    try {
      const outcome = await rebaseWorktree(worktree.path, null);
      useToastStore.getState().show({
        message: outcome === "alreadyUpToDate"
          ? `${worktree.branch} is already up to date`
          : `Rebased ${worktree.branch} ✓`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("Rebase failed:", msg);
      // Surface the error since the user needs to know
      new Notification("Alfredo", { body: `Rebase failed for ${worktree.branch}: ${msg}` });
    }
  };

  const runAdopt = async (parent: string, expectNoRebase: boolean) => {
    setAdoptState({ stage: "adopting", parent });
    try {
      await applyStackBaseChange(worktree, parent, { expectNoRebase });
      // Success: the optimistic stackParent update makes detection return null,
      // so the cue disappears and the normal stack row takes over. The toast
      // names what happened — the 1/N chip appearing is too subtle on its own.
      setAdoptState({ stage: "idle" });
      useToastStore.getState().show({
        message: `${worktree.branch} added to the stack — it now follows ${parent}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // The backend re-checks the "no rebase will happen" claim against the
      // tips it resolves at set-up time and refuses when the parent moved
      // since our probe (or the probe was wrong). Not a failure — reopen the
      // popover in its hedged-warn variant, exactly as an inconclusive probe
      // would have shown.
      if (expectNoRebase && msg.includes(STACK_ADOPT_NOT_CLEAN)) {
        setAdoptState({ stage: "open", parent, probed: true, behind: null });
        return;
      }
      console.error("Adopt stack failed:", msg);
      // In-app toast, matching every other stack surface — a raw Notification
      // is gated by macOS permission/DND and dead in dev builds. A rebase
      // conflict additionally gets the sticky stack:rebase-conflict toast, and
      // its status write suppresses the cue (see detectAdoptableParent).
      useToastStore.getState().show({ message: `Stack set-up failed for ${worktree.branch}: ${msg}` });
      setAdoptState({ stage: "idle" });
    }
  };
  // First click never mutates: it opens the explainer popover and starts the
  // behind-count probe so the consequence line can resolve from "Checking…"
  // to safe/warn while the user reads. The action itself is inside the
  // popover, labelled with its consequence (Set up stack / Rebase & set up).
  // A second click on the trigger closes it again (standard disclosure
  // toggle — the cue advertises aria-expanded, so activation must not be
  // inert while open).
  const handleToggleAdopt = async () => {
    if (adoptState.stage === "open") {
      setAdoptState({ stage: "idle" });
      return;
    }
    if (adoptState.stage !== "idle" || !adoptableParent) return;
    const parent = adoptableParent;
    // The two anchored popovers share the row anchor and coordinates — never
    // let both be open at once (mirrored in the stack-map open handler).
    setStackMapOpen(false);
    setAdoptState({ stage: "open", parent, probed: false, behind: null });
    const behind = await getCommitsBehindMain(worktree.path, parent).catch((e) => {
      console.warn("[adopt-stack] behind-count probe failed:", e);
      return null;
    });
    // Fold the result in only if the popover is still open on the same parent
    // (it may have been closed, or detection flipped mid-await).
    setAdoptState((s) =>
      s.stage === "open" && s.parent === parent ? { ...s, probed: true, behind } : s,
    );
  };
  const handleAdoptConfirm = async () => {
    if (adoptState.stage !== "open" || !adoptState.probed) return;
    // Set up the ARMED parent (the one the popover described), not whatever
    // detection currently returns. expectNoRebase only on a provably-clean
    // probe — the backend re-checks and refuses (→ hedged reopen) if the
    // parent moved between probe and set-up.
    await runAdopt(adoptState.parent, adoptState.behind === 0);
  };
  // Esc / click-outside close WITHOUT burning the session dismiss — only ✕
  // and "Not now" are deliberate "stop offering" signals.
  const handleCloseAdopt = () => {
    setAdoptState((s) => (s.stage === "open" ? { stage: "idle" } : s));
    rowContainerRef.current?.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')?.focus();
  };
  const handleDismissAdoptCue = () => {
    if (adoptableParent) {
      useWorkspaceStore.getState().dismissStackAdoption(worktree.id, adoptableParent);
    }
    // Dismissing unmounts the cue row, but the popover renders off
    // adoptState alone — close it too or it survives its own trigger.
    setAdoptState((s) => (s.stage === "open" ? { stage: "idle" } : s));
  };
  usePopoverDismiss(adoptState.stage === "open", rowContainerRef, adoptFrameRef, handleCloseAdopt);

  const handleMoveToColumn = async (target: typeof worktree.column) => {
    if (target === worktree.column) return;
    const origin = worktree.column;
    useWorkspaceStore.getState().setManualColumn(worktree.id, target);
    usePrStore.getState().setManualColumn(worktree.id, target, origin);
    try {
      await setWorktreeColumn(worktree.repoPath, worktree.name, target);
    } catch (e) {
      console.error("Failed to persist column change:", e);
    }
    if (target === "done") {
      await stopServerAndReleasePort(worktree, "move-to-done");
    }
  };

  const handleDetachFromStack = async () => {
    try {
      await setStackParent(worktree.repoPath, worktree.name, null);
      useWorkspaceStore.getState().updateWorktree(worktree.id, {
        stackParent: null,
        stackRebaseStatus: null,
      });
      // Detach never retargets the PR base on GitHub, so the adopt cue would
      // immediately re-offer the stack the user just left — pre-dismiss it for
      // this session. (After a restart the cue returns: local and GitHub
      // genuinely disagree until the PR base is retargeted, so re-offering
      // then is honest.)
      const prBase = worktree.prStatus?.baseBranch;
      if (prBase) {
        useWorkspaceStore.getState().dismissStackAdoption(worktree.id, prBase);
      }
    } catch (e) {
      console.error("Failed to detach from stack:", e);
    }
  };

  const rowClassName = isDragging
    ? "w-full pointer-events-none rounded-md border border-dashed border-accent-primary/30 bg-accent-muted/[0.04]"
    : [
        "w-full text-left py-2 px-3 flex items-start gap-2 rounded-md",
        "transition-all duration-[var(--transition-fast)]",
        "group",
        isEditingLabel ? "cursor-default" : "cursor-grab",
        getBorderClass(effectiveStatus, isUnread),
        isSelected
          ? "bg-card-selected ring-1 ring-inset ring-card-ring-selected"
          : "bg-card ring-1 ring-inset ring-card-ring hover:bg-card-hover",
        isDimmed && !isSelected
          ? "opacity-45 hover:opacity-70"
          : "",
        isPeeked ? "shadow-[inset_3px_0_0] shadow-accent-primary/70 bg-card" : "",
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
      assignedPort={assignedPort}
      prSummary={prSummary}
      repoPath={repoPath}
      repoColors={repoColors}
      repoDisplayNames={repoDisplayNames}
      repoShortLabels={repoShortLabels}
      displayLabel={displayLabel}
      isEditing={isEditingLabel}
      onStartEdit={handleStartEdit}
      onCommitEdit={handleCommitEdit}
      onCancelEdit={handleCancelEdit}
      repoIndex={repoIndex}
      showRepoTag={showRepoTag}
      stackChain={stackChain}
      stackHue={stackHue}
      onOpenStackMap={() => {
        // Mutually exclusive with the adopt popover — both anchor to the same
        // row coordinates (see handleToggleAdopt's mirror of this).
        setAdoptState((s) => (s.stage === "open" ? { stage: "idle" } : s));
        setStackMapOpen(true);
      }}
      adoptableParent={showAdoptCue ? adoptableParent : null}
      adoptOpen={adoptState.stage === "open"}
      adoptWorking={adoptState.stage === "adopting"}
      onToggleAdopt={() => { void handleToggleAdopt(); }}
      onDismissAdoptCue={handleDismissAdoptCue}
    />
  );

  return (
    <div ref={rowContainerRef} className="relative">
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
            {worktree.column === "done" && !worktree.archived && onArchive && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onArchive(worktree.id);
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-hover-wash text-text-tertiary hover:text-text-primary cursor-pointer flex-shrink-0"
                aria-label="Archive worktree"
                title="Archive"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            )}
          </button>
          )}
        </ContextMenuTrigger>
        <ContextMenuContent
          onCloseAutoFocus={(e) => {
            if (renameViaMenuRef.current) {
              renameViaMenuRef.current = false;
              e.preventDefault();
            }
          }}
        >
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
            onSelect={() => copyText(worktree.branch || worktree.name).catch(console.error)}
          >
            <Copy className="h-4 w-4" />
            Copy Branch Name
          </ContextMenuItem>
          <ContextMenuItem
            onSelect={() => {
              renameViaMenuRef.current = true;
              handleStartEdit();
            }}
          >
            <Pencil className="h-4 w-4" />
            Rename
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ArrowRightLeft className="h-4 w-4" />
              Move to
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {COLUMN_ORDER.filter((col) => col !== worktree.column).map((col) => {
                const Icon = columnIcon[col];
                return (
                  <ContextMenuItem key={col} onSelect={() => handleMoveToColumn(col)}>
                    <Icon className="h-4 w-4" />
                    {columnLabel[col]}
                  </ContextMenuItem>
                );
              })}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSeparator />
          {hasParentWorktree && (
            <ContextMenuItem onSelect={goToParent}>
              <ArrowUpRight className="h-4 w-4" />
              Go to parent branch
            </ContextMenuItem>
          )}
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
          {(hasParentWorktree || worktree.linearTicketUrl || worktree.prStatus) && <ContextMenuSeparator />}
          <ContextMenuItem onSelect={handleRebase}>
            <GitBranch className="h-4 w-4" />
            {worktree.stackParent
              ? "Restack now"
              : `Rebase onto ${defaultBranch ?? "base branch"}`}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setCreateFromOpen(true)}>
            <GitBranch className="h-4 w-4" />
            Create branch from this
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => setChangeBaseOpen(true)}>
            <ArrowRightLeft className="h-4 w-4" />
            Change base branch...
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
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => openWorkspaceSettings(worktree.repoPath)}>
            <Settings className="h-4 w-4" />
            Open Repo Settings
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Native members open the popover from the N/M chip even when they have
          no local chain — StackMapPopover renders GitHub-style from the PR's
          nativeStack roster in that case. */}
      {stackMapOpen && (stackChain || worktree.prStatus?.nativeStack) && (
        <StackMapFrame anchorRef={rowContainerRef} frameRef={stackMapFrameRef}>
          <StackMapPopover
            anchorWorktree={worktree}
            chain={stackChain}
            defaultBranch={defaultBranch}
            onClose={() => setStackMapOpen(false)}
          />
        </StackMapFrame>
      )}

      {adoptState.stage === "open" && (
        <StackMapFrame
          anchorRef={rowContainerRef}
          frameRef={adoptFrameRef}
          remeasureKey={adoptState.probed}
        >
          <AdoptStackPopover
            parent={adoptState.parent}
            branch={worktree.branch}
            prNumber={worktree.prStatus?.number ?? null}
            defaultBranch={defaultBranch}
            probed={adoptState.probed}
            behind={adoptState.behind}
            onConfirm={() => { void handleAdoptConfirm(); }}
            onNotNow={handleDismissAdoptCue}
          />
        </StackMapFrame>
      )}

      <DeleteWorktreeConfirm
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        branch={worktree.branch}
        worktreePath={worktree.path}
        repoPath={worktree.repoPath}
        onConfirm={() => onDelete?.(worktree.id)}
      />

      <CreateWorktreeDialog
        open={createFromOpen}
        onOpenChange={setCreateFromOpen}
        repoPath={repoPath ?? worktree.repoPath}
        lockedBaseBranch={worktree.branch}
      />

      <ChangeBaseBranchDialog
        open={changeBaseOpen}
        onOpenChange={setChangeBaseOpen}
        worktree={worktree}
      />
    </div>
  );
});

export { AgentItem, AgentItemContent, useAgentItemState, useStackHue, getBorderClass };
export type { AgentItemProps };
