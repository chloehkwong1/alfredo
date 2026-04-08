import { useEffect, useMemo, useRef, useState } from "react";
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
  /** Error message from the most recent failed fetch, or null if healthy. */
  error: string | null;
}

export function useChangesData(
  repoPath: string,
  viewMode: ViewMode,
  selectedCommitIndex: number | null,
  baseBranch?: string,
  prNumber?: number,
  skipCommitted?: boolean,
): UseChangesDataReturn {
  const [uncommittedFiles, setUncommittedFiles] = useState<DiffFile[]>([]);
  const [committedFiles, setCommittedFiles] = useState<DiffFile[]>([]);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [commitFiles, setCommitFiles] = useState<DiffFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetchUncommitted = () => setRefreshKey((k) => k + 1);

  // Always load uncommitted files (no viewMode guard), poll to pick up new edits
  useEffect(() => {
    let cancelled = false;
    const fetch = () => {
      getUncommittedDiff(repoPath)
        .then((files) => { if (!cancelled) { setUncommittedFiles(files); setError(null); } })
        .catch((err) => { if (!cancelled) setError(`Uncommitted diff failed: ${err}`); });
    };
    fetch();
    const interval = setInterval(fetch, 3_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [repoPath, refreshKey]);

  // Load committed files and commits — from GitHub API when PR exists, local git otherwise.
  // Local git paths poll every 10s to pick up new commits; GitHub API paths poll every 30s
  // to pick up force-pushes and rebases.
  // Skipped entirely for branch-mode repos on the default branch (no meaningful committed diff).
  useEffect(() => {
    if (skipCommitted) {
      setCommittedFiles([]);
      setCommits([]);
      return;
    }
    let cancelled = false;

    if (prNumber) {
      // PR exists: fetch from GitHub API, poll every 30s to pick up force-pushes
      const fetchPr = () => {
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
            setError(null);
          })
          .catch((err) => { if (!cancelled) setError(`PR files failed: ${err}`); });

        getPrCommits(repoPath, prNumber)
          .then((list) => { if (!cancelled) setCommits(list); })
          .catch((err) => { if (!cancelled) setError(`PR commits failed: ${err}`); });
      };
      fetchPr();
      const interval = setInterval(fetchPr, 30_000);
      return () => { cancelled = true; clearInterval(interval); };
    }

    // No PR: use local git diff — poll to pick up new commits
    const fetchLocal = () => {
      getDiff(repoPath, baseBranch)
        .then((files) => { if (!cancelled) { setCommittedFiles(files); setError(null); } })
        .catch((err) => { if (!cancelled) setError(`Committed diff failed: ${err}`); });
      getCommits(repoPath, baseBranch)
        .then((list) => { if (!cancelled) setCommits(list); })
        .catch((err) => { if (!cancelled) setError(`Commits failed: ${err}`); });
    };
    fetchLocal();
    const interval = setInterval(fetchLocal, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [repoPath, baseBranch, prNumber, skipCommitted]);

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
      .catch((err) => { if (!cancelled) setError(`Commit diff failed: ${err}`); });
    return () => { cancelled = true; };
  }, [viewMode, selectedCommitIndex, commits, repoPath]);

  // Build display files list, stabilised to avoid triggering downstream useMemo
  // (like search) on every 3-second poll when the actual data hasn't changed.
  const displayFilesRef = useRef<DiffFile[]>([]);
  const displayFiles = useMemo(() => {
    let next: DiffFile[];
    switch (viewMode) {
      case "changes": {
        const uncommittedPaths = new Set(uncommittedFiles.map((f) => f.path));
        const uniqueCommitted = committedFiles.filter((f) => !uncommittedPaths.has(f.path));
        next = [...uncommittedFiles, ...uniqueCommitted];
        break;
      }
      case "commits":
        next = selectedCommitIndex !== null ? commitFiles : [];
        break;
    }

    // Shallow-compare: same file paths in same order with same hunk count → reuse old ref
    const prev = displayFilesRef.current;
    if (
      prev.length === next.length &&
      prev.every((f, i) =>
        f.path === next[i].path &&
        f.hunks.length === next[i].hunks.length &&
        f.additions === next[i].additions &&
        f.deletions === next[i].deletions,
      )
    ) {
      return prev;
    }
    displayFilesRef.current = next;
    return next;
  }, [viewMode, uncommittedFiles, committedFiles, commitFiles, selectedCommitIndex]);

  return { uncommittedFiles, committedFiles, commits, commitFiles, displayFiles, refetchUncommitted, error };
}
