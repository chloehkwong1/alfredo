import { useEffect, useMemo, useRef, useState } from "react";
import { getDiff, getUncommittedDiff, getCommits, getFullCommits, getDiffForCommit } from "../api";
import type { DiffFile, CommitInfo } from "../types";
import type { ViewMode } from "../components/changes/FileSidebar";

interface UseChangesDataReturn {
  uncommittedFiles: DiffFile[];
  committedFiles: DiffFile[];
  commits: CommitInfo[];
  upstreamCommits: CommitInfo[];
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
  skipCommitted?: boolean,
): UseChangesDataReturn {
  const [uncommittedFiles, setUncommittedFiles] = useState<DiffFile[]>([]);
  const [committedFiles, setCommittedFiles] = useState<DiffFile[]>([]);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [upstreamCommits, setUpstreamCommits] = useState<CommitInfo[]>([]);
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

  // Load committed files and commits from local git, polling every 10s.
  // Skipped entirely for branch-mode repos on the default branch (no meaningful committed diff).
  useEffect(() => {
    if (skipCommitted) {
      setCommittedFiles([]);
      setCommits([]);
      setUpstreamCommits([]);
      return;
    }
    let cancelled = false;

    // Always use local git for commits and file diffs — local state is the source of truth.
    // PR metadata (comments, reviews, checks) is fetched separately via usePrStore.
    const fetchLocal = () => {
      getDiff(repoPath, baseBranch)
        .then((files) => { if (!cancelled) { setCommittedFiles(files); setError(null); } })
        .catch((err) => { if (!cancelled) setError(`Committed diff failed: ${err}`); });
      getCommits(repoPath, baseBranch)
        .then((branchList) => {
          if (cancelled) return;
          setCommits(branchList);

          // Skip upstream fetch if branch already has ≥20 commits
          if (branchList.length >= 20) {
            setUpstreamCommits([]);
            return;
          }

          getFullCommits(repoPath, 20)
            .then((fullList) => {
              if (cancelled) return;
              const branchHashes = new Set(branchList.map((c) => c.hash));
              setUpstreamCommits(fullList.filter((c) => !branchHashes.has(c.hash)));
            })
            .catch(() => { if (!cancelled) setUpstreamCommits([]); });
        })
        .catch((err) => { if (!cancelled) setError(`Commits failed: ${err}`); });
    };
    fetchLocal();
    const interval = setInterval(fetchLocal, 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [repoPath, baseBranch, skipCommitted]);

  // Build combined commit list for index lookups
  const allCommits = useMemo(
    () => [...commits, ...upstreamCommits],
    [commits, upstreamCommits],
  );

  useEffect(() => {
    if (viewMode !== "commits" || selectedCommitIndex === null || allCommits.length === 0) {
      setCommitFiles([]);
      return;
    }
    let cancelled = false;
    const commit = allCommits[selectedCommitIndex];
    if (!commit) return;
    getDiffForCommit(repoPath, commit.hash)
      .then((files) => { if (!cancelled) setCommitFiles(files); })
      .catch((err) => { if (!cancelled) setError(`Commit diff failed: ${err}`); });
    return () => { cancelled = true; };
  }, [viewMode, selectedCommitIndex, allCommits, repoPath]);

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

    // Shallow-compare: same file paths in same order with same hunk count and content → reuse old ref.
    // Hunk headers encode line positions (e.g. "@@ -141,22 +141,20 @@"), so they almost always differ
    // when content changes even if additions/deletions counts are identical. Spot-checking the first
    // line's content per hunk covers the remaining edge case (same position, different content).
    // This prevents stale diffs when a file transitions between committed and uncommitted with matching stats.
    const prev = displayFilesRef.current;
    if (
      prev.length === next.length &&
      prev.every((f, i) =>
        f.path === next[i].path &&
        f.hunks.length === next[i].hunks.length &&
        f.additions === next[i].additions &&
        f.deletions === next[i].deletions &&
        // hunks.length equality above guarantees next[i].hunks[j] is in-bounds
        f.hunks.every((h, j) =>
          h.header === next[i].hunks[j].header &&
          h.lines[0]?.content === next[i].hunks[j].lines[0]?.content,
        ),
      )
    ) {
      return prev;
    }
    displayFilesRef.current = next;
    return next;
  }, [viewMode, uncommittedFiles, committedFiles, commitFiles, selectedCommitIndex]);

  return { uncommittedFiles, committedFiles, commits, upstreamCommits, commitFiles, displayFiles, refetchUncommitted, error };
}
