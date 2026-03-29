import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SyntaxDiffLine } from "./SyntaxDiffLine";
import { AnnotationBubble } from "./AnnotationBubble";
import { AnnotationInput } from "./AnnotationInput";
import { DiffCommentIndicator } from "./DiffCommentIndicator";
import { DiffCommentThread } from "./DiffCommentThread";
import { SplitDiffLine } from "./SplitDiffLine";
import { pairLinesForSplit } from "./splitPairing";
import { ExpandContextButton, EXPAND_INCREMENT } from "./ExpandContextButton";
import { getFileLines } from "../../api";
import type {
  DiffFile,
  DiffLine,
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
  activeAnnotationLine: number | null;
  onAddAnnotation: (filePath: string, lineNumber: number) => void;
  onSubmitAnnotation: (
    filePath: string,
    lineNumber: number,
    text: string
  ) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  prComments: PrComment[];
  repoPath: string;
  commitHash?: string;
}

const STATUS_LABEL: Record<DiffFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

const STATUS_COLOR: Record<DiffFile["status"], string> = {
  added: "text-diff-added bg-diff-added/10",
  modified: "text-accent-primary bg-accent-primary/10",
  deleted: "text-diff-removed bg-diff-removed/10",
  renamed: "text-text-secondary bg-bg-hover",
};

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
      prComments,
      repoPath,
      commitHash,
    },
    ref
  ) {
    const [expandedCommentLines, setExpandedCommentLines] = useState<
      Set<number>
    >(new Set());

    // Track whether this card has ever been in/near the viewport.
    // Off-screen cards skip rendering their diff body even when expanded,
    // so "Expand all" doesn't mount all 42 cards at once.
    const cardRef = useRef<HTMLDivElement | null>(null);
    const [hasBeenVisible, setHasBeenVisible] = useState(false);

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

    // Group annotations by newLineNumber for O(1) lookup
    const annotationsByLine = useMemo(() => {
      const map = new Map<number, Annotation[]>();
      for (const ann of annotations) {
        if (ann.filePath !== file.path) continue;
        const key = ann.lineNumber;
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

    // ── Context expansion state ──────────────────────────────
    const [expandedGaps, setExpandedGaps] = useState<Map<string, DiffLine[]>>(new Map());
    const [bottomExhausted, setBottomExhausted] = useState(false);

    // Reset expanded gaps when file data changes
    useEffect(() => {
      setExpandedGaps(new Map());
      setBottomExhausted(false);
    }, [file]);

    // Compute gap info: how many hidden lines between each hunk
    const gapInfo = useMemo(() => {
      const gaps: Array<{
        key: string;
        position: "top" | "between" | "bottom";
        hiddenLines: number;
        startLine: number;
        endLine: number;
      }> = [];
      const hunks = file.hunks;
      if (hunks.length === 0) return gaps;

      // Gap above first hunk
      const firstHunk = hunks[0];
      const firstOldStart = firstHunk.oldStart;
      if (firstOldStart > 1 && file.status !== "added") {
        const alreadyExpanded = expandedGaps.get("top")?.length ?? 0;
        const hidden = firstOldStart - 1 - alreadyExpanded;
        if (hidden > 0) {
          gaps.push({
            key: "top",
            position: "top",
            hiddenLines: hidden,
            startLine: 1 + alreadyExpanded,
            endLine: firstOldStart - 1,
          });
        }
      }

      // Gaps between hunks
      for (let i = 0; i < hunks.length - 1; i++) {
        const currentHunk = hunks[i];
        const nextHunk = hunks[i + 1];
        const currentLastLine = currentHunk.lines.reduce((max, l) => {
          const n = l.oldLineNumber ?? l.newLineNumber ?? 0;
          return Math.max(max, n);
        }, 0);
        const nextStart = nextHunk.oldStart;
        const gapKey = `between-${i}-${i + 1}`;
        const alreadyExpanded = expandedGaps.get(gapKey)?.length ?? 0;
        const totalGap = nextStart - currentLastLine - 1;
        const hidden = totalGap - alreadyExpanded;
        if (hidden > 0) {
          gaps.push({
            key: gapKey,
            position: "between",
            hiddenLines: hidden,
            startLine: currentLastLine + 1 + alreadyExpanded,
            endLine: nextStart - 1,
          });
        }
      }

      // Gap below last hunk
      if (file.status !== "deleted" && !bottomExhausted) {
        gaps.push({
          key: "bottom",
          position: "bottom",
          hiddenLines: EXPAND_INCREMENT,
          startLine: 0,
          endLine: 0,
        });
      }

      return gaps;
    }, [file.hunks, file.status, expandedGaps, bottomExhausted]);

    const handleExpandContext = useCallback(
      async (gapKey: string, direction: "up" | "down" | "all") => {
        const gap = gapInfo.find((g) => g.key === gapKey);
        if (!gap) return;

        let startLine: number;
        let endLine: number;
        let requestedCount: number;

        if (gapKey === "bottom") {
          // Compute from current expanded state to avoid stale closure
          const lastHunk = file.hunks[file.hunks.length - 1];
          const lastLineNum = lastHunk.lines.reduce((max, l) => {
            const n = l.newLineNumber ?? l.oldLineNumber ?? 0;
            return Math.max(max, n);
          }, 0);
          // Read latest expanded count via functional updater pattern below
          // For the API call, we need the count now — read from gapInfo which is current
          const alreadyExpanded = expandedGaps.get("bottom")?.length ?? 0;
          startLine = lastLineNum + 1 + alreadyExpanded;
          endLine = startLine + EXPAND_INCREMENT - 1;
          requestedCount = EXPAND_INCREMENT;
        } else if (direction === "all") {
          startLine = gap.startLine;
          endLine = gap.endLine;
          requestedCount = gap.endLine - gap.startLine + 1;
        } else if (direction === "down") {
          startLine = gap.startLine;
          endLine = Math.min(gap.startLine + EXPAND_INCREMENT - 1, gap.endLine);
          requestedCount = endLine - startLine + 1;
        } else {
          endLine = gap.endLine;
          startLine = Math.max(gap.endLine - EXPAND_INCREMENT + 1, gap.startLine);
          requestedCount = endLine - startLine + 1;
        }

        try {
          const lines = await getFileLines(repoPath, file.path, startLine, endLine, commitHash);
          const contextLines: DiffLine[] = lines.map((l) => ({
            lineType: "context" as const,
            content: l.content,
            oldLineNumber: l.lineNumber,
            newLineNumber: l.lineNumber,
          }));

          // If we got fewer lines than requested, we've hit EOF
          if (gapKey === "bottom" && contextLines.length < requestedCount) {
            setBottomExhausted(true);
          }

          if (contextLines.length === 0) return;

          setExpandedGaps((prev) => {
            const next = new Map(prev);
            const existing = next.get(gapKey) ?? [];
            if (direction === "up") {
              next.set(gapKey, [...contextLines, ...existing]);
            } else {
              next.set(gapKey, [...existing, ...contextLines]);
            }
            return next;
          });
        } catch (err) {
          console.error("Failed to expand context:", err);
        }
      },
      [gapInfo, file.hunks, file.path, repoPath, commitHash, expandedGaps],
    );

    const statusLabel = STATUS_LABEL[file.status];
    const statusColor = STATUS_COLOR[file.status];

    return (
      <div ref={(node) => {
        // Merge forwarded ref + local cardRef
        cardRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }} className="border-b border-border-default">
        {/* Sticky header */}
        <div
          className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border-b border-border-default cursor-pointer select-none hover:bg-bg-hover transition-colors"
          onClick={() => onToggleExpanded(file.path)}
        >
          {/* Chevron */}
          <span className="text-text-tertiary flex-shrink-0">
            {expanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </span>

          {/* Status badge */}
          <span
            className={[
              "flex-shrink-0 w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center",
              statusColor,
            ].join(" ")}
          >
            {statusLabel}
          </span>

          {/* File path */}
          <span className="flex-1 font-mono text-xs text-text-primary truncate">
            {file.path}
          </span>

          {/* +/- stats */}
          {(file.additions > 0 || file.deletions > 0) && (
            <span className="flex items-center gap-1.5 flex-shrink-0 text-[11px] font-mono">
              {file.additions > 0 && (
                <span className="text-diff-added">+{file.additions}</span>
              )}
              {file.deletions > 0 && (
                <span className="text-diff-removed">-{file.deletions}</span>
              )}
            </span>
          )}
        </div>

        {/* Diff body — deferred until card has been in/near viewport */}
        {expanded && hasBeenVisible && (
          <div className="bg-bg-primary overflow-x-auto">
            {file.hunks.map((hunk, hunkIndex) => {
              const topGapKey = hunkIndex === 0 ? "top" : `between-${hunkIndex - 1}-${hunkIndex}`;
              const topGap = gapInfo.find((g) => g.key === topGapKey);
              const topExpandedLines = expandedGaps.get(topGapKey) ?? [];

              return (
                <div key={hunkIndex}>
                  {/* Expand button above this hunk */}
                  {topGap && (
                    <ExpandContextButton
                      position={topGap.position}
                      hiddenLineCount={topGap.hiddenLines}
                      onExpandIncremental={(dir) => handleExpandContext(topGapKey, dir)}
                      onExpandAll={() => handleExpandContext(topGapKey, "all")}
                    />
                  )}

                  {/* Expanded lines above this hunk */}
                  {topExpandedLines.map((line, li) =>
                    viewMode === "split" ? (
                      <SplitDiffLine
                        key={`exp-${topGapKey}-${li}`}
                        left={{ lineNumber: line.oldLineNumber, content: line.content, lineType: "context" }}
                        right={{ lineNumber: line.newLineNumber, content: line.content, lineType: "context" }}
                        filePath={file.path}
                      />
                    ) : (
                      <SyntaxDiffLine
                        key={`exp-${topGapKey}-${li}`}
                        content={line.content}
                        lineType={line.lineType}
                        oldLineNumber={line.oldLineNumber}
                        newLineNumber={line.newLineNumber}
                        filePath={file.path}
                      />
                    )
                  )}

                  {/* Hunk separator */}
                  <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-y border-border-default font-mono text-[10px] text-text-tertiary select-none">
                    <span>{hunk.header}</span>
                  </div>

                  {/* Lines */}
                  {viewMode === "split" ? (
                    pairLinesForSplit(hunk.lines).map((row, rowIndex) => {
                      const lineNumber = row.right?.lineNumber ?? row.left?.lineNumber ?? null;
                      const lineAnnotations = lineNumber !== null
                        ? (annotationsByLine.get(lineNumber) ?? [])
                        : [];
                      const lineComments = lineNumber !== null
                        ? (prCommentsByLine.get(lineNumber) ?? [])
                        : [];
                      const isActiveAnnotationLine =
                        lineNumber !== null && activeAnnotationLine === lineNumber;
                      const hasComments = lineComments.length > 0;
                      const commentsExpanded =
                        lineNumber !== null && expandedCommentLines.has(lineNumber);

                      return (
                        <SplitDiffLine
                          key={rowIndex}
                          left={row.left}
                          right={row.right}
                          filePath={file.path}
                          onClickLine={
                            lineNumber !== null
                              ? (ln) => onAddAnnotation(file.path, ln)
                              : undefined
                          }
                        >
                          {hasComments && lineNumber !== null && (
                            <div className="flex justify-end pr-2">
                              <DiffCommentIndicator
                                count={lineComments.length}
                                onClick={() => toggleCommentLine(lineNumber)}
                              />
                            </div>
                          )}
                          {hasComments && commentsExpanded && (
                            <DiffCommentThread comments={lineComments} />
                          )}
                          {lineAnnotations.map((ann) => (
                            <AnnotationBubble
                              key={ann.id}
                              annotation={ann}
                              onDelete={onDeleteAnnotation}
                            />
                          ))}
                          {isActiveAnnotationLine && lineNumber !== null && (
                            <AnnotationInput
                              onSubmit={(text) =>
                                onSubmitAnnotation(file.path, lineNumber, text)
                              }
                              onCancel={() => onAddAnnotation(file.path, lineNumber)}
                            />
                          )}
                        </SplitDiffLine>
                      );
                    })
                  ) : (
                    hunk.lines.map((line, lineIndex) => {
                      // Use newLineNumber for additions/context, oldLineNumber for deletions
                      const lineNumber =
                        line.newLineNumber ?? line.oldLineNumber ?? null;

                      const lineAnnotations = lineNumber !== null
                        ? (annotationsByLine.get(lineNumber) ?? [])
                        : [];
                      const lineComments = lineNumber !== null
                        ? (prCommentsByLine.get(lineNumber) ?? [])
                        : [];
                      const isActiveAnnotationLine =
                        lineNumber !== null &&
                        activeAnnotationLine === lineNumber;
                      const hasComments = lineComments.length > 0;
                      const commentsExpanded =
                        lineNumber !== null &&
                        expandedCommentLines.has(lineNumber);

                      return (
                        <SyntaxDiffLine
                          key={lineIndex}
                          content={line.content}
                          lineType={line.lineType}
                          oldLineNumber={line.oldLineNumber}
                          newLineNumber={line.newLineNumber}
                          filePath={file.path}
                          onClickLine={
                            lineNumber !== null
                              ? () => onAddAnnotation(file.path, lineNumber)
                              : undefined
                          }
                        >
                          {/* PR comment indicator */}
                          {hasComments && lineNumber !== null && (
                            <div className="flex justify-end pr-2">
                              <DiffCommentIndicator
                                count={lineComments.length}
                                onClick={() => toggleCommentLine(lineNumber)}
                              />
                            </div>
                          )}

                          {/* PR comment thread */}
                          {hasComments && commentsExpanded && (
                            <DiffCommentThread comments={lineComments} />
                          )}

                          {/* Existing annotations */}
                          {lineAnnotations.map((ann) => (
                            <AnnotationBubble
                              key={ann.id}
                              annotation={ann}
                              onDelete={onDeleteAnnotation}
                            />
                          ))}

                          {/* Active annotation input (only on additions/context, not deletions — avoids duplicates on modified lines) */}
                          {isActiveAnnotationLine && lineNumber !== null && line.lineType !== "deletion" && (
                            <AnnotationInput
                              onSubmit={(text) =>
                                onSubmitAnnotation(file.path, lineNumber, text)
                              }
                              onCancel={() => onAddAnnotation(file.path, lineNumber)}
                            />
                          )}
                        </SyntaxDiffLine>
                      );
                    })
                  )}
                </div>
              );
            })}

            {/* Expanded lines below last hunk */}
            {(expandedGaps.get("bottom") ?? []).map((line, li) =>
              viewMode === "split" ? (
                <SplitDiffLine
                  key={`exp-bottom-${li}`}
                  left={{ lineNumber: line.oldLineNumber, content: line.content, lineType: "context" }}
                  right={{ lineNumber: line.newLineNumber, content: line.content, lineType: "context" }}
                  filePath={file.path}
                />
              ) : (
                <SyntaxDiffLine
                  key={`exp-bottom-${li}`}
                  content={line.content}
                  lineType={line.lineType}
                  oldLineNumber={line.oldLineNumber}
                  newLineNumber={line.newLineNumber}
                  filePath={file.path}
                />
              )
            )}

            {/* Expand button below last hunk */}
            {gapInfo.find((g) => g.key === "bottom") && (
              <ExpandContextButton
                position="bottom"
                hiddenLineCount={gapInfo.find((g) => g.key === "bottom")!.hiddenLines}
                onExpandIncremental={(dir) => handleExpandContext("bottom", dir)}
                onExpandAll={() => handleExpandContext("bottom", "all")}
              />
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
  prev.onToggleExpanded === next.onToggleExpanded &&
  prev.onAddAnnotation === next.onAddAnnotation &&
  prev.onSubmitAnnotation === next.onSubmitAnnotation &&
  prev.onDeleteAnnotation === next.onDeleteAnnotation
);

export { DiffFileCard };
export type { DiffFileCardProps };
