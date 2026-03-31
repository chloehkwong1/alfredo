import { useEffect, useMemo, useState } from "react";
import { getDiff, getUncommittedDiff, getCommits, getDiffForCommit, getPrFiles, getPrCommits } from "../api";
import type { DiffFile, CommitInfo } from "../types";
import type { ViewMode } from "../components/changes/FileSidebar";

interface UseChangesDataReturn {
  uncommittedFiles: DiffFile[];
  committedFiles: DiffFile[];
  commits: CommitInfo[];
  commitFiles: DiffFile[];
  displayFiles: DiffFile[];
  refetchUncommitted: () => void;
}

export function useChangesData(
  repoPath: string,
  viewMode: ViewMode,
  selectedCommitIndex: number | null,
  baseBranch?: string,
  prNumber?: number,
): UseChangesDataReturn {
  const [uncommittedFiles, setUncommittedFiles] = useState<DiffFile[]>([]);
  const [committedFiles, setCommittedFiles] = useState<DiffFile[]>([]);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [commitFiles, setCommitFiles] = useState<DiffFile[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetchUncommitted = () => setRefreshKey((k) => k + 1);

  // Always load uncommitted files (no viewMode guard), poll to pick up new edits
  useEffect(() => {
    let cancelled = false;
    const fetch = () => {
      getUncommittedDiff(repoPath)
        .then((files) => { if (!cancelled) setUncommittedFiles(files); })
        .catch((err) => console.error("Failed to load uncommitted diff:", err));
    };
    fetch();
    const interval = setInterval(fetch, 3_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [repoPath, refreshKey]);

  // Load committed files and commits — from GitHub API when PR exists, local git otherwise.
  // Local git paths poll every 10s to pick up new commits; GitHub API paths fetch once
  // (refreshed by github_sync on a longer cadence).
  useEffect(() => {
    let cancelled = false;

    if (prNumber) {
      // PR exists: fetch from GitHub API (no polling — rate-limit sensitive)
      getPrFiles(repoPath, prNumber)
        .then(async (files) => {
          if (cancelled) return;

          // Handle truncated files: fall back to local git diff for those
          const truncated = files.filter((f) => f.truncated);
          if (truncated.length > 0) {
            try {
              const localFiles = await getDiff(repoPath, baseBranch);
              if (cancelled) return;
              const localByPath = new Map(localFiles.map((f) => [f.path, f]));
              const merged = files.map((f) => {
                if (f.truncated) {
                  return localByPath.get(f.path) ?? f;
                }
                return f;
              });
              setCommittedFiles(merged);
            } catch {
              if (cancelled) return;
              // If local fallback fails, show what GitHub gave us (empty hunks for truncated)
              setCommittedFiles(files);
            }
          } else {
            setCommittedFiles(files);
          }
        })
        .catch((err) => console.error("Failed to load PR files:", err));

      getPrCommits(repoPath, prNumber)
        .then((list) => { if (!cancelled) setCommits(list); })
        .catch((err) => console.error("Failed to load PR commits:", err));

      return () => { cancelled = true; };
    }

    // No PR: use local git diff — poll to pick up new commits
    const fetchLocal = () => {
      getDiff(repoPath, baseBranch)
        .then((files) => { if (!cancelled) setCommittedFiles(files); })
        .catch((err) => console.error("Failed to load committed diff:", err));
      getCommits(repoPath, baseBranch)
        .then((list) => { if (!cancelled) setCommits(list); })
        .catch((err) => console.error("Failed to load commits:", err));
    };
    fetchLocal();
    const interval = setInterval(fetchLocal, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [repoPath, baseBranch, prNumber]);

  useEffect(() => {
    if (viewMode !== "commits" || selectedCommitIndex === null || commits.length === 0) {
      setCommitFiles([]);
      return;
    }
    let cancelled = false;
    const commit = commits[selectedCommitIndex];
    if (!commit) return;
    getDiffForCommit(repoPath, commit.hash)
      .then((files) => { if (!cancelled) setCommitFiles(files); })
      .catch((err) => console.error("Failed to load commit diff:", err));
    return () => { cancelled = true; };
  }, [viewMode, selectedCommitIndex, commits, repoPath]);

  const displayFiles = useMemo(() => {
    switch (viewMode) {
      case "changes": {
        // Deduplicate: uncommitted (local edits) take precedence over committed version
        const uncommittedPaths = new Set(uncommittedFiles.map((f) => f.path));
        const uniqueCommitted = committedFiles.filter((f) => !uncommittedPaths.has(f.path));
        return [...uncommittedFiles, ...uniqueCommitted];
      }
      case "commits": return selectedCommitIndex !== null ? commitFiles : [];
    }
  }, [viewMode, uncommittedFiles, committedFiles, commitFiles, selectedCommitIndex]);

  return { uncommittedFiles, committedFiles, commits, commitFiles, displayFiles, refetchUncommitted };
}
