import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Panel, Separator, useDefaultLayout } from "react-resizable-panels";
import { FileSidebar } from "./FileSidebar";
import { DiffFileCard } from "./DiffFileCard";
import { writePty, getConfig } from "../../api";
import { resolveSettings, buildClaudeArgs } from "../../services/claudeSettingsResolver";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTabStore } from "../../stores/tabStore";
import { usePrStore } from "../../stores/prStore";
import { sessionManager } from "../../services/sessionManager";
import { Button } from "../ui/Button";
import { useChangesData } from "../../hooks/useChangesData";
import { Search, ChevronUp, ChevronDown, X } from "lucide-react";
import type { ViewMode } from "./FileSidebar";
import type { CommitInfo } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";
import { useAppConfig } from "../../hooks/useAppConfig";

interface SearchMatch {
  filePath: string;
  hunkIndex: number;
  lineIndex: number;
}

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
  const viewMode = useWorkspaceStore((s) => s.changesViewMode[worktreeId]) ?? "changes";
  const setChangesViewMode = useWorkspaceStore((s) => s.setChangesViewMode);
  const [selectedCommitIndex, setSelectedCommitIndex] = useState<number | null>(null);
  const [activeAnnotationLine, setActiveAnnotationLine] = useState<{ filePath: string; lineNumber: number } | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const fileSidebarLayout = useDefaultLayout({
    id: "changes-file-sidebar",
    storage: localStorage,
  });

  const annotations = useWorkspaceStore((s) => s.annotations[worktreeId]) ?? [];
  const addAnnotation = useWorkspaceStore((s) => s.addAnnotation);
  const removeAnnotation = useWorkspaceStore((s) => s.removeAnnotation);
  const clearAnnotations = useWorkspaceStore((s) => s.clearAnnotations);
  const { config: appCfg } = useAppConfig();
  const defaultDiffView = appCfg?.defaultDiffViewMode ?? "unified";
  const diffViewMode = useWorkspaceStore((s) => s.diffViewMode[worktreeId]) ?? defaultDiffView;
  const setDiffViewMode = useWorkspaceStore((s) => s.setDiffViewMode);
  const prComments = usePrStore((s) => s.prDetail[worktreeId]?.comments) ?? [];
  const reviewedFiles = usePrStore((s) => s.reviewedFiles[worktreeId]) ?? new Set<string>();
  const toggleReviewedFile = usePrStore((s) => s.toggleReviewedFile);
  const worktree = useWorkspaceStore((s) => s.worktrees.find((w) => w.id === worktreeId));
  const pr = worktree?.prStatus ?? null;
  const setJumpToComment = usePrStore((s) => s.setJumpToComment);
  const clearJumpToComment = usePrStore((s) => s.clearJumpToComment);

  const { uncommittedFiles, committedFiles, commits, displayFiles } = useChangesData(
    repoPath, viewMode, selectedCommitIndex, pr?.baseBranch, pr?.number,
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

  // ── Search within diffs ──────────────────────────────
  const matches = useMemo(() => {
    if (!searchQuery) return [];
    const result: SearchMatch[] = [];
    const lq = searchQuery.toLowerCase();
    for (const file of displayFiles) {
      for (let hi = 0; hi < file.hunks.length; hi++) {
        for (let li = 0; li < file.hunks[hi].lines.length; li++) {
          if (file.hunks[hi].lines[li].content.toLowerCase().includes(lq)) {
            result.push({ filePath: file.path, hunkIndex: hi, lineIndex: li });
          }
        }
      }
    }
    return result;
  }, [displayFiles, searchQuery]);

  // Reset match index when query or matches change
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery]);

  const navigateMatch = useCallback(
    (direction: "next" | "prev") => {
      if (matches.length === 0) return;
      const newIndex =
        direction === "next"
          ? (currentMatchIndex + 1) % matches.length
          : (currentMatchIndex - 1 + matches.length) % matches.length;
      setCurrentMatchIndex(newIndex);

      const match = matches[newIndex];
      // Expand the file if collapsed
      setCollapsedFiles((prev) => {
        if (!prev.has(match.filePath)) return prev;
        const next = new Set(prev);
        next.delete(match.filePath);
        return next;
      });
      setActiveFilePath(match.filePath);

      // Scroll to the active match after render
      requestAnimationFrame(() => {
        const el = document.getElementById("active-search-match");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    },
    [matches, currentMatchIndex],
  );

  // Keyboard: "/" to open search, Escape to close, Enter/Shift+Enter to navigate
  useEffect(() => {
    function handleSearchKeys(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA";

      // "/" to open search (when not in an input)
      if (e.key === "/" && !isInput) {
        e.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
        return;
      }

      // Escape to close search
      if (e.key === "Escape" && searchOpen) {
        setSearchOpen(false);
        setSearchQuery("");
        return;
      }

      // Enter / Shift+Enter to navigate matches (when search input is focused)
      if (
        e.key === "Enter" &&
        document.activeElement === searchInputRef.current
      ) {
        e.preventDefault();
        navigateMatch(e.shiftKey ? "prev" : "next");
      }
    }

    window.addEventListener("keydown", handleSearchKeys);
    return () => window.removeEventListener("keydown", handleSearchKeys);
  }, [searchOpen, navigateMatch]);

  // Compute active search match for the current file (for highlighting the active line)
  const activeSearchMatch = useMemo(() => {
    if (matches.length === 0) return null;
    return matches[currentMatchIndex] ?? null;
  }, [matches, currentMatchIndex]);

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
        setActiveAnnotationLine({ filePath, lineNumber: line });
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
    setChangesViewMode(worktreeId, mode);
    setSelectedCommitIndex(null);
    setActiveAnnotationLine(null);
    setActiveFilePath(null);
  }, [setChangesViewMode, worktreeId]);

  const handleAddAnnotation = useCallback(
    (filePath: string, lineNumber: number) => {
      setActiveAnnotationLine((prev) =>
        prev?.filePath === filePath && prev?.lineNumber === lineNumber ? null : { filePath, lineNumber }
      );
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

    // Auto-spawn session if it doesn't exist yet
    let session = sessionManager.getSession(targetKey);
    if (!session) {
      try {
        const config = await getConfig(repoPath);
        const branch = worktree?.branch ?? "";
        const resolved = resolveSettings(
          config.claudeDefaults,
          config.worktreeOverrides?.[branch],
        );
        const args = buildClaudeArgs(resolved);
        session = await sessionManager.getOrSpawn(
          targetKey, worktreeId, repoPath, "claude", undefined, args,
        );
      } catch {
        return;
      }
    }

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
  }, [worktreeId, repoPath, worktree?.branch, annotations, clearAnnotations]);

  const activeCommitHash =
    viewMode === "commits" && selectedCommitIndex !== null && commits[selectedCommitIndex]
      ? commits[selectedCommitIndex].hash
      : undefined;

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
                {/* Search within diffs */}
                {searchOpen ? (
                  <div className="flex items-center gap-1 border border-border-default rounded bg-bg-primary px-1.5 py-0.5">
                    <Search size={11} className="text-text-tertiary flex-shrink-0" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search in diffs..."
                      className="w-32 text-[10px] bg-transparent text-text-primary placeholder:text-text-tertiary focus:outline-none"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      autoFocus
                    />
                    {searchQuery && (
                      <span className="text-[9px] text-text-tertiary whitespace-nowrap">
                        {matches.length > 0
                          ? `${currentMatchIndex + 1}/${matches.length}`
                          : "0 results"}
                      </span>
                    )}
                    <button
                      className="text-text-tertiary hover:text-text-primary disabled:opacity-30"
                      onClick={() => navigateMatch("prev")}
                      disabled={matches.length === 0}
                    >
                      <ChevronUp size={12} />
                    </button>
                    <button
                      className="text-text-tertiary hover:text-text-primary disabled:opacity-30"
                      onClick={() => navigateMatch("next")}
                      disabled={matches.length === 0}
                    >
                      <ChevronDown size={12} />
                    </button>
                    <button
                      className="text-text-tertiary hover:text-text-primary"
                      onClick={() => { setSearchOpen(false); setSearchQuery(""); }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ) : (
                  <button
                    className="text-text-tertiary hover:text-text-primary"
                    onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }}
                    title="Search in diffs (/)"
                  >
                    <Search size={12} />
                  </button>
                )}
                <span className="text-text-tertiary/50">|</span>
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
              repoPath={repoPath}
              commitHash={activeCommitHash}
              searchQuery={searchQuery}
              activeSearchMatch={
                activeSearchMatch?.filePath === file.path
                  ? { hunkIndex: activeSearchMatch.hunkIndex, lineIndex: activeSearchMatch.lineIndex }
                  : null
              }
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
