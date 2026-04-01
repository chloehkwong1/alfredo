import { useCallback, useEffect, useState } from "react";
import { DiffFileCard } from "./DiffFileCard";
import { discardFile, discardAllUncommitted } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePrStore } from "../../stores/prStore";
import { Button } from "../ui/Button";
import { useChangesData } from "../../hooks/useChangesData";
import { useFileNavigation } from "../../hooks/useFileNavigation";
import { useDiffSearch } from "../../hooks/useDiffSearch";
import { useSendToClaude } from "../../hooks/useSendToClaude";
import { sendPrCommentToClaude } from "../../services/sendPrCommentToClaude";
import { Search, ChevronLeft, ChevronRight, Trash2, ArrowLeft, Maximize2, Minimize2, MessageSquare } from "lucide-react";
import { IconButton } from "../ui/IconButton";
import { DiffSearchBar } from "./DiffSearchBar";
import type { CommitInfo, PrComment } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";
import { useAppConfig } from "../../hooks/useAppConfig";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "../ui/Dialog";

interface ChangesViewProps {
  worktreeId: string;
  repoPath: string;
}

function CommitHeader({ commit }: { commit: CommitInfo }) {
  const firstNewline = commit.message.indexOf("\n");
  const subject = firstNewline === -1 ? commit.message : commit.message.slice(0, firstNewline);
  const body = firstNewline === -1 ? "" : commit.message.slice(firstNewline + 1).trim();

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
        <span className="font-mono">{commit.shortHash}</span>
        <span>·</span>
        <span>{formatRelativeTime(commit.timestamp)}</span>
      </div>
    </div>
  );
}

