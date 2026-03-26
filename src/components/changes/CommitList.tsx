import type { CommitInfo } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";

interface CommitListProps {
  commits: CommitInfo[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

function CommitList({ commits, selectedIndex, onSelect }: CommitListProps) {
  return (
    <div className="flex flex-col flex-[3] min-h-0">
      <div className="px-3 py-2 text-xs font-semibold text-text-tertiary uppercase tracking-wider flex-shrink-0">
        Commits
      </div>
      <div className="flex-1 overflow-y-auto">
        {commits.map((commit, idx) => {
          const isSelected = idx === selectedIndex;
          const subject = commit.message.trim().split("\n")[0];
          return (
            <button
              key={commit.hash}
              type="button"
              onClick={() => onSelect(idx)}
              aria-current={isSelected ? "true" : undefined}
              className={[
                "w-full text-left px-3 py-1.5 cursor-pointer transition-colors",
                isSelected
                  ? "bg-bg-hover border-l-2 border-l-accent-primary"
                  : "border-l-2 border-l-transparent hover:bg-bg-hover/50",
              ].join(" ")}
            >
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span className="text-xs text-text-primary truncate flex-1">
                  {subject}
                </span>
                <span className="text-2xs text-text-tertiary whitespace-nowrap flex-shrink-0">
                  {formatRelativeTime(commit.timestamp)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-2xs text-text-tertiary font-mono">
                  {commit.shortHash}
                </span>
                {isSelected && (
                  <span className="text-2xs text-text-tertiary">
                    · {commit.author}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { CommitList };
export type { CommitListProps };
