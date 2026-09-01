import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiffFileHeader } from "./DiffFileHeader";
import { useContextExpansion } from "./useContextExpansion";
import { useThemeMode } from "../../hooks/useThemeMode";
import { UnifiedDiffBody } from "./UnifiedDiffBody";
import { SplitDiffBody } from "./SplitDiffBody";
import { MonacoDiffBody } from "./MonacoDiffBody";
import { MarkdownView } from "./MarkdownView";
import { AnnotationInput } from "./AnnotationInput";
import { groupPrCommentsByLine } from "./prCommentLookup";
import { useFileViewModeStore } from "../../stores/fileViewModeStore";
import type {
  DiffFile,
  DiffViewMode,
  FileViewMode,
  Annotation,
  PrComment,
} from "../../types";

function isMonacoFlagOn(): boolean {
  return typeof window !== "undefined"
    && window.localStorage.getItem("alfredo:monaco") === "1";
}

// Experiment flag: set `alfredo:no-sticky-diff` to "1" to drop sticky positioning
// while debugging WebKit compositing-layer corruption in the diff view.
function isStickyDisabled(): boolean {
  return typeof window !== "undefined"
    && window.localStorage.getItem("alfredo:no-sticky-diff") === "1";
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

interface DiffFileCardProps {
  file: DiffFile;
  expanded: boolean;
  onToggleExpanded: (path: string) => void;
  viewMode: DiffViewMode;
  annotations: Annotation[];
  activeAnnotationLine: { filePath: string; lineNumber: number; side: import("../../types").DiffSide } | null;
  onAddAnnotation: (filePath: string, lineNumber: number, side: import("../../types").DiffSide) => void;
  onSubmitAnnotation: (
    filePath: string,
    lineNumber: number,
    side: import("../../types").DiffSide,
    text: string
  ) => void;
  onSubmitReviewComment?: (
    filePath: string,
    lineNumber: number,
    side: import("../../types").DiffSide,
    text: string
  ) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onEditAnnotation: (annotationId: string, newText: string) => void;
  prComments: PrComment[];
  repoPath: string;
  commitHash?: string;
  searchQuery?: string;
  activeSearchMatch?: { hunkIndex: number; lineIndex: number } | null;
  onDiscardFile?: (path: string, status: string) => void;
  autoExpandAll?: boolean;
  /** When set, auto-expand the PR comment thread on this line and scroll to it. */
  highlightCommentLine?: number | null;
  onSendToClaude?: (comment: PrComment) => void;
}


/**
 * Wraps the legacy Unified/Split renderers and owns the useContextExpansion
 * hook so its line-fetch state machine never runs in the Monaco code path.
 */
interface LegacyDiffBodyProps {
  file: DiffFile;
  viewMode: DiffViewMode;
  repoPath: string;
  commitHash?: string;
  autoExpandAll?: boolean;
  annotationsByLine: Map<string, Annotation[]>;
  prCommentsByLine: Map<string, PrComment[]>;
  expandedCommentLines: Set<number>;
  toggleCommentLine: (lineNumber: number) => void;
  highlightCommentLine?: number | null;
  highlightLineRef: React.MutableRefObject<HTMLDivElement | null>;
  searchQuery?: string;
  activeSearchMatch?: { hunkIndex: number; lineIndex: number } | null;
  syncSplitScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  onAddAnnotation: (filePath: string, lineNumber: number, side: import("../../types").DiffSide) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  onEditAnnotation: (annotationId: string, newText: string) => void;
  onSendToClaude?: (comment: PrComment) => void;
}

function LegacyDiffBody({
  file,
  viewMode,
  repoPath,
  commitHash,
  autoExpandAll,
  annotationsByLine,
  prCommentsByLine,
  expandedCommentLines,
  toggleCommentLine,
  highlightCommentLine,
  highlightLineRef,
  searchQuery,
  activeSearchMatch,
  syncSplitScroll,
  onAddAnnotation,
  onDeleteAnnotation,
  onEditAnnotation,
  onSendToClaude,
}: LegacyDiffBodyProps) {
  const { gapInfo, expandedGaps, loadingGaps, handleExpandContext } = useContextExpansion(
    file, repoPath, commitHash, autoExpandAll,
  );
  const themeMode = useThemeMode();

  if (viewMode !== "side-by-side") {
    return (
      <UnifiedDiffBody
        key={themeMode}
        file={file}
        gapInfo={gapInfo}
        expandedGaps={expandedGaps}
        loadingGaps={loadingGaps}
        handleExpandContext={handleExpandContext}
        annotationsByLine={annotationsByLine}
        prCommentsByLine={prCommentsByLine}
        expandedCommentLines={expandedCommentLines}
        toggleCommentLine={toggleCommentLine}
        highlightCommentLine={highlightCommentLine}
        highlightLineRef={highlightLineRef}
        searchQuery={searchQuery}
        activeSearchMatch={activeSearchMatch}
        onAddAnnotation={onAddAnnotation}
        onDeleteAnnotation={onDeleteAnnotation}
        onEditAnnotation={onEditAnnotation}
        onSendToClaude={onSendToClaude}
      />
    );
  }

  return (
    <SplitDiffBody
      key={themeMode}
      file={file}
      gapInfo={gapInfo}
      expandedGaps={expandedGaps}
      loadingGaps={loadingGaps}
      handleExpandContext={handleExpandContext}
      annotationsByLine={annotationsByLine}
      prCommentsByLine={prCommentsByLine}
      expandedCommentLines={expandedCommentLines}
      toggleCommentLine={toggleCommentLine}
      highlightCommentLine={highlightCommentLine}
      highlightLineRef={highlightLineRef}
      searchQuery={searchQuery}
      activeSearchMatch={activeSearchMatch}
      syncSplitScroll={syncSplitScroll}
      onAddAnnotation={onAddAnnotation}
      onDeleteAnnotation={onDeleteAnnotation}
      onEditAnnotation={onEditAnnotation}
      onSendToClaude={onSendToClaude}
    />
  );
}

const DiffFileCard = memo(forwardRef<HTMLDivElement, DiffFileCardProps>(
  function DiffFileCard(
    {
      file,
      expanded,
      onToggleExpanded,
      viewMode,
      annotations,
      activeAnnotationLine,
      onAddAnnotation,
      onSubmitAnnotation,
      onSubmitReviewComment,
      onDeleteAnnotation,
      onEditAnnotation,
      prComments,
      repoPath,
      commitHash,
      searchQuery,
      activeSearchMatch,
      onDiscardFile,
      autoExpandAll,
      highlightCommentLine,
      onSendToClaude,
    },
    ref
  ) {
    const [expandedCommentLines, setExpandedCommentLines] = useState<
      Set<number>
    >(() => new Set());

    const isMarkdown = isMarkdownPath(file.path);
    const supportsRendered = isMarkdown && file.status !== "deleted";
    const fileViewMode = useFileViewModeStore((s) => s.modes[file.path] ?? "diff");
    const setModeForPath = useFileViewModeStore((s) => s.setMode);
    const setFileViewMode = useCallback(
      (mode: FileViewMode) => setModeForPath(file.path, mode),
      [setModeForPath, file.path],
    );

    // Auto-expand the PR comment thread when highlightCommentLine changes
    const highlightLineRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
      if (highlightCommentLine != null) {
        setExpandedCommentLines((prev) => {
          if (prev.has(highlightCommentLine)) return prev;
          const next = new Set(prev);
          next.add(highlightCommentLine);
          return next;
        });
        // Scroll to the highlighted line after render
        requestAnimationFrame(() => {
          highlightLineRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    }, [highlightCommentLine]);

    // Track whether this card has ever been in/near the viewport.
    // Off-screen cards skip rendering their diff body even when expanded,
    // so "Expand all" doesn't mount all 42 cards at once.
    const cardRef = useRef<HTMLDivElement | null>(null);
    const [hasBeenVisible, setHasBeenVisible] = useState(false);
    const isSyncing = useRef(false);

    const syncSplitScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
      if (isSyncing.current) return;
      const target = e.currentTarget;
      const scrollLeft = target.scrollLeft;
      const isLeft = target.classList.contains('split-left-col');
      const oppositeClass = isLeft ? '.split-right-col' : '.split-left-col';
      isSyncing.current = true;
      const body = target.closest('.split-diff-body');
      if (body) {
        body.querySelectorAll<HTMLDivElement>(oppositeClass).forEach(el => {
          el.scrollLeft = scrollLeft;
        });
      }
      requestAnimationFrame(() => { isSyncing.current = false; });
    }, []);

    useEffect(() => {
      const node = cardRef.current;
      if (!node || hasBeenVisible) return;

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setHasBeenVisible(true);
            observer.disconnect();
          }
        },
        { rootMargin: "500px" }
      );

      observer.observe(node);
      return () => observer.disconnect();
    }, [hasBeenVisible]);

    // Group annotations by side:lineNumber for O(1) lookup
    const annotationsByLine = useMemo(() => {
      const map = new Map<string, Annotation[]>();
      for (const ann of annotations) {
        if (ann.filePath !== file.path) continue;
        const key = `${ann.side}:${ann.lineNumber}`;
        const existing = map.get(key);
        if (existing) {
          existing.push(ann);
        } else {
          map.set(key, [ann]);
        }
      }
      return map;
    }, [annotations, file.path]);

    const prCommentsByLine = useMemo(
      () => groupPrCommentsByLine(prComments, file.path, file.oldPath ?? null),
      [prComments, file.path, file.oldPath],
    );

    function toggleCommentLine(lineNumber: number) {
      setExpandedCommentLines((prev) => {
        const next = new Set(prev);
        if (next.has(lineNumber)) {
          next.delete(lineNumber);
        } else {
          next.add(lineNumber);
        }
        return next;
      });
    }

    return (
      <div ref={(node) => {
        // Merge forwarded ref + local cardRef
        cardRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }} className={expanded ? "" : "border-b border-border-default"}>
        <DiffFileHeader
          file={file}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          repoPath={repoPath}
          onDiscardFile={onDiscardFile}
          fileViewMode={supportsRendered ? fileViewMode : undefined}
          onChangeFileViewMode={supportsRendered ? setFileViewMode : undefined}
        />

        {/* Body — deferred until card has been in/near viewport */}
        {expanded && hasBeenVisible && supportsRendered && fileViewMode === "rendered" && (
          <div className="bg-bg-primary">
            <MarkdownView
              repoPath={repoPath}
              filePath={file.path}
              commitHash={commitHash}
            />
          </div>
        )}
        {expanded && hasBeenVisible && (!supportsRendered || fileViewMode === "diff") && (
          <div className="bg-bg-primary overflow-x-auto">
            {isMonacoFlagOn() ? (
              <MonacoDiffBody
                file={file}
                viewMode={viewMode === "side-by-side" ? "side-by-side" : "inline"}
              />
            ) : (
              <LegacyDiffBody
                file={file}
                viewMode={viewMode}
                repoPath={repoPath}
                commitHash={commitHash}
                autoExpandAll={autoExpandAll}
                annotationsByLine={annotationsByLine}
                prCommentsByLine={prCommentsByLine}
                expandedCommentLines={expandedCommentLines}
                toggleCommentLine={toggleCommentLine}
                highlightCommentLine={highlightCommentLine}
                highlightLineRef={highlightLineRef}
                searchQuery={searchQuery}
                activeSearchMatch={activeSearchMatch}
                syncSplitScroll={syncSplitScroll}
                onAddAnnotation={onAddAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onEditAnnotation={onEditAnnotation}
                onSendToClaude={onSendToClaude}
              />
            )}
          </div>
        )}

        {/* Sticky annotation input — rendered outside overflow-x-auto so sticky works against the outer scroll container */}
        {expanded && hasBeenVisible && activeAnnotationLine?.filePath === file.path && (
          <div className={isStickyDisabled() ? "z-20" : "sticky bottom-0 z-20"}>
            <AnnotationInput
              filePath={file.path}
              lineNumber={activeAnnotationLine.lineNumber}
              onSubmit={(text) =>
                onSubmitAnnotation(
                  file.path,
                  activeAnnotationLine.lineNumber,
                  activeAnnotationLine.side,
                  text,
                )
              }
              onSubmitReview={
                onSubmitReviewComment
                  ? (text) =>
                      onSubmitReviewComment(
                        file.path,
                        activeAnnotationLine.lineNumber,
                        activeAnnotationLine.side,
                        text,
                      )
                  : undefined
              }
              onCancel={() =>
                onAddAnnotation(
                  file.path,
                  activeAnnotationLine.lineNumber,
                  activeAnnotationLine.side,
                )
              }
            />
          </div>
        )}
      </div>
    );
  }
), (prev, next) =>
  prev.file.path === next.file.path &&
  prev.expanded === next.expanded &&
  prev.viewMode === next.viewMode &&
  prev.repoPath === next.repoPath &&
  prev.commitHash === next.commitHash &&
  prev.annotations.length === next.annotations.length &&
  prev.activeAnnotationLine === next.activeAnnotationLine &&
  prev.prComments.length === next.prComments.length &&
  prev.searchQuery === next.searchQuery &&
  prev.activeSearchMatch?.hunkIndex === next.activeSearchMatch?.hunkIndex &&
  prev.activeSearchMatch?.lineIndex === next.activeSearchMatch?.lineIndex &&
  prev.onToggleExpanded === next.onToggleExpanded &&
  prev.onAddAnnotation === next.onAddAnnotation &&
  prev.onSubmitAnnotation === next.onSubmitAnnotation &&
  prev.onSubmitReviewComment === next.onSubmitReviewComment &&
  prev.onDeleteAnnotation === next.onDeleteAnnotation &&
  prev.onEditAnnotation === next.onEditAnnotation &&
  prev.autoExpandAll === next.autoExpandAll &&
  prev.highlightCommentLine === next.highlightCommentLine &&
  prev.onSendToClaude === next.onSendToClaude
);

export { DiffFileCard };
export type { DiffFileCardProps };
