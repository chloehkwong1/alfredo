import { memo } from "react";
import { GitBranch } from "lucide-react";
import { REPO_COLOR_PALETTE, repoDisplayName } from "./RepoSelector";
import { RepoTag } from "./RepoTag";
import { formatDiffStat, PrStatsRow, hasPrStats } from "./PrStatsRow";
import type { PrSummary } from "./PrStatsRow";
import { usePrStore } from "../../stores/prStore";
import type { BranchRepoState } from "../../hooks/useBranchRepos";

interface BranchCardProps {
  repo: BranchRepoState;
  isSelected: boolean;
  onClick: () => void;
  repoColors: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  repoIndex: number;
  showRepoTag: boolean;
}

const BranchCard = memo(function BranchCard({
  repo,
  isSelected,
  onClick,
  repoColors,
  repoDisplayNames,
  repoIndex,
  showRepoTag,
}: BranchCardProps) {
  const prSummary = usePrStore((s) => s.prSummary[repo.id]) as PrSummary | undefined;

  const colorId = repoColors[repo.repoPath];
  const color = REPO_COLOR_PALETTE.find((c) => c.id === colorId)
    ?? REPO_COLOR_PALETTE[repoIndex % REPO_COLOR_PALETTE.length];

  // Tinted bg/border from the repo's assigned color
  const bgBase = color.bg.replace(/[\d.]+\)$/, "0.04)");
  const bgSelected = color.bg.replace(/[\d.]+\)$/, "0.06)");
  const borderBase = color.border.replace(/[\d.]+\)$/, "0.12)");
  const borderSelected = color.border.replace(/[\d.]+\)$/, "0.2)");

  const displayName = repoDisplayName(repo.repoPath, repoDisplayNames);

  const add = formatDiffStat(repo.additions);
  const del = formatDiffStat(repo.deletions);

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full text-left mx-2.5 my-1 rounded-[var(--radius-md)] transition-all duration-[var(--transition-fast)] cursor-pointer",
        isSelected ? "brightness-125" : "hover:brightness-115",
      ].join(" ")}
      style={{
        padding: "10px 12px",
        border: `1px solid ${isSelected ? borderSelected : borderBase}`,
        background: isSelected ? bgSelected : bgBase,
        filter: isSelected ? "brightness(1.25)" : undefined,
        width: "calc(100% - 20px)",
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.filter = "brightness(1.15)";
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.filter = "";
      }}
    >
      {/* Row 1: repo name, PR number, repo tag */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-text-primary truncate">
          {displayName}
        </span>
        {prSummary && (
          <span className="text-xs text-text-tertiary flex-shrink-0">
            {/* PR number would come from prStore if available */}
          </span>
        )}
        {showRepoTag && (
          <span className="ml-auto flex-shrink-0">
            <RepoTag
              repoPath={repo.repoPath}
              repoColors={repoColors}
              repoDisplayNames={repoDisplayNames}
              repoIndex={repoIndex}
              visible
            />
          </span>
        )}
      </div>

      {/* Row 2: git branch icon + branch name */}
      <div className="flex items-center gap-1.5 mt-1">
        <GitBranch size={12} className="text-text-tertiary flex-shrink-0" />
        <span className="text-xs text-text-tertiary font-mono truncate">
          {repo.branch ?? "unknown"}
        </span>
      </div>

      {/* Row 3: agent status + diff stats */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-xs text-text-tertiary">Not running</span>
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
  );
});

export { BranchCard };
