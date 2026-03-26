import { GitCommitHorizontal } from "lucide-react";
import type { CommitInfo } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";

interface CommitDetailBarProps {
  commit: CommitInfo;
}

function CommitDetailBar({ commit }: CommitDetailBarProps) {
  const [subject, ...bodyLines] = commit.message.trim().split("\n");
  const body = bodyLines.join("\n").trim();

  return (
    <div className="bg-bg-secondary border-b border-border-subtle flex-shrink-0 px-3 py-2">
      <div className="flex items-start gap-2">
        <GitCommitHorizontal
          size={14}
          className="text-text-tertiary flex-shrink-0 mt-0.5"
        />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-text-primary leading-snug">
            {subject}
          </div>
          {body && (
            <div className="text-2xs text-text-tertiary mt-1 whitespace-pre-wrap leading-relaxed">
              {body}
            </div>
          )}
          <div className="flex items-center gap-2 mt-1 text-2xs text-text-tertiary">
            <span className="font-mono">{commit.shortHash}</span>
            <span>{commit.author}</span>
            <span>{formatRelativeTime(commit.timestamp)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export { CommitDetailBar };
export type { CommitDetailBarProps };
