import { useCallback, useEffect, useMemo, useState } from "react";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { DiffFileCard } from "./DiffFileCard";
import { useDiscardChanges } from "./useDiscardChanges";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePrStore } from "../../stores/prStore";
import { Button } from "../ui/Button";
import { useChangesData } from "../../hooks/useChangesData";
import { useGitUser } from "../../hooks/useGitUser";
import { useFileNavigation } from "../../hooks/useFileNavigation";
import { useDiffSearch } from "../../hooks/useDiffSearch";

import { sendPrCommentToClaude } from "../../services/sendPrCommentToClaude";
import { Trash2, Check, Copy } from "lucide-react";
import type { CommitInfo, DiffTarget, PrComment } from "../../types";
import { useAnnotationActions } from "./useAnnotationActions";
import { ChangesToolbar } from "./ChangesToolbar";
import { CommitJumpBar } from "./CommitJumpBar";
import { DiscardDialog } from "./DiscardDialog";
import { AnnotationBar } from "./AnnotationBar";

const EMPTY_COMMENTS: PrComment[] = [];
import { formatRelativeTime } from "./formatRelativeTime";
import { useAppConfig } from "../../hooks/useAppConfig";

interface ChangesViewProps {
  worktreeId: string;
  repoPath: string;
  diffTarget?: DiffTarget;
}

function CommitHeader({ commit, gitUser }: { commit: CommitInfo; gitUser: string | null }) {
  const firstNewline = commit.message.indexOf("\n");
  const subject = firstNewline === -1 ? commit.message : commit.message.slice(0, firstNewline);
  const body = firstNewline === -1 ? "" : commit.message.slice(firstNewline + 1).trim();
  const { copied, copy: handleCopy } = useCopyToClipboard();

  const isYou = gitUser != null && commit.author.toLowerCase() === gitUser.toLowerCase();

  return (
    <div className="px-4 py-3 border-b border-border-default bg-bg-secondary">
      <div className="text-sm font-semibold text-text-primary leading-snug">
        {subject}
      </div>
      {body && (
        <div className="text-xs text-text-secondary mt-1.5 whitespace-pre-wrap leading-relaxed">
          {body}
        </div>
      )}
      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-text-tertiary">
        <button
          onClick={() => handleCopy(commit.hash)}
          className="flex items-center gap-1 font-mono hover:text-text-primary transition-colors group"
          title="Copy full hash"
        >
          <span>{commit.hash}</span>
          {copied
            ? <Check size={10} className="text-diff-added" />
            : <Copy size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
          }
        </button>
        <span>·</span>
        <span className={isYou ? "text-text-tertiary" : "text-accent-primary"}>
          {isYou ? "You" : commit.author}
        </span>
        <span>·</span>
        <span>{formatRelativeTime(commit.timestamp)}</span>
      </div>
    </div>
  );
}

