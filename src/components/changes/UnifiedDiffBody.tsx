import React from "react";
import { SyntaxDiffLine } from "./SyntaxDiffLine";
import { AnnotationBubble } from "./AnnotationBubble";
import { DiffCommentThread } from "./DiffCommentThread";
import { ExpandContextButton } from "./ExpandContextButton";
import { getRowComments } from "./prCommentLookup";
import type { DiffFile, DiffLine, Annotation, PrComment, DiffSide } from "../../types";
import type { GapInfo } from "./useContextExpansion";

interface UnifiedDiffBodyProps {
  file: DiffFile;
  gapInfo: GapInfo[];
  expandedGaps: Map<string, DiffLine[]>;
  loadingGaps: Set<string>;
  handleExpandContext: (gapKey: string) => void;
  annotationsByLine: Map<string, Annotation[]>;
  prCommentsByLine: Map<string, PrComment[]>;
  expandedCommentLines: Set<number>;
  toggleCommentLine: (lineNumber: number) => void;
  highlightCommentLine?: number | null;
  highlightLineRef: React.RefObject<HTMLDivElement | null>;
  searchQuery?: string;
  activeSearchMatch?: { hunkIndex: number; lineIndex: number } | null;
  onAddAnnotation: (filePath: string, lineNumber: number, side: DiffSide) => void;
  onDeleteAnnotation: (id: string) => void;
  onEditAnnotation: (id: string, text: string) => void;
  onSendToClaude?: (comment: PrComment) => void;
  repoPath?: string;
  prNumber?: number;
}

function UnifiedDiffBody({
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
  activeSearchMatch,
  onAddAnnotation,
  onDeleteAnnotation,
  onEditAnnotation,
  onSendToClaude,
  repoPath,
  prNumber,
}: UnifiedDiffBodyProps) {
  return (
    <div className="min-w-max">
      {file.hunks.map((hunk, hunkIndex) => {
        const topGapKey = hunkIndex === 0 ? "top" : `between-${hunkIndex - 1}-${hunkIndex}`;
        const topGap = gapInfo.find((g) => g.key === topGapKey);
        const topExpandedLines = expandedGaps.get(topGapKey) ?? [];

        return (
          <div key={hunkIndex}>
            {topGap && (
              <ExpandContextButton
                position={topGap.position}
                hiddenLineCount={topGap.hiddenLines}
                onExpandAll={() => handleExpandContext(topGapKey)}
                loading={loadingGaps.has(topGapKey)}
              />
            )}

            {topExpandedLines.map((line, li) => (
              <SyntaxDiffLine
                key={`exp-${topGapKey}-${li}`}
                content={line.content}
                lineType={line.lineType}
                oldLineNumber={line.oldLineNumber}
                newLineNumber={line.newLineNumber}
                filePath={file.path}
                searchQuery={searchQuery}
              />
            ))}

            <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-y border-border-default font-mono text-[10px] text-text-tertiary select-none">
              <span>{hunk.header}</span>
            </div>

            {hunk.lines.map((line, lineIndex) => {
              const side: DiffSide = line.lineType === "deletion" ? "old" : "new";
              const lineNumber = line.newLineNumber ?? line.oldLineNumber ?? null;
              const annotationKey = lineNumber !== null ? `${side}:${lineNumber}` : null;

              const lineAnnotations = annotationKey !== null
                ? (annotationsByLine.get(annotationKey) ?? [])
                : [];
              const lineComments = getRowComments(
                prCommentsByLine,
                line.oldLineNumber,
                line.newLineNumber,
              );
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
                  {hasComments && lineNumber !== null && (
                    <div ref={lineNumber === highlightCommentLine ? highlightLineRef : undefined}>
                      <DiffCommentThread
                        comments={lineComments}
                        expanded={commentsExpanded}
                        onToggle={() => toggleCommentLine(lineNumber)}
                        onSendToClaude={onSendToClaude}
                        repoPath={repoPath}
                        prNumber={prNumber}
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
                </SyntaxDiffLine>
              );
            })}
          </div>
        );
      })}

      {(expandedGaps.get("bottom") ?? []).map((line, li) => (
        <SyntaxDiffLine
          key={`exp-bottom-${li}`}
          content={line.content}
          lineType={line.lineType}
          oldLineNumber={line.oldLineNumber}
          newLineNumber={line.newLineNumber}
          filePath={file.path}
          searchQuery={searchQuery}
        />
      ))}

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

export { UnifiedDiffBody };
export type { UnifiedDiffBodyProps };
