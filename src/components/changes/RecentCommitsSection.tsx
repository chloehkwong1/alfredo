import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { getFullCommits } from "../../api";
import { lifecycleManager } from "../../services/lifecycleManager";
import { formatRelativeTime } from "./formatRelativeTime";
import { formatAuthor } from "./formatAuthor";
import type { CommitInfo } from "../../types";

interface RecentCommitsSectionProps {
  repoPath: string;
  worktreeId: string;
  defaultBranchName: string | null;
  gitUser: string | null;
}

/**
 * Collapsible "Recent commits on <default-branch>" disclosure rendered below
 * FileSidebar in the simplified pinned-main-card view. Mirrors the upstream
 * commits affordance from FileSidebar so origin/main history stays peekable
 * even when the Files/Commits tab bar is hidden.
 */
export function RecentCommitsSection({
  repoPath,
  worktreeId,
  defaultBranchName,
  gitUser,
}: RecentCommitsSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [commits, setCommits] = useState<CommitInfo[]>([]);

  // Initial fetch on mount / repo change.
  useEffect(() => {
    let cancelled = false;
    getFullCommits(repoPath, 20)
      .then((rows) => {
        if (!cancelled) setCommits(rows);
      })
      .catch(() => {
        if (!cancelled) setCommits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  // Refetch every 30s only while expanded — collapsed state stays static.
  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    const id = setInterval(() => {
      getFullCommits(repoPath, 20)
        .then((rows) => {
          if (!cancelled) setCommits(rows);
        })
        .catch(() => { /* keep last good list */ });
    }, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [expanded, repoPath]);

  if (commits.length === 0) return null;

  const branchLabel = defaultBranchName ?? "main";

  return (
    <div className="border-t border-border-subtle shrink-0">
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center gap-1.5 px-2.5 py-2 text-left text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors"
      >
        <ChevronDown
          size={12}
          className={`text-text-tertiary shrink-0 transition-transform duration-150 ${expanded ? "" : "-rotate-90"}`}
        />
        Recent commits on <code className="font-mono text-[11px]">{branchLabel}</code>
      </button>

      {expanded && commits.map((commit) => {
        const subject = commit.message.split("\n")[0];
        const author = formatAuthor(commit.author, gitUser);
        return (
          <button
            key={commit.hash}
            onClick={() => lifecycleManager.openDiffPreview(worktreeId, { type: "commit", commitHash: commit.hash })}
            className="w-full px-2.5 py-2 text-left border-l-2 border-transparent opacity-55 hover:bg-bg-hover hover:opacity-100 transition-all"
          >
            <div className="text-[13px] leading-snug text-text-primary font-medium">
              {subject}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] font-mono text-text-tertiary">
                {commit.shortHash}
              </span>
              <span className="text-[11px] text-text-tertiary">·</span>
              <span className={`text-[11px] ${author.className}`}>
                {author.text}
              </span>
              <span className="text-[11px] text-text-tertiary">·</span>
              <span className="text-[11px] text-text-tertiary">
                {formatRelativeTime(commit.timestamp)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
