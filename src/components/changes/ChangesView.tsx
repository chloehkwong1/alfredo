import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Trash2, MessageSquare } from "lucide-react";
import { FileSidebar } from "./FileSidebar";
import { DiffFileCard } from "./DiffFileCard";
import { getDiff, getUncommittedDiff, getCommits, getDiffForCommit, writePty } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { sessionManager } from "../../services/sessionManager";
import { Button } from "../ui/Button";
import type { DiffFile, CommitInfo } from "../../types";
import type { ViewMode } from "./FileSidebar";

interface ChangesViewProps {
  worktreeId: string;
  repoPath: string;
}

function ChangesView({ worktreeId, repoPath }: ChangesViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [uncommittedFiles, setUncommittedFiles] = useState<DiffFile[]>([]);
  const [committedFiles, setCommittedFiles] = useState<DiffFile[]>([]);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [commitFiles, setCommitFiles] = useState<DiffFile[]>([]);
  const [selectedCommitIndex, setSelectedCommitIndex] = useState<number | null>(null);
  const [activeAnnotationLine, setActiveAnnotationLine] = useState<number | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const annotations = useWorkspaceStore((s) => s.annotations[worktreeId]) ?? [];
  const addAnnotation = useWorkspaceStore((s) => s.addAnnotation);
  const removeAnnotation = useWorkspaceStore((s) => s.removeAnnotation);
  const clearAnnotations = useWorkspaceStore((s) => s.clearAnnotations);
  const diffViewMode = useWorkspaceStore((s) => s.diffViewMode[worktreeId]) ?? "unified";
  const prComments = useWorkspaceStore((s) => s.prDetail[worktreeId]?.comments) ?? [];
  const reviewedFiles = useWorkspaceStore((s) => s.reviewedFiles[worktreeId]) ?? new Set<string>();
  const toggleReviewedFile = useWorkspaceStore((s) => s.toggleReviewedFile);
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId));
  const pr = worktree?.prStatus ?? null;
  const setJumpToComment = useWorkspaceStore((s) => s.setJumpToComment);
  const clearJumpToComment = useWorkspaceStore((s) => s.clearJumpToComment);

  // Load data on mount — each call is independent so one failure doesn't blank everything
  useEffect(() => {
    let cancelled = false;

    getUncommittedDiff(repoPath)
      .then((files) => { if (!cancelled) setUncommittedFiles(files); })
      .catch((err) => console.error("Failed to load uncommitted diff:", err));

    getDiff(repoPath, pr?.baseBranch)
      .then((files) => { if (!cancelled) setCommittedFiles(files); })
      .catch((err) => console.error("Failed to load committed diff:", err));

    getCommits(repoPath, pr?.baseBranch)
      .then((list) => { if (!cancelled) setCommits(list); })
      .catch((err) => console.error("Failed to load commits:", err));

    return () => {
      cancelled = true;
    };
  }, [repoPath, pr?.baseBranch]);

  // Load commit diff when a commit is selected in commits mode
  useEffect(() => {
    if (viewMode !== "commits" || selectedCommitIndex === null || commits.length === 0) {
      setCommitFiles([]);
      return;
    }

    let cancelled = false;
    const commit = commits[selectedCommitIndex];
    if (!commit) return;

    async function loadCommitDiff() {
      try {
        const files = await getDiffForCommit(repoPath, commit.hash);
        if (!cancelled) {
          setCommitFiles(files);
        }
      } catch (err) {
        console.error("Failed to load commit diff:", err);
      }
    }

    loadCommitDiff();
    return () => {
      cancelled = true;
    };
  }, [viewMode, selectedCommitIndex, commits, repoPath]);

  // Computed display files
  const displayFiles =
    viewMode === "commits" && selectedCommitIndex !== null
      ? commitFiles
      : [...uncommittedFiles, ...committedFiles];

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

  const reviewedCount = displayFiles.filter((f) => reviewedFiles.has(f.path)).length;

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

    const tabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];
    const claudeTab = tabs.find((t) => t.type === "claude");
    const targetKey = claudeTab?.id ?? worktreeId;

    const session = sessionManager.getSession(targetKey);
    if (!session) return;

    const lines = annotations.map(
      (a) => `Feedback on ${a.filePath}:${a.lineNumber} — ${a.text}`,
    );
    const message = "\n" + lines.join("\n") + "\n";
    const bytes = Array.from(new TextEncoder().encode(message));
    await writePty(session.sessionId, bytes);
    clearAnnotations(worktreeId);
  }, [worktreeId, annotations, clearAnnotations]);

  return (
    <div className="flex flex-col h-full">
      {/* Annotation status bar */}
      {annotations.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-accent-primary/8 border-b border-accent-primary/20 flex-shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-accent-primary font-medium">
            <MessageSquare size={14} />
            <span>
              {annotations.length}{" "}
              {annotations.length === 1 ? "annotation" : "annotations"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <Button size="sm" variant="primary" onClick={handleSendToClaude}>
              <Send size={12} />
              Send to Claude
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => clearAnnotations(worktreeId)}
            >
              <Trash2 size={12} />
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Three-zone layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left: File sidebar */}
        <FileSidebar
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          uncommittedFiles={uncommittedFiles}
          committedFiles={committedFiles}
          commits={commits}
          selectedCommitIndex={selectedCommitIndex}
          onSelectCommit={handleSelectCommit}
          activeFilePath={activeFilePath}
          collapsedFiles={collapsedFiles}
          onSelectFile={handleSelectFile}
          reviewedFiles={reviewedFiles}
          onToggleReviewed={handleToggleReviewed}
        />

        {/* Center: Diff file cards */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-b border-border-default flex-shrink-0">
            <span className="text-[10px] text-text-tertiary">
              {reviewedCount}/{displayFiles.length} reviewed
            </span>
            <div className="flex items-center gap-1.5 ml-auto">
              <button className="text-[10px] text-text-tertiary hover:text-text-primary" onClick={expandAll}>
                Expand all
              </button>
              <span className="text-text-tertiary/50">|</span>
              <button className="text-[10px] text-text-tertiary hover:text-text-primary" onClick={collapseAll}>
                Collapse all
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto min-w-0">
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
              onToggleExpanded={() => handleToggleExpanded(file.path)}
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
            <div className="flex flex-col items-center justify-center flex-1 text-text-tertiary text-sm">
              No changes to display
            </div>
          )}
          </div>
        </div>

      </div>
    </div>
  );
}

export { ChangesView };
export type { ChangesViewProps };
