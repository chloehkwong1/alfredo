import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { SyntaxDiffLine } from "./SyntaxDiffLine";
import { AnnotationBubble } from "./AnnotationBubble";
import { AnnotationInput } from "./AnnotationInput";
import { DiffCommentIndicator } from "./DiffCommentIndicator";
import { DiffCommentThread } from "./DiffCommentThread";
import { SplitDiffLine } from "./SplitDiffLine";
import { pairLinesForSplit } from "./splitPairing";
import { ExpandContextButton } from "./ExpandContextButton";
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
}

/** Max lines to fetch when expanding to end of file (backend returns fewer if EOF is reached sooner) */
const MAX_BOTTOM_EXPAND = 10_000;

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
      onEditAnnotation,
      prComments,
      repoPath,
      commitHash,
      searchQuery,
      activeSearchMatch,
      onDiscardFile,
      autoExpandAll,
      highlightCommentLine,
    },
    ref
  ) {
    const [expandedCommentLines, setExpandedCommentLines] = useState<
      Set<number>
    >(new Set());

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

      // Gap below last hunk (we don't know exact count, so show a generic indicator)
      if (file.status !== "deleted" && !bottomExhausted) {
        const lastHunk = hunks[hunks.length - 1];
        const lastLineNum = lastHunk.lines.reduce((max, l) => {
          const n = l.newLineNumber ?? l.oldLineNumber ?? 0;
          return Math.max(max, n);
        }, 0);
        gaps.push({
          key: "bottom",
          position: "bottom",
          hiddenLines: 1, // placeholder — we don't know the real count
          startLine: lastLineNum + 1,
          endLine: lastLineNum + MAX_BOTTOM_EXPAND,
        });
      }

      return gaps;
    }, [file.hunks, file.status, expandedGaps, bottomExhausted]);

    const [loadingGaps, setLoadingGaps] = useState<Set<string>>(new Set());

    const handleExpandContext = useCallback(
      async (gapKey: string) => {
        const gap = gapInfo.find((g) => g.key === gapKey);
        if (!gap) return;

        setLoadingGaps((prev) => new Set(prev).add(gapKey));
        try {
          const lines = await getFileLines(repoPath, file.path, gap.startLine, gap.endLine, commitHash);
          const contextLines: DiffLine[] = lines.map((l) => ({
            lineType: "context" as const,
            content: l.content,
            oldLineNumber: l.lineNumber,
            newLineNumber: l.lineNumber,
          }));

          if (gapKey === "bottom") {
            setBottomExhausted(true);
          }

          if (contextLines.length === 0) return;

          setExpandedGaps((prev) => {
            const next = new Map(prev);
            next.set(gapKey, contextLines);
            return next;
          });
        } catch (err) {
          console.error("Failed to expand context:", err);
        } finally {
          setLoadingGaps((prev) => {
            const next = new Set(prev);
            next.delete(gapKey);
            return next;
          });
        }
      },
      [gapInfo, file.path, repoPath, commitHash],
    );

    // Auto-expand all context gaps when requested (focused mode "Expand full file")
    useEffect(() => {
      if (!autoExpandAll) return;
      for (const gap of gapInfo) {
        if (!expandedGaps.has(gap.key)) {
          handleExpandContext(gap.key);
        }
      }
    }, [autoExpandAll, gapInfo, expandedGaps, handleExpandContext]);

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

          {/* Discard button */}
          {onDiscardFile && (
            <button
              className="flex-shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 p-0.5 rounded text-text-tertiary hover:text-danger transition-all"
              onClick={(e) => {
                e.stopPropagation();
                onDiscardFile(file.path, file.status);
              }}
              title="Discard changes"
            >
              <Trash2 size={13} />
            </button>
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
                      onExpandAll={() => handleExpandContext(topGapKey)}
                      loading={loadingGaps.has(topGapKey)}
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
                        searchQuery={searchQuery}
                      />
                    ) : (
                      <SyntaxDiffLine
                        key={`exp-${topGapKey}-${li}`}
                        content={line.content}
                        lineType={line.lineType}
                        oldLineNumber={line.oldLineNumber}
                        newLineNumber={line.newLineNumber}
                        filePath={file.path}
                        searchQuery={searchQuery}
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
                      // Split view: clicks only on right side, so annotations use "new" side
                      const side: import("../../types").DiffSide = "new";
                      const lineNumber = row.right?.lineNumber ?? row.left?.lineNumber ?? null;
                      const annotationKey = lineNumber !== null ? `${side}:${lineNumber}` : null;
                      const lineAnnotations = annotationKey !== null
                        ? (annotationsByLine.get(annotationKey) ?? [])
                        : [];
                      const lineComments = lineNumber !== null
                        ? (prCommentsByLine.get(lineNumber) ?? [])
                        : [];
                      const isActiveAnnotationLine =
                        lineNumber !== null &&
                        activeAnnotationLine?.filePath === file.path &&
                        activeAnnotationLine?.lineNumber === lineNumber &&
                        activeAnnotationLine?.side === side;
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
                              ? (ln) => onAddAnnotation(file.path, ln, side)
                              : undefined
                          }
                          searchQuery={searchQuery}
                        >
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
                            <DiffCommentThread comments={lineComments} />
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
                              onSubmit={(text) =>
                                onSubmitAnnotation(file.path, lineNumber, side, text)
                              }
                              onCancel={() => onAddAnnotation(file.path, lineNumber, side)}
                            />
                          )}
                        </SplitDiffLine>
                      );
                    })
                  ) : (
                    hunk.lines.map((line, lineIndex) => {
                      // Determine side and line number based on line type
                      const side: import("../../types").DiffSide = line.lineType === "deletion" ? "old" : "new";
                      const lineNumber =
                        line.newLineNumber ?? line.oldLineNumber ?? null;
                      const annotationKey = lineNumber !== null ? `${side}:${lineNumber}` : null;

                      const lineAnnotations = annotationKey !== null
                        ? (annotationsByLine.get(annotationKey) ?? [])
                        : [];
                      const lineComments = lineNumber !== null
                        ? (prCommentsByLine.get(lineNumber) ?? [])
                        : [];
                      const isActiveAnnotationLine =
                        lineNumber !== null &&
                        activeAnnotationLine?.filePath === file.path &&
                        activeAnnotationLine?.lineNumber === lineNumber &&
                        activeAnnotationLine?.side === side;
                      const hasComments = lineComments.length > 0;
                      const commentsExpanded =
                        lineNumber !== null &&
                        expandedCommentLines.has(lineNumber);

                      const isActiveMatch = activeSearchMatch !== null &&
                        activeSearchMatch !== undefined &&
                        activeSearchMatch.hunkIndex === hunkIndex &&
                        activeSearchMatch.lineIndex === lineIndex;

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
                              ? () => onAddAnnotation(file.path, lineNumber, side)
                              : undefined
                          }
                          searchQuery={searchQuery}
                          isActiveSearchMatch={isActiveMatch}
                        >
                          {/* PR comment indicator */}
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
                              onEdit={onEditAnnotation}
                            />
                          ))}

                          {/* Active annotation input (only on additions/context, not deletions — avoids duplicates on modified lines) */}
                          {isActiveAnnotationLine && lineNumber !== null && line.lineType !== "deletion" && (
                            <AnnotationInput
                              onSubmit={(text) =>
                                onSubmitAnnotation(file.path, lineNumber, side, text)
                              }
                              onCancel={() => onAddAnnotation(file.path, lineNumber, side)}
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
                  searchQuery={searchQuery}
                />
              ) : (
                <SyntaxDiffLine
                  key={`exp-bottom-${li}`}
                  content={line.content}
                  lineType={line.lineType}
                  oldLineNumber={line.oldLineNumber}
                  newLineNumber={line.newLineNumber}
                  filePath={file.path}
                  searchQuery={searchQuery}
                />
              )
            )}

            {/* Expand button below last hunk */}
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
  prev.activeSearchMatch === next.activeSearchMatch &&
  prev.onToggleExpanded === next.onToggleExpanded &&
  prev.onAddAnnotation === next.onAddAnnotation &&
  prev.onSubmitAnnotation === next.onSubmitAnnotation &&
  prev.onDeleteAnnotation === next.onDeleteAnnotation &&
  prev.onEditAnnotation === next.onEditAnnotation &&
  prev.autoExpandAll === next.autoExpandAll &&
  prev.highlightCommentLine === next.highlightCommentLine
);

export { DiffFileCard };
export type { DiffFileCardProps };
