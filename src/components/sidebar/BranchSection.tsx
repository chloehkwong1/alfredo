import { BranchCard } from "./BranchCard";
import { PinMainButton } from "./PinMainButton";
import type { BranchRepoState } from "../../hooks/useBranchRepos";
import type { RepoEntry } from "../../types";

interface BranchSectionProps {
  branchRepos: BranchRepoState[];
  activeRepoId: string | null;
  onSelectRepo: (id: string) => void;
  repoColors: Record<string, string>;
  repoDisplayNames?: Record<string, string>;
  repoShortLabels?: Record<string, string>;
  repoIndexMap: Record<string, number>;
  showRepoTags: boolean;
  /** Whether worktree items exist above — controls divider visibility */
  hasWorktreeItems: boolean;
  /** Repos configured in worktree-mode. Their cards use the branch-title layout. */
  worktreeModeRepoSet: Set<string>;
  /** Worktree-mode repos selected but not yet pinned — drive the add-button. */
  eligibleWorktreeRepos: RepoEntry[];
  worktreeCountByRepo: Record<string, number>;
  onPinRepo: (path: string) => void;
  onUnpinRepo: (path: string) => void;
}

function BranchSection({
  branchRepos,
  activeRepoId,
  onSelectRepo,
  repoColors,
  repoDisplayNames,
  repoShortLabels,
  repoIndexMap,
  showRepoTags,
  hasWorktreeItems,
  worktreeModeRepoSet,
  eligibleWorktreeRepos,
  worktreeCountByRepo,
  onPinRepo,
  onUnpinRepo,
}: BranchSectionProps) {
  const hasCards = branchRepos.length > 0;
  const hasButton = eligibleWorktreeRepos.length > 0;
  if (!hasCards && !hasButton) return null;

  return (
    <div
      className={hasWorktreeItems ? "border-t border-border-subtle pt-2 mt-1" : ""}
    >
      {branchRepos.map((repo) => {
        const isWorktreeMode = worktreeModeRepoSet.has(repo.repoPath);
        return (
          <BranchCard
            key={repo.id}
            repo={repo}
            isSelected={repo.id === activeRepoId}
            onClick={() => onSelectRepo(repo.id)}
            repoColors={repoColors}
            repoDisplayNames={repoDisplayNames}
            repoShortLabels={repoShortLabels}
            repoIndex={repoIndexMap[repo.repoPath] ?? 0}
            showRepoTag={showRepoTags}
            titleMode={isWorktreeMode ? "branch" : "repo"}
            onUnpin={isWorktreeMode ? () => onUnpinRepo(repo.repoPath) : undefined}
          />
        );
      })}
      <PinMainButton
        eligibleWorktreeRepos={eligibleWorktreeRepos}
        worktreeCountByRepo={worktreeCountByRepo}
        repoColors={repoColors}
        repoDisplayNames={repoDisplayNames}
        repoIndexMap={repoIndexMap}
        onPinRepo={onPinRepo}
      />
    </div>
  );
}

export { BranchSection };
