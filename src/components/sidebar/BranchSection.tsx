import { BranchCard } from "./BranchCard";
import type { BranchRepoState } from "../../hooks/useBranchRepos";

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
}: BranchSectionProps) {
  if (branchRepos.length === 0) return null;

  return (
    <div
      className={hasWorktreeItems ? "border-t border-border-subtle pt-2 mt-1" : ""}
    >
      {branchRepos.map((repo) => (
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
        />
      ))}
    </div>
  );
}

export { BranchSection };
