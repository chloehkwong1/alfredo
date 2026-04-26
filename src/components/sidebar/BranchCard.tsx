import { memo, useState } from "react";
import { GitBranch, LayoutGrid, Settings, X } from "lucide-react";
import { REPO_COLOR_PALETTE, repoDisplayName, resolveColorId } from "./RepoSelector";
import { RepoTag } from "./RepoTag";
import { formatDiffStat, PrStatsRow, hasPrStats } from "./PrStatsRow";
import type { PrSummary } from "./PrStatsRow";
import { usePrStore } from "../../stores/prStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { computeEffectiveStatus, statusDotColor, statusText } from "./AgentItem";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ui/ContextMenu";
import { setRepoMode } from "../../api";
import { openWorkspaceSettings } from "../settings/openWorkspaceSettings";

const ATTN_STATES = new Set(["waitingForInput", "done", "ready"]);

function attnBorder(status: string, isUnread: boolean): { color: string; style: "solid" | "dashed" } | null {
  if (status === "error") return { color: "var(--status-error)", style: isUnread ? "dashed" : "solid" };
  if (ATTN_STATES.has(status)) return { color: "var(--accent-primary)", style: isUnread ? "dashed" : "solid" };
  return null;
}

function dotGlowClass(status: string): string {
  if (status === "error") return "dot-glow-error";
  if (ATTN_STATES.has(status)) return "dot-glow-attn";
  return "";
}
import type { BranchRepoState } from "../../hooks/useBranchRepos";

interface BranchCardProps {
  repo: BranchRepoState;
  isSelected: boolean;
  onClick: () => void;
  repoColors: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  repoShortLabels?: Record<string, string>;
  repoIndex: number;
  showRepoTag: boolean;
  /** "repo" = title is the repo name, branch name below (branch-mode repos).
      "branch" = title is the branch name, repo tag right-aligned (worktree-mode
      opt-in main cards). Parallels the branch-titled worktree rows above. */
  titleMode?: "repo" | "branch";
  /** When provided on a branch-title card, renders a hover-revealed × that
      unpins this worktree-mode main card from the sidebar. */
  onUnpin?: () => void;
}

