import { useEffect, useMemo, useState } from "react";
import { getDiff, getUncommittedDiff, getCommits, getDiffForCommit } from "../api";
import type { DiffFile, CommitInfo } from "../types";
import type { ViewMode } from "../components/changes/FileSidebar";

interface UseChangesDataReturn {
  uncommittedFiles: DiffFile[];
  committedFiles: DiffFile[];
  commits: CommitInfo[];
  commitFiles: DiffFile[];
  displayFiles: DiffFile[];
}

export function useChangesData(
  repoPath: string,
  viewMode: ViewMode,
  selectedCommitIndex: number | null,
  baseBranch?: string,
): UseChangesDataReturn {
  const [uncommittedFiles, setUncommittedFiles] = useState<DiffFile[]>([]);
  const [committedFiles, setCommittedFiles] = useState<DiffFile[]>([]);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [commitFiles, setCommitFiles] = useState<DiffFile[]>([]);

  useEffect(() => {
    if (viewMode !== "changes") return;
    let cancelled = false;
    getUncommittedDiff(repoPath)
      .then((files) => { if (!cancelled) setUncommittedFiles(files); })
      .catch((err) => console.error("Failed to load uncommitted diff:", err));
    return () => { cancelled = true; };
  }, [viewMode, repoPath]);

  useEffect(() => {
    let cancelled = false;
    getDiff(repoPath, baseBranch)
      .then((files) => { if (!cancelled) setCommittedFiles(files); })
      .catch((err) => console.error("Failed to load committed diff:", err));
    getCommits(repoPath, baseBranch)
      .then((list) => { if (!cancelled) setCommits(list); })
      .catch((err) => console.error("Failed to load commits:", err));
    return () => { cancelled = true; };
  }, [repoPath, baseBranch]);

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
      case "changes": return uncommittedFiles;
      case "pr": return committedFiles;
      case "commits": return selectedCommitIndex !== null ? commitFiles : [];
    }
  }, [viewMode, uncommittedFiles, committedFiles, commitFiles, selectedCommitIndex]);

  return { uncommittedFiles, committedFiles, commits, commitFiles, displayFiles };
}
