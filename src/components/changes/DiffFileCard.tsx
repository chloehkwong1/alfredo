import { forwardRef, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SyntaxDiffLine } from "./SyntaxDiffLine";
import { AnnotationBubble } from "./AnnotationBubble";
import { AnnotationInput } from "./AnnotationInput";
import { DiffCommentIndicator } from "./DiffCommentIndicator";
import { DiffCommentThread } from "./DiffCommentThread";
import type {
  DiffFile,
  DiffViewMode,
  Annotation,
  PrComment,
} from "../../types";

interface DiffFileCardProps {
  file: DiffFile;
  expanded: boolean;
  onToggleExpanded: () => void;
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

const DiffFileCard = forwardRef<HTMLDivElement, DiffFileCardProps>(
  function DiffFileCard(
    {
      file,
      expanded,
      onToggleExpanded,
      viewMode: _viewMode,
      annotations,
      activeAnnotationLine,
      onAddAnnotation,
      onSubmitAnnotation,
      onDeleteAnnotation,
      prComments,
    },
    ref
  ) {
    const [expandedCommentLines, setExpandedCommentLines] = useState<
      Set<number>
    >(new Set());

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

    const statusLabel = STATUS_LABEL[file.status];
    const statusColor = STATUS_COLOR[file.status];

    return (
      <div ref={ref} className="border-b border-border-default">
        {/* Sticky header */}
        <div
          className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border-b border-border-default cursor-pointer select-none hover:bg-bg-hover transition-colors"
          onClick={onToggleExpanded}
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

        {/* Diff body */}
        {expanded && (
          <div className="bg-bg-primary overflow-x-auto">
            {file.hunks.map((hunk, hunkIndex) => (
              <div key={hunkIndex}>
                {/* Hunk separator */}
                <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-y border-border-default font-mono text-[10px] text-text-tertiary select-none">
                  <span>{hunk.header}</span>
                </div>

                {/* Lines */}
                {hunk.lines.map((line, lineIndex) => {
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

                      {/* Active annotation input */}
                      {isActiveAnnotationLine && lineNumber !== null && (
                        <AnnotationInput
                          onSubmit={(text) =>
                            onSubmitAnnotation(file.path, lineNumber, text)
                          }
                          onCancel={() => onAddAnnotation(file.path, lineNumber)}
                        />
                      )}
                    </SyntaxDiffLine>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
);

export { DiffFileCard };
export type { DiffFileCardProps };