const BranchCard = memo(function BranchCard({
  repo,
  isSelected,
  onClick,
  repoColors,
  repoDisplayNames,
  repoShortLabels,
  repoIndex,
  showRepoTag,
  titleMode = "repo",
  onUnpin,
}: BranchCardProps) {
  const prSummary = usePrStore((s) => s.prSummary[repo.id]) as PrSummary | undefined;
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === repo.id));
  const isSeen = useWorkspaceStore((s) => s.seenWorktrees.has(repo.id));
  const isUnread = useWorkspaceStore((s) => s.unreadWorktrees.has(repo.id));
  const effectiveStatus = worktree
    ? computeEffectiveStatus(
        worktree.agentStatus,
        worktree.channelAlive,
        worktree.staleBusy,
        isSeen && !isUnread,
        worktree.justCreated,
      )
    : "notRunning";
  const statusLabel = statusText[effectiveStatus] ?? "Not running";
  const dotColor = statusDotColor[effectiveStatus] ?? "bg-text-tertiary";
  const shouldPulse = effectiveStatus === "waitingForInput";
  const attn = attnBorder(effectiveStatus, isUnread);
  const glow = dotGlowClass(effectiveStatus);

  const colorId = resolveColorId(repoColors[repo.repoPath]);
  const color = (colorId ? REPO_COLOR_PALETTE.find((c) => c.id === colorId) : undefined)
    ?? REPO_COLOR_PALETTE[repoIndex % REPO_COLOR_PALETTE.length];

  // Tinted bg/border derived from the solid chip colour via color-mix (so
  // palette entries stay a single CSS var and can be swapped theme-wide).
  const bgBase = `color-mix(in srgb, ${color.bg} 4%, transparent)`;
  const bgSelected = `color-mix(in srgb, ${color.bg} 16%, transparent)`;
  const borderBase = `color-mix(in srgb, ${color.border} 12%, transparent)`;
  const borderSelected = color.border;

  const displayName = repoDisplayName(repo.repoPath, repoDisplayNames);
  const showUnpin = titleMode === "branch" && !!onUnpin;

  const add = formatDiffStat(repo.additions);
  const del = formatDiffStat(repo.deletions);

  const [converting, setConverting] = useState(false);
  const handleConvertToWorktree = async () => {
    if (converting) return;
    const confirmed = window.confirm(
      `Convert "${displayName}" to worktree mode? The board will reload to reflect the change.`,
    );
    if (!confirmed) return;
    setConverting(true);
    try {
      await setRepoMode(repo.repoPath, "worktree");
      window.dispatchEvent(new Event("config-changed"));
      openWorkspaceSettings(repo.repoPath);
    } catch (e) {
      console.error("Failed to convert repo to worktree mode:", e);
      window.alert(
        `Failed to convert: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setConverting(false);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="group relative mx-2.5 my-1"
          style={{ width: "calc(100% - 20px)" }}
        >
          <button
            type="button"
            onClick={onClick}
            className="w-full text-left rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer"
            style={{
              padding: "10px 12px",
              border: `1px solid ${isSelected ? borderSelected : borderBase}`,
              ...(attn ? { borderLeft: `3px ${attn.style} ${attn.color}` } : {}),
              background: isSelected ? bgSelected : bgBase,
              boxShadow: isSelected
                ? `0 0 0 1px color-mix(in srgb, ${color.border} 40%, transparent)`
                : undefined,
            }}
            onMouseEnter={(e) => {
              if (!isSelected) e.currentTarget.style.filter = "brightness(1.15)";
            }}
            onMouseLeave={(e) => {
              if (!isSelected) e.currentTarget.style.filter = "";
            }}
          >
            {/* Row 1: title (repo or branch depending on mode) + repo tag */}
            <div className="flex items-center gap-2">
              {titleMode === "branch" ? (
                <span className="flex items-center gap-1.5 min-w-0 flex-1">
                  <GitBranch size={12} className="text-text-tertiary flex-shrink-0" />
                  <span className="text-sm font-medium text-text-primary font-mono truncate">
                    {repo.branch ?? "unknown"}
                  </span>
                </span>
              ) : (
                <span className="text-sm font-medium text-text-primary truncate">
                  {displayName}
                </span>
              )}
              {showRepoTag && (
                <span className="ml-auto flex-shrink-0">
                  <RepoTag
                    repoPath={repo.repoPath}
                    repoColors={repoColors}
                    repoDisplayNames={repoDisplayNames}
                    repoShortLabels={repoShortLabels}
                    repoIndex={repoIndex}
                    visible
                  />
                </span>
              )}
            </div>

            {/* Row 2 (repo-title mode only): git branch icon + branch name */}
            {titleMode === "repo" && (
              <div className="flex items-center gap-1.5 mt-1">
                <GitBranch size={12} className="text-text-tertiary flex-shrink-0" />
                <span className="text-xs text-text-tertiary font-mono truncate">
                  {repo.branch ?? "unknown"}
                </span>
              </div>
            )}

            {/* Row 3: agent status + diff stats */}
            <div className="flex items-center gap-2 mt-1">
              <span className="flex items-center gap-1.5">
                <span
                  className={[
                    "h-1.5 w-1.5 rounded-full flex-shrink-0",
                    dotColor,
                    glow,
                    shouldPulse ? "animate-pulse-dot" : "",
                  ].join(" ")}
                />
                <span className="text-xs text-text-tertiary">{statusLabel}</span>
              </span>
              {(add || del) && (
                <span className="flex items-center gap-1 text-xs ml-auto flex-shrink-0">
                  {add && <span className="text-diff-added">+{add}</span>}
                  {del && <span className="text-diff-removed">-{del}</span>}
                </span>
              )}
            </div>

            {/* Row 4: PR stats (only when PR data exists) */}
            {prSummary && hasPrStats(prSummary) && (
              <div className="pt-2 mt-2.5 border-t border-border-subtle">
                <PrStatsRow prSummary={prSummary} />
              </div>
            )}
          </button>
          {showUnpin && (
            // No stopPropagation needed: this button is a sibling of the card
            // <button>, not a descendant, so the card's onClick can't fire.
            <button
              type="button"
              aria-label={`Unpin ${displayName} main card`}
              title="Unpin main card"
              onClick={onUnpin}
              className="absolute top-1.5 right-1.5 w-[18px] h-[18px] flex items-center justify-center rounded opacity-0 group-hover:opacity-100 focus:opacity-100 bg-black/15 border border-border-subtle text-text-tertiary hover:bg-bg-hover hover:text-text-secondary transition-opacity cursor-pointer"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {titleMode === "repo" && (
          <>
            <ContextMenuItem onSelect={handleConvertToWorktree} disabled={converting}>
              <LayoutGrid className="h-4 w-4" />
              Convert to worktree mode
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuItem onSelect={() => openWorkspaceSettings(repo.repoPath)}>
          <Settings className="h-4 w-4" />
          Open Repo Settings
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export { BranchCard };
