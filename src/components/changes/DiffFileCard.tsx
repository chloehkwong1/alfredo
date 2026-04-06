import React, { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DiffFileHeader } from "./DiffFileHeader";
import { AnnotationBubble } from "./AnnotationBubble";
import { AnnotationInput } from "./AnnotationInput";
import { DiffCommentIndicator } from "./DiffCommentIndicator";
import { DiffCommentThread } from "./DiffCommentThread";
import { SplitSideContent } from "./SplitDiffLine";
import { pairLinesForSplit } from "./splitPairing";
import { ExpandContextButton } from "./ExpandContextButton";
import { useContextExpansion } from "./useContextExpansion";
import { UnifiedDiffBody } from "./UnifiedDiffBody";
import type {
  DiffFile,
  DiffViewMode,
  Annotation,
  PrComment,
} from "../../types";

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
    >(() => {
      const lines = new Set<number>();
      for (const comment of prComments) {
        if (comment.path === file.path && comment.line !== null) {
          lines.add(comment.line);
        }
      }
      return lines;
    });

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

    // Group PR comments by line number for O(1) lookup
    const prCommentsByLine = useMemo(() => {
      const map = new Map<number, PrComment[]>();
      for (const comment of prComments) {
        if (comment.path !== file.path || comment.line === null) continue;
        const key = comment.line;
        const existing = map.get(key);
        if (existing) {
          existing.push(comment);
        } else {
          map.set(key, [comment]);
        }
      }
      return map;
    }, [prComments, file.path]);

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

    const { gapInfo, expandedGaps, loadingGaps, handleExpandContext } = useContextExpansion(
      file, repoPath, commitHash, autoExpandAll,
    );

    return (
      <div ref={(node) => {
        // Merge forwarded ref + local cardRef
        cardRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }} className="border-b border-border-default">
        <DiffFileHeader
          file={file}
          expanded={expanded}
          onToggleExpanded={onToggleExpanded}
          onDiscardFile={onDiscardFile}
        />

        {/* Diff body — deferred until card has been in/near viewport */}
        {expanded && hasBeenVisible && (
          <div className="bg-bg-primary overflow-x-auto">
            {viewMode !== "split" ? (
              <UnifiedDiffBody
                file={file}
                gapInfo={gapInfo}
                expandedGaps={expandedGaps}
                loadingGaps={loadingGaps}
                handleExpandContext={handleExpandContext}
                annotationsByLine={annotationsByLine}
                prCommentsByLine={prCommentsByLine}
                activeAnnotationLine={activeAnnotationLine}
                expandedCommentLines={expandedCommentLines}
                toggleCommentLine={toggleCommentLine}
                highlightCommentLine={highlightCommentLine}
                highlightLineRef={highlightLineRef}
                searchQuery={searchQuery}
                activeSearchMatch={activeSearchMatch}
                onAddAnnotation={onAddAnnotation}
                onSubmitAnnotation={onSubmitAnnotation}
                onDeleteAnnotation={onDeleteAnnotation}
                onEditAnnotation={onEditAnnotation}
                onSendToClaude={onSendToClaude}
              />
            ) : (
              <div className="split-diff-body">
                {file.hunks.map((hunk, hunkIndex) => {
                  const topGapKey = hunkIndex === 0 ? "top" : `between-${hunkIndex - 1}-${hunkIndex}`;
                  const topGap = gapInfo.find((g) => g.key === topGapKey);
                  const topExpandedLines = expandedGaps.get(topGapKey) ?? [];

                  return (
                    <React.Fragment key={hunkIndex}>
                      {/* Full-width: expand button above this hunk */}
                      {topGap && (
                        <ExpandContextButton
                          position={topGap.position}
                          hiddenLineCount={topGap.hiddenLines}
                          onExpandAll={() => handleExpandContext(topGapKey)}
                          loading={loadingGaps.has(topGapKey)}
                        />
                      )}

                      {/* Two-column: expanded context lines above hunk */}
                      {topExpandedLines.length > 0 && (
                        <div className="flex">
                          <div className="flex-1 min-w-0 overflow-x-auto split-left-col" onScroll={syncSplitScroll}>
                            {topExpandedLines.map((line, li) => (
                              <SplitSideContent
                                key={li}
                                side={{ lineNumber: line.oldLineNumber, content: line.content, lineType: "context" }}
                                filePath={file.path}
                                align="left"
                                searchQuery={searchQuery}
                              />
                            ))}
                          </div>
                          <div className="w-px bg-border-default flex-shrink-0" />
                          <div className="flex-1 min-w-0 overflow-x-auto split-right-col" onScroll={syncSplitScroll}>
                            {topExpandedLines.map((line, li) => (
                              <SplitSideContent
                                key={li}
                                side={{ lineNumber: line.newLineNumber, content: line.content, lineType: "context" }}
                                filePath={file.path}
                                align="right"
                                searchQuery={searchQuery}
                              />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Full-width: hunk separator */}
                      <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-y border-border-default font-mono text-[10px] text-text-tertiary select-none">
                        <span>{hunk.header}</span>
                      </div>

                      {/* Two-column: hunk lines */}
                      {(() => {
                        const pairedRows = pairLinesForSplit(hunk.lines);
                        return (
                          <div className="flex">
                            <div className="flex-1 min-w-0 overflow-x-auto split-left-col" onScroll={syncSplitScroll}>
                              {pairedRows.map((row, rowIndex) => (
                                <SplitSideContent
                                  key={rowIndex}
                                  side={row.left}
                                  filePath={file.path}
                                  align="left"
                                  searchQuery={searchQuery}
                                />
                              ))}
                            </div>
                            <div className="w-px bg-border-default flex-shrink-0" />
                            <div className="flex-1 min-w-0 overflow-x-auto split-right-col" onScroll={syncSplitScroll}>
                              {pairedRows.map((row, rowIndex) => {
                                const side: import("../../types").DiffSide = "new";
                                const lineNumber = row.right?.lineNumber ?? row.left?.lineNumber ?? null;
                                const annotationKey = lineNumber !== null ? `${side}:${lineNumber}` : null;
                                const lineAnnotations = annotationKey !== null ? (annotationsByLine.get(annotationKey) ?? []) : [];
                                const lineComments = lineNumber !== null ? (prCommentsByLine.get(lineNumber) ?? []) : [];
                                const isActiveAnnotationLine =
                                  lineNumber !== null &&
                                  activeAnnotationLine?.filePath === file.path &&
                                  activeAnnotationLine?.lineNumber === lineNumber &&
                                  activeAnnotationLine?.side === side;
                                const hasComments = lineComments.length > 0;
                                const commentsExpanded = lineNumber !== null && expandedCommentLines.has(lineNumber);

                                return (
                                  <div key={rowIndex}>
                                    <SplitSideContent
                                      side={row.right}
                                      filePath={file.path}
                                      align="right"
                                      onClickLine={lineNumber !== null ? (ln) => onAddAnnotation(file.path, ln, side) : undefined}
                                      searchQuery={searchQuery}
                                    />
                                    {hasComments && lineNumber !== null && (
                                      <div
                                        className="flex justify-end pr-2"
                                        ref={lineNumber === highlightCommentLine ? highlightLineRef : undefined}
                                      >
                                        <DiffCommentIndicator
                                          count={lineComments.length}
                                          onClick={() => toggleCommentLine(lineNumber)}
                                        />
                                      </div>
                                    )}
                                    {hasComments && commentsExpanded && (
                                      <DiffCommentThread comments={lineComments} onSendToClaude={onSendToClaude} />
                                    )}
                                    {lineAnnotations.map((ann) => (
                                      <AnnotationBubble
                                        key={ann.id}
                                        annotation={ann}
                                        onDelete={onDeleteAnnotation}
                                        onEdit={onEditAnnotation}
                                      />
                                    ))}
                                    {isActiveAnnotationLine && lineNumber !== null && (
                                      <AnnotationInput
                                        onSubmit={(text) => onSubmitAnnotation(file.path, lineNumber, side, text)}
                                        onCancel={() => onAddAnnotation(file.path, lineNumber, side)}
                                      />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </React.Fragment>
                  );
                })}

                {/* Two-column: expanded lines below last hunk */}
                {(expandedGaps.get("bottom") ?? []).length > 0 && (
                  <div className="flex">
                    <div className="flex-1 min-w-0 overflow-x-auto split-left-col" onScroll={syncSplitScroll}>
                      {(expandedGaps.get("bottom") ?? []).map((line, li) => (
                        <SplitSideContent
                          key={li}
                          side={{ lineNumber: line.oldLineNumber, content: line.content, lineType: "context" }}
                          filePath={file.path}
                          align="left"
                          searchQuery={searchQuery}
                        />
                      ))}
                    </div>
                    <div className="w-px bg-border-default flex-shrink-0" />
                    <div className="flex-1 min-w-0 overflow-x-auto split-right-col" onScroll={syncSplitScroll}>
                      {(expandedGaps.get("bottom") ?? []).map((line, li) => (
                        <SplitSideContent
                          key={li}
                          side={{ lineNumber: line.newLineNumber, content: line.content, lineType: "context" }}
                          filePath={file.path}
                          align="right"
                          searchQuery={searchQuery}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Full-width: expand button below last hunk */}
                {gapInfo.find((g) => g.key === "bottom") && (
                  <ExpandContextButton
                    position="bottom"
                    hiddenLineCount={gapInfo.find((g) => g.key === "bottom")!.hiddenLines}
                    onExpandAll={() => handleExpandContext("bottom")}
                    loading={loadingGaps.has("bottom")}
                  />
                )}
              </div>
            )}
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
  prev.onDeleteAnnotation === next.onDeleteAnnotation &&
  prev.onEditAnnotation === next.onEditAnnotation &&
  prev.autoExpandAll === next.autoExpandAll &&
  prev.highlightCommentLine === next.highlightCommentLine &&
  prev.onSendToClaude === next.onSendToClaude
);

export { DiffFileCard };
export type { DiffFileCardProps };