function ChangesView({ worktreeId, repoPath }: ChangesViewProps) {
  const panelTab = useWorkspaceStore((s) => s.changesViewMode[worktreeId]) ?? "changes";
  // Map panel tab to data view mode — "pr" tab doesn't affect data fetching
  const viewMode = panelTab === "commits" ? "commits" : "changes";
  const [selectedCommitIndex, setSelectedCommitIndex] = useState<number | null>(null);
  const [activeAnnotationLine, setActiveAnnotationLine] = useState<{ filePath: string; lineNumber: number; side: import("../../types").DiffSide } | null>(null);

  const annotations = useWorkspaceStore((s) => s.annotations[worktreeId]) ?? [];
  const addAnnotation = useWorkspaceStore((s) => s.addAnnotation);
  const removeAnnotation = useWorkspaceStore((s) => s.removeAnnotation);
  const editAnnotation = useWorkspaceStore((s) => s.editAnnotation);
  const clearAnnotations = useWorkspaceStore((s) => s.clearAnnotations);
  const { config: appCfg } = useAppConfig();
  const defaultDiffView = appCfg?.defaultDiffViewMode ?? "unified";
  const diffViewMode = useWorkspaceStore((s) => s.diffViewMode[worktreeId]) ?? defaultDiffView;
  const setDiffViewMode = useWorkspaceStore((s) => s.setDiffViewMode);
  const prComments = usePrStore((s) => s.prDetail[worktreeId]?.comments) ?? [];
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId));
  const pr = worktree?.prStatus ?? null;
  const showPrComments = useWorkspaceStore((s) => s.showPrComments[worktreeId] ?? (pr !== null));
  const setShowPrComments = useWorkspaceStore((s) => s.setShowPrComments);
  const setJumpToComment = usePrStore((s) => s.setJumpToComment);
  const clearJumpToComment = usePrStore((s) => s.clearJumpToComment);

  const { commits, displayFiles, uncommittedFiles, refetchUncommitted } = useChangesData(
    repoPath, viewMode, selectedCommitIndex, pr?.baseBranch, pr?.number,
  );

  const {
    collapsedFiles,
    setCollapsedFiles,
    setActiveFilePath,
    focusedFilePath,
    clearFocusedFile,
    fileRefs,
    handleToggleExpanded,
    expandAll,
    collapseAll,
    handleSelectFile,
  } = useFileNavigation(displayFiles, viewMode);

  const [expandFullFile, setExpandFullFile] = useState(false);

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

  const { handleSendToClaude } = useSendToClaude(worktreeId, repoPath, worktree?.branch);

  const handleSendPrComment = useCallback(
    (comment: PrComment) => {
      sendPrCommentToClaude(worktreeId, repoPath, worktree?.branch, comment);
    },
    [worktreeId, repoPath, worktree?.branch],
  );

  // ── Discard state ──────────────────────────────────────────
  const [discardTarget, setDiscardTarget] = useState<
    null | { type: "file"; path: string; status: string } | { type: "all" }
  >(null);

  const handleDiscardFile = useCallback((path: string, status: string) => {
    setDiscardTarget({ type: "file", path, status });
  }, []);

  const handleDiscardAll = useCallback(() => {
    setDiscardTarget({ type: "all" });
  }, []);

  const handleCancelDiscard = useCallback(() => {
    setDiscardTarget(null);
  }, []);

  const handleConfirmDiscard = useCallback(async () => {
    if (!discardTarget) return;
    try {
      if (discardTarget.type === "file") {
        await discardFile(repoPath, discardTarget.path, discardTarget.status);
      } else {
        const files = uncommittedFiles.map((f) => ({
          path: f.path,
          oldPath: f.oldPath,
          status: f.status,
        }));
        await discardAllUncommitted(repoPath, files);
      }
      refetchUncommitted();
    } catch (err) {
      console.error("Discard failed:", err);
    } finally {
      setDiscardTarget(null);
    }
  }, [discardTarget, repoPath, uncommittedFiles, refetchUncommitted]);

  // Listen for file selection from the persistent ChangesPanel
  useEffect(() => {
    function handlePanelSelectFile(e: Event) {
      const path = (e as CustomEvent).detail?.path;
      if (typeof path === "string") {
        handleSelectFile(path);
      }
    }
    window.addEventListener("alfredo:changes-panel-select-file", handlePanelSelectFile);
    return () => window.removeEventListener("alfredo:changes-panel-select-file", handlePanelSelectFile);
  }, [handleSelectFile]);

  // Listen for clear-focus from the persistent ChangesPanel
  useEffect(() => {
    function handleClearFocus() { clearFocusedFile(); }
    window.addEventListener("alfredo:changes-panel-clear-focus", handleClearFocus);
    return () => window.removeEventListener("alfredo:changes-panel-clear-focus", handleClearFocus);
  }, [clearFocusedFile]);

  // State for highlighting a PR comment line (auto-expands the thread and scrolls)
  const [highlightComment, setHighlightComment] = useState<{ filePath: string; line: number } | null>(null);

  // Listen for jump-to-comment from the persistent ChangesPanel
  useEffect(() => {
    function handlePanelJumpToComment(e: Event) {
      const { path, line } = (e as CustomEvent).detail ?? {};
      if (typeof path === "string" && typeof line === "number") {
        handleSelectFile(path);
        setHighlightComment({ filePath: path, line });
      }
    }
    window.addEventListener("alfredo:changes-panel-jump-to-comment", handlePanelJumpToComment);
    return () => window.removeEventListener("alfredo:changes-panel-jump-to-comment", handlePanelJumpToComment);
  }, [handleSelectFile]);

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
    setActiveAnnotationLine(null);
  }, []);

  // Listen for commit selection from the persistent ChangesPanel
  useEffect(() => {
    function handlePanelSelectCommit(e: Event) {
      const index = (e as CustomEvent).detail?.index;
      if (typeof index === "number") {
        handleSelectCommit(index);
      }
    }
    window.addEventListener("alfredo:changes-panel-select-commit", handlePanelSelectCommit);
    return () => window.removeEventListener("alfredo:changes-panel-select-commit", handlePanelSelectCommit);
  }, [handleSelectCommit]);

  const handleAddAnnotation = useCallback(
    (filePath: string, lineNumber: number, side: import("../../types").DiffSide) => {
      setActiveAnnotationLine((prev) =>
        prev?.filePath === filePath && prev?.lineNumber === lineNumber && prev?.side === side ? null : { filePath, lineNumber, side }
      );
    },
    [],
  );

  const handleSubmitAnnotation = useCallback(
    (filePath: string, lineNumber: number, side: import("../../types").DiffSide, text: string) => {
      const commitHash =
        viewMode === "commits" && selectedCommitIndex !== null && commits.length > 0
          ? commits[selectedCommitIndex].hash
          : null;
      addAnnotation({
        id: crypto.randomUUID(),
        worktreeId,
        filePath,
        lineNumber,
        side,
        commitHash,
        text,
        createdAt: Date.now(),
      });
      setActiveAnnotationLine(null);
    },
    [worktreeId, viewMode, selectedCommitIndex, commits, addAnnotation],
  );

  const handleDeleteAnnotation = useCallback(
    (annotationId: string) => {
      removeAnnotation(worktreeId, annotationId);
    },
    [worktreeId, removeAnnotation],
  );

  const handleEditAnnotation = useCallback(
    (annotationId: string, newText: string) => {
      editAnnotation(worktreeId, annotationId, newText);
    },
    [worktreeId, editAnnotation],
  );

  const focusedFileIndex = focusedFilePath ? displayFiles.findIndex((f) => f.path === focusedFilePath) : -1;

  const goToNextFile = useCallback(() => {
    if (focusedFileIndex === -1) return;
    const next = focusedFileIndex < displayFiles.length - 1 ? focusedFileIndex + 1 : 0;
    const file = displayFiles[next];
    if (file) handleSelectFile(file.path);
  }, [focusedFileIndex, displayFiles, handleSelectFile]);

  const goToPrevFile = useCallback(() => {
    if (focusedFileIndex === -1) return;
    const prev = focusedFileIndex > 0 ? focusedFileIndex - 1 : displayFiles.length - 1;
    const file = displayFiles[prev];
    if (file) handleSelectFile(file.path);
  }, [focusedFileIndex, displayFiles, handleSelectFile]);

  const focusedFile = focusedFilePath ? displayFiles.find((f) => f.path === focusedFilePath) : null;
  const filesToRender = focusedFile ? [focusedFile] : displayFiles;

  const activeCommitHash =
    viewMode === "commits" && selectedCommitIndex !== null && commits[selectedCommitIndex]
      ? commits[selectedCommitIndex].hash
      : undefined;

  return (
    <div className="flex flex-col h-full relative">
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-b border-border-default flex-shrink-0">
            {focusedFilePath ? (
              <>
                {/* Focused file toolbar - left side */}
                <IconButton
                  size="sm"
                  label="Back to all files (Esc)"
                  className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary flex-shrink-0"
                  onClick={clearFocusedFile}
                >
                  <ArrowLeft size={14} />
                </IconButton>
                <span className="text-[11px] font-mono text-text-primary truncate">
                  {focusedFilePath.split("/").pop()}
                </span>
                <span className="text-[10px] text-text-tertiary truncate hidden sm:inline">
                  {focusedFilePath.split("/").slice(0, -1).join("/")}
                </span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <IconButton
                    size="sm"
                    label="Previous file"
                    className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary"
                    onClick={goToPrevFile}
                    disabled={displayFiles.length <= 1}
                  >
                    <ChevronLeft size={14} />
                  </IconButton>
                  <span className="text-[10px] text-text-tertiary tabular-nums">
                    {focusedFileIndex + 1}/{displayFiles.length}
                  </span>
                  <IconButton
                    size="sm"
                    label="Next file"
                    className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary"
                    onClick={goToNextFile}
                    disabled={displayFiles.length <= 1}
                  >
                    <ChevronRight size={14} />
                  </IconButton>
                </div>
                {/* Focused file toolbar - right side */}
                <div className="flex items-center gap-1.5 ml-auto">
                  <IconButton
                    size="sm"
                    label={expandFullFile ? "Show diffs only" : "Expand full file"}
                    className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary"
                    onClick={() => setExpandFullFile((v) => !v)}
                  >
                    {expandFullFile ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                  </IconButton>
                  <span className="text-text-tertiary/50">|</span>
                  {searchOpen ? (
                    <DiffSearchBar
                      isOpen={searchOpen}
                      onClose={() => { setSearchOpen(false); setSearchQuery(""); }}
                      searchTerm={searchQuery}
                      onSearchChange={setSearchQuery}
                      matchCount={matches.length}
                      activeMatch={currentMatchIndex}
                      onPrev={() => navigateMatch("prev")}
                      onNext={() => navigateMatch("next")}
                      inputRef={searchInputRef}
                    />
                  ) : (
                    <IconButton
                      size="sm"
                      label="Search in diffs (/)"
                      className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary"
                      onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }}
                    >
                      <Search size={12} />
                    </IconButton>
                  )}
                  <span className="text-text-tertiary/50">|</span>
                  {pr && (
                    <>
                      <IconButton
                        size="sm"
                        label={showPrComments ? "Hide PR comments" : "Show PR comments"}
                        className={`h-auto w-auto p-0 ${
                          showPrComments ? "text-[var(--color-pr-comment)]" : "text-text-tertiary hover:text-text-primary"
                        }`}
                        onClick={() => setShowPrComments(worktreeId, !showPrComments)}
                      >
                        <MessageSquare size={12} />
                      </IconButton>
                      <span className="text-text-tertiary/50">|</span>
                    </>
                  )}
                  <div className="flex border border-border-default rounded overflow-hidden">
                    <button
                      className={`px-2 py-0.5 text-[10px] transition-colors ${
                        diffViewMode === "unified"
                          ? "bg-accent-primary/15 text-accent-primary font-medium"
                          : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
                      }`}
                      onClick={() => setDiffViewMode(worktreeId, "unified")}
                    >
                      Unified
                    </button>
                    <button
                      className={`px-2 py-0.5 text-[10px] border-l border-border-default transition-colors ${
                        diffViewMode === "split"
                          ? "bg-accent-primary/15 text-accent-primary font-medium"
                          : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
                      }`}
                      onClick={() => setDiffViewMode(worktreeId, "split")}
                    >
                      Split
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <span className="text-[10px] text-text-tertiary">
                  {viewMode === "changes"
                    ? `${displayFiles.length} file${displayFiles.length !== 1 ? "s" : ""}`
                    : selectedCommitIndex !== null
                      ? `${displayFiles.length} file${displayFiles.length !== 1 ? "s" : ""} in commit`
                      : "Select a commit"}
                </span>
                {displayFiles.length > 0 && (
                  <div className="flex items-center gap-1.5 ml-auto">
                    {/* Search within diffs */}
                    {searchOpen ? (
                      <DiffSearchBar
                        isOpen={searchOpen}
                        onClose={() => { setSearchOpen(false); setSearchQuery(""); }}
                        searchTerm={searchQuery}
                        onSearchChange={setSearchQuery}
                        matchCount={matches.length}
                        activeMatch={currentMatchIndex}
                        onPrev={() => navigateMatch("prev")}
                        onNext={() => navigateMatch("next")}
                        inputRef={searchInputRef}
                      />
                    ) : (
                      <IconButton
                        size="sm"
                        label="Search in diffs (/)"
                        className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary"
                        onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }}
                      >
                        <Search size={12} />
                      </IconButton>
                    )}
                    <span className="text-text-tertiary/50">|</span>
                    <Button size="sm" variant="ghost" className="h-auto px-0 text-[10px] text-text-tertiary hover:text-text-primary" onClick={expandAll}>
                      Expand all
                    </Button>
                    <span className="text-text-tertiary/50">|</span>
                    <Button size="sm" variant="ghost" className="h-auto px-0 text-[10px] text-text-tertiary hover:text-text-primary" onClick={collapseAll}>
                      Collapse all
                    </Button>
                    <span className="text-text-tertiary/50 mx-1">|</span>
                    {pr && (
                      <>
                        <IconButton
                          size="sm"
                          label={showPrComments ? "Hide PR comments" : "Show PR comments"}
                          className={`h-auto w-auto p-0 ${
                            showPrComments ? "text-[var(--color-pr-comment)]" : "text-text-tertiary hover:text-text-primary"
                          }`}
                          onClick={() => setShowPrComments(worktreeId, !showPrComments)}
                        >
                          <MessageSquare size={12} />
                        </IconButton>
                        <span className="text-text-tertiary/50">|</span>
                      </>
                    )}
                    <div className="flex border border-border-default rounded overflow-hidden">
                      <button
                        className={`px-2 py-0.5 text-[10px] transition-colors ${
                          diffViewMode === "unified"
                            ? "bg-accent-primary/15 text-accent-primary font-medium"
                            : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
                        }`}
                        onClick={() => setDiffViewMode(worktreeId, "unified")}
                      >
                        Unified
                      </button>
                      <button
                        className={`px-2 py-0.5 text-[10px] border-l border-border-default transition-colors ${
                          diffViewMode === "split"
                            ? "bg-accent-primary/15 text-accent-primary font-medium"
                            : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
                        }`}
                        onClick={() => setDiffViewMode(worktreeId, "split")}
                      >
                        Split
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="flex-1 overflow-y-auto min-w-0">
            {viewMode === "commits" && selectedCommitIndex !== null && commits[selectedCommitIndex] && (
              <CommitHeader commit={commits[selectedCommitIndex]} />
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
      <Dialog open={discardTarget !== null} onOpenChange={(open) => { if (!open) handleCancelDiscard(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {discardTarget?.type === "all" ? "Discard all changes?" : "Discard changes?"}
            </DialogTitle>
            <DialogDescription>
              {discardTarget?.type === "all"
                ? `This will revert ${uncommittedFiles.length} file${uncommittedFiles.length !== 1 ? "s" : ""} to their last committed state. This action cannot be undone.`
                : discardTarget?.type === "file" && discardTarget.status === "added"
                  ? `This will delete "${discardTarget.path}". This action cannot be undone.`
                  : `This will revert all changes to "${discardTarget?.type === "file" ? discardTarget.path : ""}". This action cannot be undone.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={handleCancelDiscard}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleConfirmDiscard}>
              {discardTarget?.type === "all" ? "Discard All" : "Discard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Floating review comment bar */}
      {annotations.length > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 bg-bg-primary border border-accent-primary/30 rounded-lg shadow-lg">
          <div className="flex items-center gap-2">
            <span className="bg-accent-primary text-text-on-accent text-[11px] font-bold px-2 py-0.5 rounded-full">
              {annotations.length}
            </span>
            <span className="text-xs text-text-secondary">
              review comment{annotations.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => clearAnnotations(worktreeId)}>
              Clear all
            </Button>
            <Button size="sm" variant="primary" onClick={handleSendToClaude}>
              Send to agent ⏎
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export { ChangesView };
export type { ChangesViewProps };
