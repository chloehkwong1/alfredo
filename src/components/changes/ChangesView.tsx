import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { FileSidebar } from "./FileSidebar";
import { DiffFileCard } from "./DiffFileCard";
import { writePty } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { usePrStore } from "../../stores/prStore";
import { sessionManager } from "../../services/sessionManager";
import { Button } from "../ui/Button";
import { useChangesData } from "../../hooks/useChangesData";
import type { ViewMode } from "./FileSidebar";
import type { CommitInfo } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";

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
  const [viewMode, setViewMode] = useState<ViewMode>("changes");
  const [selectedCommitIndex, setSelectedCommitIndex] = useState<number | null>(null);
  const [activeAnnotationLine, setActiveAnnotationLine] = useState<number | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const fileSidebarLayout = useDefaultLayout({
    id: "changes-file-sidebar",
    storage: localStorage,
  });

  const annotations = useWorkspaceStore((s) => s.annotations[worktreeId]) ?? [];
  const addAnnotation = useWorkspaceStore((s) => s.addAnnotation);
  const removeAnnotation = useWorkspaceStore((s) => s.removeAnnotation);
  const clearAnnotations = useWorkspaceStore((s) => s.clearAnnotations);
  const diffViewMode = useWorkspaceStore((s) => s.diffViewMode[worktreeId]) ?? "unified";
  const setDiffViewMode = useWorkspaceStore((s) => s.setDiffViewMode);
  const prComments = usePrStore((s) => s.prDetail[worktreeId]?.comments) ?? [];
  const reviewedFiles = usePrStore((s) => s.reviewedFiles[worktreeId]) ?? new Set<string>();
  const toggleReviewedFile = usePrStore((s) => s.toggleReviewedFile);
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId));
  const pr = worktree?.prStatus ?? null;
  const setJumpToComment = usePrStore((s) => s.setJumpToComment);
  const clearJumpToComment = usePrStore((s) => s.clearJumpToComment);

  const { uncommittedFiles, committedFiles, commits, displayFiles } = useChangesData(
    repoPath, viewMode, selectedCommitIndex, pr?.baseBranch,
  );

  const reviewedCount = displayFiles.filter((f) => reviewedFiles.has(f.path)).length;

  // Auto-collapse all files when the diff is large to prevent UI freeze
  const AUTO_COLLAPSE_THRESHOLD = 15;
  const hasAutoCollapsed = useRef(false);
  useEffect(() => {
    if (!hasAutoCollapsed.current && displayFiles.length > AUTO_COLLAPSE_THRESHOLD) {
      hasAutoCollapsed.current = true;
      setCollapsedFiles(new Set(displayFiles.map((f) => f.path)));
    }
  }, [displayFiles]);

  // Reset auto-collapse when switching tabs
  useEffect(() => {
    hasAutoCollapsed.current = false;
    setCollapsedFiles(new Set());
  }, [viewMode]);

  const handleToggleExpanded = useCallback((path: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Keyboard shortcuts: ]/n next file, [/p prev file, x toggle collapse
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "]" || e.key === "n") {
        e.preventDefault();
        const idx = displayFiles.findIndex((f) => f.path === activeFilePath);
        const next = idx < displayFiles.length - 1 ? idx + 1 : 0;
        const file = displayFiles[next];
        if (file) {
          setActiveFilePath(file.path);
          setCollapsedFiles((prev) => {
            if (!prev.has(file.path)) return prev;
            const s = new Set(prev);
            s.delete(file.path);
            return s;
          });
          fileRefs.current.get(file.path)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } else if (e.key === "[" || e.key === "p") {
        e.preventDefault();
        const idx = displayFiles.findIndex((f) => f.path === activeFilePath);
        const prev = idx > 0 ? idx - 1 : displayFiles.length - 1;
        const file = displayFiles[prev];
        if (file) {
          setActiveFilePath(file.path);
          setCollapsedFiles((p) => {
            if (!p.has(file.path)) return p;
            const s = new Set(p);
            s.delete(file.path);
            return s;
          });
          fileRefs.current.get(file.path)?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      } else if (e.key === "x" && activeFilePath) {
        e.preventDefault();
        handleToggleExpanded(activeFilePath);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [displayFiles, activeFilePath, handleToggleExpanded]);

  const expandAll = useCallback(() => {
    setCollapsedFiles(new Set());
  }, []);

  const collapseAll = useCallback(() => {
    setCollapsedFiles(new Set(displayFiles.map((f) => f.path)));
  }, [displayFiles]);

  const handleToggleReviewed = useCallback(
    (filePath: string) => {
      toggleReviewedFile(worktreeId, filePath);
    },
    [worktreeId, toggleReviewedFile],
  );

  const handleSelectFile = useCallback((path: string) => {
    setActiveFilePath(path);
    // Uncollapse if collapsed
    setCollapsedFiles((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    // Scroll to file via ref
    const el = fileRefs.current.get(path);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const handleJumpToComment = useCallback(
    (filePath: string, line: number) => {
      handleSelectFile(filePath);
      setTimeout(() => {
        setActiveAnnotationLine(line);
      }, 150);
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

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    setSelectedCommitIndex(null);
    setActiveAnnotationLine(null);
    setActiveFilePath(null);
  }, []);

  const handleAddAnnotation = useCallback(
    (filePath: string, lineNumber: number) => {
      void filePath;
      setActiveAnnotationLine((prev) => (prev === lineNumber ? null : lineNumber));
    },
    [],
  );

  const handleSubmitAnnotation = useCallback(
    (filePath: string, lineNumber: number, text: string) => {
      const commitHash =
        viewMode === "commits" && selectedCommitIndex !== null && commits.length > 0
          ? commits[selectedCommitIndex].hash
          : null;
      addAnnotation({
        id: crypto.randomUUID(),
        worktreeId,
        filePath,
        lineNumber,
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

  const handleSendToClaude = useCallback(async () => {
    if (annotations.length === 0) return;

    const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
    const claudeTab = tabs.find((t) => t.type === "claude");
    const targetKey = claudeTab?.id ?? worktreeId;

    const session = sessionManager.getSession(targetKey);
    if (!session) return;

    // Group annotations by file
    const byFile = new Map<string, typeof annotations>();
    for (const a of annotations) {
      const list = byFile.get(a.filePath) ?? [];
      list.push(a);
      byFile.set(a.filePath, list);
    }

    // Format as markdown grouped by file
    let message = "\nCode review comments:\n";
    for (const [filePath, fileAnnotations] of byFile) {
      message += `\n## ${filePath}\n\n`;
      const sorted = [...fileAnnotations].sort((a, b) => a.lineNumber - b.lineNumber);
      for (const a of sorted) {
        message += `Line ${a.lineNumber}: ${a.text}\n\n`;
      }
    }

    const bytes = Array.from(new TextEncoder().encode(message));
    await writePty(session.sessionId, bytes);
    clearAnnotations(worktreeId);
  }, [worktreeId, annotations, clearAnnotations]);

  return (
    <div className="flex flex-col h-full relative">
      {/* Three-zone layout */}
      <Group
        orientation="horizontal"
        defaultLayout={fileSidebarLayout.defaultLayout}
        onLayoutChanged={fileSidebarLayout.onLayoutChanged}
        className="flex-1 min-h-0"
      >
        {/* Left: File sidebar */}
        <Panel defaultSize="200px" minSize="120px" maxSize="350px">
          <FileSidebar
            viewMode={viewMode}
            onViewModeChange={handleViewModeChange}
            uncommittedFiles={uncommittedFiles}
            committedFiles={committedFiles}
            hasPr={pr !== null}
            commits={commits}
            selectedCommitIndex={selectedCommitIndex}
            onSelectCommit={handleSelectCommit}
            activeFilePath={activeFilePath}
            collapsedFiles={collapsedFiles}
            onSelectFile={handleSelectFile}
            reviewedFiles={reviewedFiles}
            onToggleReviewed={handleToggleReviewed}
          />
        </Panel>

        <Separator className="w-px bg-border-subtle hover:bg-accent-primary transition-colors data-[resize-handle-active]:bg-accent-primary cursor-col-resize" />

        {/* Center: Diff file cards */}
        <Panel minSize="40%">
        <div className="flex-1 flex flex-col min-w-0 h-full">
          <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-b border-border-default flex-shrink-0">
            <span className="text-[10px] text-text-tertiary">
              {viewMode === "changes"
                ? `${reviewedCount}/${displayFiles.length} files`
                : selectedCommitIndex !== null
                  ? `${displayFiles.length} file${displayFiles.length !== 1 ? "s" : ""} in commit`
                  : "Select a commit"}
            </span>
            {displayFiles.length > 0 && (
              <div className="flex items-center gap-1.5 ml-auto">
                <button className="text-[10px] text-text-tertiary hover:text-text-primary" onClick={expandAll}>
                  Expand all
                </button>
                <span className="text-text-tertiary/50">|</span>
                <button className="text-[10px] text-text-tertiary hover:text-text-primary" onClick={collapseAll}>
                  Collapse all
                </button>
                <span className="text-text-tertiary/50 mx-1">|</span>
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
          </div>
          <div className="flex-1 overflow-y-auto min-w-0">
            {viewMode === "commits" && selectedCommitIndex !== null && commits[selectedCommitIndex] && (
              <CommitHeader commit={commits[selectedCommitIndex]} />
            )}
            {displayFiles.map((file) => (
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
              expanded={!collapsedFiles.has(file.path)}
              onToggleExpanded={handleToggleExpanded}
              viewMode={diffViewMode}
              annotations={annotations}
              activeAnnotationLine={activeAnnotationLine}
              onAddAnnotation={handleAddAnnotation}
              onSubmitAnnotation={handleSubmitAnnotation}
              onDeleteAnnotation={handleDeleteAnnotation}
              prComments={prComments}
            />
            ))}

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
        </Panel>

      </Group>

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
