import React from "react";
import { SplitSideContent } from "./SplitDiffLine";
import { pairLinesForSplit } from "./splitPairing";
import { AnnotationBubble } from "./AnnotationBubble";
import { DiffCommentThread } from "./DiffCommentThread";
import { ExpandContextButton } from "./ExpandContextButton";
import type { DiffFile, DiffLine, Annotation, PrComment, DiffSide } from "../../types";
import type { GapInfo } from "./useContextExpansion";

interface SplitDiffBodyProps {
  file: DiffFile;
  gapInfo: GapInfo[];
  expandedGaps: Map<string, DiffLine[]>;
  loadingGaps: Set<string>;
  handleExpandContext: (gapKey: string) => void;
  annotationsByLine: Map<string, Annotation[]>;
  prCommentsByLine: Map<number, PrComment[]>;
  expandedCommentLines: Set<number>;
  toggleCommentLine: (lineNumber: number) => void;
  highlightCommentLine?: number | null;
  highlightLineRef: React.RefObject<HTMLDivElement | null>;
  searchQuery?: string;
  syncSplitScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  onAddAnnotation: (filePath: string, lineNumber: number, side: DiffSide) => void;
  onDeleteAnnotation: (id: string) => void;
  onEditAnnotation: (id: string, text: string) => void;
  onSendToClaude?: (comment: PrComment) => void;
}

function SplitDiffBody({
  file,
  gapInfo,
  expandedGaps,
  loadingGaps,
  handleExpandContext,
  annotationsByLine,
  prCommentsByLine,
  expandedCommentLines,
  toggleCommentLine,
  highlightCommentLine,
  highlightLineRef,
  searchQuery,
  syncSplitScroll,
  onAddAnnotation,
  onDeleteAnnotation,
  onEditAnnotation,
  onSendToClaude,
}: SplitDiffBodyProps) {
  return (
    <div className="split-diff-body">
      {file.hunks.map((hunk, hunkIndex) => {
        const topGapKey = hunkIndex === 0 ? "top" : `between-${hunkIndex - 1}-${hunkIndex}`;
        const topGap = gapInfo.find((g) => g.key === topGapKey);
        const topExpandedLines = expandedGaps.get(topGapKey) ?? [];

        return (
          <React.Fragment key={hunkIndex}>
            {topGap && (
              <ExpandContextButton
                position={topGap.position}
                hiddenLineCount={topGap.hiddenLines}
                onExpandAll={() => handleExpandContext(topGapKey)}
                loading={loadingGaps.has(topGapKey)}
              />
            )}

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

            <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-y border-border-default font-mono text-[10px] text-text-tertiary select-none">
              <span>{hunk.header}</span>
            </div>

            {(() => {
              const pairedRows = pairLinesForSplit(hunk.lines);
              return (
                <div className="flex">
                  <div className="flex-1 min-w-0 overflow-x-auto split-left-col" onScroll={syncSplitScroll}>
                    {pairedRows.map((row, rowIndex) => {
                      const side: DiffSide = "old";
                      const lineNumber = row.left?.lineNumber ?? null;
                      const annotationKey = lineNumber !== null ? `${side}:${lineNumber}` : null;
                      const lineAnnotations = annotationKey !== null ? (annotationsByLine.get(annotationKey) ?? []) : [];
                      return (
                        <div key={rowIndex}>
                          <SplitSideContent
                            side={row.left}
                            filePath={file.path}
                            align="left"
                            onClickLine={lineNumber !== null ? (ln) => onAddAnnotation(file.path, ln, side) : undefined}
                            searchQuery={searchQuery}
                          />
                          {lineAnnotations.map((ann) => (
                            <AnnotationBubble
                              key={ann.id}
                              annotation={ann}
                              onDelete={onDeleteAnnotation}
                              onEdit={onEditAnnotation}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                  <div className="w-px bg-border-default flex-shrink-0" />
                  <div className="flex-1 min-w-0 overflow-x-auto split-right-col" onScroll={syncSplitScroll}>
                    {pairedRows.map((row, rowIndex) => {
                      const side: DiffSide = "new";
                      const lineNumber = row.right?.lineNumber ?? row.left?.lineNumber ?? null;
                      const annotationKey = lineNumber !== null ? `${side}:${lineNumber}` : null;
                      const lineAnnotations = annotationKey !== null ? (annotationsByLine.get(annotationKey) ?? []) : [];
                      const lineComments = lineNumber !== null ? (prCommentsByLine.get(lineNumber) ?? []) : [];
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
                            <div ref={lineNumber === highlightCommentLine ? highlightLineRef : undefined}>
                              <DiffCommentThread
                                comments={lineComments}
                                expanded={commentsExpanded}
                                onToggle={() => toggleCommentLine(lineNumber)}
                                onSendToClaude={onSendToClaude}
                              />
                            </div>
                          )}
                          {lineAnnotations.map((ann) => (
                            <AnnotationBubble
                              key={ann.id}
                              annotation={ann}
                              onDelete={onDeleteAnnotation}
                              onEdit={onEditAnnotation}
                            />
                          ))}
                          {/* AnnotationInput is rendered sticky in DiffFileCard, outside the overflow-x-auto container */}
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

      {gapInfo.find((g) => g.key === "bottom") && (
        <ExpandContextButton
          position="bottom"
          hiddenLineCount={gapInfo.find((g) => g.key === "bottom")!.hiddenLines}
          onExpandAll={() => handleExpandContext("bottom")}
          loading={loadingGaps.has("bottom")}
        />
      )}
    </div>
  );
}

export { SplitDiffBody };
export type { SplitDiffBodyProps };