function ChangesView({ worktreeId, repoPath, diffTarget }: ChangesViewProps) {
  const panelTab = useWorkspaceStore((s) => s.changesViewMode[worktreeId]) ?? "changes";
  // Map panel tab to data view mode — "pr" tab doesn't affect data fetching
  const viewMode = panelTab === "commits" ? "commits" : "changes";
  const [selectedCommitIndex, setSelectedCommitIndex] = useState<number | null>(null);
  const { config: appCfg } = useAppConfig();
  const defaultDiffView = appCfg?.defaultDiffViewMode ?? "unified";
  const diffViewMode = useWorkspaceStore((s) => s.diffViewMode[worktreeId]) ?? defaultDiffView;
  const setDiffViewMode = useWorkspaceStore((s) => s.setDiffViewMode);
  const prComments = usePrStore((s) => s.prDetail[worktreeId]?.comments ?? EMPTY_COMMENTS);
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId));
  const pr = worktree?.prStatus ?? null;
  const showPrComments = useWorkspaceStore((s) => s.showPrComments[worktreeId] ?? (pr !== null));
  const setShowPrComments = useWorkspaceStore((s) => s.setShowPrComments);
  const setJumpToComment = usePrStore((s) => s.setJumpToComment);
  const clearJumpToComment = usePrStore((s) => s.clearJumpToComment);

  const { commits, upstreamCommits, displayFiles, uncommittedFiles, committedFiles, refetchUncommitted } = useChangesData(
    repoPath, viewMode, selectedCommitIndex, pr?.baseBranch ?? worktree?.stackParent ?? undefined, pr?.number,
  );

  const gitUser = useGitUser(repoPath);

  // Combined list: branch commits first, then upstream
  const allCommits = useMemo(
    () => [...commits, ...upstreamCommits],
    [commits, upstreamCommits],
  );

  const {
    annotations,
    activeAnnotationLine,
    handleAddAnnotation,
    handleSubmitAnnotation,
    handleDeleteAnnotation,
    handleEditAnnotation,
    clearAnnotations,
    resetActiveAnnotation,
  } = useAnnotationActions(worktreeId, viewMode, selectedCommitIndex, commits);

  const {
    collapsedFiles,
    setCollapsedFiles,
    setActiveFilePath,
    focusedFilePath,
    fileRefs,
    handleToggleExpanded,
    expandAll,
    collapseAll,
    handleSelectFile,
  } = useFileNavigation(displayFiles, viewMode);

  const [expandFullFile, setExpandFullFile] = useState(false);
  const { copied: copiedPath, copy: copyPath } = useCopyToClipboard();

  useEffect(() => {
    setExpandFullFile(false);
    // Clear PR comment highlight when switching files
    setHighlightComment((prev) => {
      if (prev && prev.filePath !== focusedFilePath) return null;
      return prev;
    });
  }, [focusedFilePath]);

  const {
    searchOpen,
    setSearchOpen,
    searchQuery,
    setSearchQuery,
    searchInputRef,
    matches,
    currentMatchIndex,
    navigateMatch,
    activeSearchMatch,
  } = useDiffSearch(displayFiles, setCollapsedFiles, setActiveFilePath);

  const handleSendPrComment = useCallback(
    (comment: PrComment) => {
      sendPrCommentToClaude(worktreeId, repoPath, worktree?.branch, comment);
    },
    [worktreeId, repoPath, worktree?.branch],
  );

  const {
    discardTarget,
    handleDiscardFile,
    handleDiscardAll,
    handleCancelDiscard,
    handleConfirmDiscard,
  } = useDiscardChanges(repoPath, uncommittedFiles, refetchUncommitted);

  // State for highlighting a PR comment line (auto-expands the thread and scrolls)
  const [highlightComment, setHighlightComment] = useState<{ filePath: string; line: number } | null>(null);

  const handleJumpToComment = useCallback(
    (filePath: string, line: number) => {
      handleSelectFile(filePath);
      setHighlightComment({ filePath, line });
    },
    [handleSelectFile],
  );

  useEffect(() => {
    setJumpToComment(worktreeId, handleJumpToComment);
    return () => clearJumpToComment(worktreeId);
  }, [worktreeId, handleJumpToComment, setJumpToComment, clearJumpToComment]);

  const handleSelectCommit = useCallback((index: number) => {
    setSelectedCommitIndex(index);
    resetActiveAnnotation();
  }, [resetActiveAnnotation]);

  // Drive display from diffTarget prop (replaces DOM event listeners)
  useEffect(() => {
    if (!diffTarget) return;
    if (diffTarget.type === "file" && diffTarget.filePath) {
      handleSelectFile(diffTarget.filePath);
      if (diffTarget.scrollToLine) {
        requestAnimationFrame(() => {
          const el = fileRefs.current.get(diffTarget.filePath!);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } else if (diffTarget.type === "commit" && diffTarget.commitHash) {
      const commitIndex = allCommits.findIndex((c) => c.hash === diffTarget.commitHash);
      if (commitIndex !== -1) {
        handleSelectCommit(commitIndex);
      }
      if (diffTarget.scrollToFile) {
        const scrollPath = diffTarget.scrollToFile;
        requestAnimationFrame(() => {
          const el = fileRefs.current.get(scrollPath);
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    }
  }, [diffTarget, handleSelectFile, handleSelectCommit, allCommits, fileRefs]);


  // When a committed file is focused and the same path exists in uncommitted,
  // displayFiles only has the uncommitted version — look in committedFiles instead.
  const focusedFile = focusedFilePath
    ? (diffTarget?.isUncommitted === false
        ? committedFiles.find((f) => f.path === focusedFilePath)
        : null
      ) ?? displayFiles.find((f) => f.path === focusedFilePath)
    : null;
  const filesToRender = focusedFile ? [focusedFile] : displayFiles;

  const activeCommitHash =
    viewMode === "commits" && selectedCommitIndex !== null && allCommits[selectedCommitIndex]
      ? allCommits[selectedCommitIndex].hash
      : undefined;

  return (
    <div className="flex flex-col h-full relative">
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <ChangesToolbar
            focusedFilePath={focusedFilePath}
            displayFiles={displayFiles}
            viewMode={viewMode}
            selectedCommitIndex={selectedCommitIndex}
            diffViewMode={diffViewMode}
            setDiffViewMode={setDiffViewMode}
            worktreeId={worktreeId}
            repoPath={repoPath}
            searchOpen={searchOpen}
            setSearchOpen={setSearchOpen}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchInputRef={searchInputRef}
            matches={matches}
            currentMatchIndex={currentMatchIndex}
            navigateMatch={navigateMatch}
            expandFullFile={expandFullFile}
            setExpandFullFile={setExpandFullFile}
            copiedPath={copiedPath}
            copyPath={copyPath}
            expandAll={expandAll}
            collapseAll={collapseAll}
            pr={pr}
            showPrComments={showPrComments}
            setShowPrComments={setShowPrComments}
            appConfig={appCfg}
          />
          {/* Jump bar for commit diffs with multiple files — outside scroll container so it's always visible */}
          {viewMode === "commits" && selectedCommitIndex !== null && displayFiles.length > 1 && (
            <CommitJumpBar
              displayFiles={displayFiles}
              focusedFilePath={focusedFilePath}
              fileRefs={fileRefs}
            />
          )}
          <div className="flex-1 overflow-y-auto min-w-0">
            {viewMode === "commits" && selectedCommitIndex !== null && allCommits[selectedCommitIndex] && (
              <CommitHeader commit={allCommits[selectedCommitIndex]} gitUser={gitUser} />
            )}
            {/* Uncommitted section header with Discard All */}
            {!focusedFilePath && viewMode === "changes" && uncommittedFiles.length > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border-b border-border-default">
                <span className="text-[10px] font-medium text-text-secondary">
                  Uncommitted ({uncommittedFiles.length})
                </span>
                <div className="ml-auto">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={handleDiscardAll}
                  >
                    <Trash2 size={12} className="mr-1" />
                    Discard All
                  </Button>
                </div>
              </div>
            )}
            {filesToRender.map((file) => {
              const isUncommitted = uncommittedFiles.some((u) => u.path === file.path);
              return (
              <DiffFileCard
                key={file.path}
                ref={(el) => {
                  if (el) {
                    fileRefs.current.set(file.path, el);
                  } else {
                    fileRefs.current.delete(file.path);
                  }
                }}
                file={file}
                expanded={focusedFilePath ? true : !collapsedFiles.has(file.path)}
                autoExpandAll={focusedFilePath ? expandFullFile : undefined}
                onToggleExpanded={handleToggleExpanded}
                viewMode={diffViewMode}
                annotations={annotations}
                activeAnnotationLine={activeAnnotationLine}
                onAddAnnotation={handleAddAnnotation}
                onSubmitAnnotation={handleSubmitAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                onEditAnnotation={handleEditAnnotation}
                prComments={showPrComments ? prComments : []}
                repoPath={repoPath}
                commitHash={activeCommitHash}
                searchQuery={searchQuery}
                activeSearchMatch={
                  activeSearchMatch?.filePath === file.path
                    ? { hunkIndex: activeSearchMatch.hunkIndex, lineIndex: activeSearchMatch.lineIndex }
                    : null
                }
                onDiscardFile={viewMode === "changes" && isUncommitted ? handleDiscardFile : undefined}
                highlightCommentLine={
                  highlightComment?.filePath === file.path ? highlightComment.line : null
                }
                onSendToClaude={handleSendPrComment}
              />
              );
            })}

            {displayFiles.length === 0 && (
              <div className="flex flex-col items-center justify-center flex-1 text-text-tertiary text-sm gap-1">
                {viewMode === "commits" && selectedCommitIndex === null ? (
                  <span>Select a commit to view its changes</span>
                ) : (
                  <span>No changes to display</span>
                )}
              </div>
            )}
          </div>
        </div>

      {/* Discard confirmation dialog */}
      <DiscardDialog
        discardTarget={discardTarget}
        uncommittedCount={uncommittedFiles.length}
        onCancel={handleCancelDiscard}
        onConfirm={handleConfirmDiscard}
      />

      {/* Floating review comment bar */}
      {annotations.length > 0 && (
        <AnnotationBar
          count={annotations.length}
          onClearAll={() => clearAnnotations(worktreeId)}
        />
      )}
    </div>
  );
}

export { ChangesView };
export type { ChangesViewProps };
