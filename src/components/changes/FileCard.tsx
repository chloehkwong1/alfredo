import { forwardRef, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AnnotationBubble } from "./AnnotationBubble";
import { AnnotationInput } from "./AnnotationInput";
import { DiffCommentIndicator } from "./DiffCommentIndicator";
import { DiffCommentThread } from "./DiffCommentThread";
import type { Annotation, DiffFile, PrComment } from "../../types";

interface FileCardProps {
  file: DiffFile;
  expanded: boolean;
  onToggleExpanded: () => void;
  annotations: Annotation[];
  activeAnnotationLine: number | null;
  onAddAnnotation: (filePath: string, lineNumber: number) => void;
  onSubmitAnnotation: (filePath: string, lineNumber: number, text: string) => void;
  onDeleteAnnotation: (id: string) => void;
  comments?: PrComment[];
}

const statusConfig: Record<
  DiffFile["status"],
  { label: string; color: string }
> = {
  added: { label: "A", color: "text-diff-added bg-diff-added/15" },
  modified: {
    label: "M",
    color: "text-accent-primary bg-accent-primary/15",
  },
  deleted: { label: "D", color: "text-diff-removed bg-diff-removed/15" },
  renamed: {
    label: "R",
    color: "text-status-waiting bg-status-waiting/15",
  },
};

const lineTypeStyles: Record<string, string> = {
  addition: "bg-diff-added/6 text-text-primary",
  deletion: "bg-diff-removed/6 text-text-primary",
  context: "text-text-tertiary",
};

const lineNumberStyles: Record<string, string> = {
  addition: "text-diff-added/60",
  deletion: "text-diff-removed/60",
  context: "text-text-tertiary/50",
};

const FileCard = forwardRef<HTMLDivElement, FileCardProps>(function FileCard(
  {
    file,
    expanded,
    onToggleExpanded,
    annotations,
    activeAnnotationLine,
    onAddAnnotation,
    onSubmitAnnotation,
    onDeleteAnnotation,
    comments,
  },
  ref,
) {
  const cfg = statusConfig[file.status];

  // Index annotations by line number for this file
  const annotationsByLine = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const ann of annotations) {
      if (ann.filePath === file.path) {
        const existing = map.get(ann.lineNumber) ?? [];
        existing.push(ann);
        map.set(ann.lineNumber, existing);
      }
    }
    return map;
  }, [annotations, file.path]);

  // Index PR comments by line number
  const commentsByLine = useMemo(() => {
    if (!comments?.length) return {} as Record<number, PrComment[]>;
    return comments.reduce<Record<number, PrComment[]>>((acc, c) => {
      if (c.line != null) {
        (acc[c.line] ??= []).push(c);
      }
      return acc;
    }, {});
  }, [comments]);

  const [expandedLines, setExpandedLines] = useState<Set<number>>(new Set());

  return (
    <div
      ref={ref}
      className="border border-border-subtle rounded-lg"
      data-file-path={file.path}
    >
      {/* Sticky file header */}
      <button
        type="button"
        onClick={onToggleExpanded}
        className="sticky top-0 z-10 w-full flex items-center gap-2 px-3 py-2 bg-bg-secondary border-b border-border-subtle cursor-pointer hover:bg-bg-hover/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-text-tertiary flex-shrink-0" />
        ) : (
          <ChevronRight
            size={14}
            className="text-text-tertiary flex-shrink-0"
          />
        )}
        <span
          className={[
            "inline-flex items-center justify-center h-4 w-4 rounded text-2xs font-bold flex-shrink-0",
            cfg.color,
          ].join(" ")}
        >
          {cfg.label}
        </span>
        <span className="text-xs font-mono text-text-primary truncate flex-1 text-left">
          {file.path}
        </span>
        <span className="text-2xs text-text-tertiary whitespace-nowrap flex-shrink-0">
          {file.additions > 0 && (
            <span className="text-diff-added">+{file.additions}</span>
          )}
          {file.additions > 0 && file.deletions > 0 && " "}
          {file.deletions > 0 && (
            <span className="text-diff-removed">-{file.deletions}</span>
          )}
        </span>
      </button>

      {/* Diff content */}
      {expanded && (
        <div className="font-mono text-xs leading-5 bg-bg-primary overflow-hidden rounded-b-lg">
          {file.hunks.map((hunk, hunkIdx) => (
            <div key={hunkIdx}>
              {/* Hunk separator for non-first hunks */}
              {hunkIdx > 0 && (
                <HunkSeparator
                  prevHunk={file.hunks[hunkIdx - 1]}
                  currentHunk={hunk}
                />
              )}

              {/* Hunk header */}
              <div className="px-4 py-1 bg-accent-primary/8 text-accent-primary text-xs select-none">
                {hunk.header}
              </div>

              {/* Lines */}
              {hunk.lines.map((line, lineIdx) => {
                const lt = line.lineType;
                const lineNum =
                  line.newLineNumber ?? line.oldLineNumber ?? 0;
                const lineAnnotations = annotationsByLine.get(lineNum);
                const isActiveLine = activeAnnotationLine === lineNum;
                const lineComments = commentsByLine[lineNum];
                const isThreadExpanded = expandedLines.has(lineNum);

                return (
                  <div key={`${hunkIdx}-${lineIdx}`}>
                    <div
                      className={[
                        "flex hover:brightness-95 cursor-pointer",
                        lineTypeStyles[lt],
                        isActiveLine
                          ? "ring-1 ring-inset ring-accent-primary"
                          : "",
                      ].join(" ")}
                      onClick={() => onAddAnnotation(file.path, lineNum)}
                    >
                      <span
                        className={[
                          "w-12 flex-shrink-0 text-right pr-2 select-none",
                          lineNumberStyles[lt],
                        ].join(" ")}
                      >
                        {line.oldLineNumber ?? ""}
                      </span>
                      <span
                        className={[
                          "w-12 flex-shrink-0 text-right pr-2 select-none",
                          lineNumberStyles[lt],
                        ].join(" ")}
                      >
                        {line.newLineNumber ?? ""}
                      </span>
                      <span className="flex-1 px-2 whitespace-pre overflow-x-auto">
                        {lt === "addition" && "+"}
                        {lt === "deletion" && "-"}
                        {lt === "context" && " "}
                        {line.content}
                      </span>
                      {lineComments && (
                        <span
                          className="flex-shrink-0 px-2 flex items-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedLines((prev) => {
                              const next = new Set(prev);
                              if (next.has(lineNum)) {
                                next.delete(lineNum);
                              } else {
                                next.add(lineNum);
                              }
                              return next;
                            });
                          }}
                        >
                          <DiffCommentIndicator
                            count={lineComments.length}
                            onClick={() => {}}
                          />
                        </span>
                      )}
                    </div>

                    {lineComments && isThreadExpanded && (
                      <DiffCommentThread comments={lineComments} />
                    )}

                    {lineAnnotations?.map((ann) => (
                      <AnnotationBubble
                        key={ann.id}
                        annotation={ann}
                        onDelete={onDeleteAnnotation}
                      />
                    ))}

                    {isActiveLine && (
                      <AnnotationInput
                        onSubmit={(text) => onSubmitAnnotation(file.path, lineNum, text)}
                        onCancel={() => onAddAnnotation(file.path, lineNum)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/** Separator showing hidden lines between hunks */
function HunkSeparator({
  prevHunk,
  currentHunk,
}: {
  prevHunk: { oldStart: number; lines: { lineType: string }[] };
  currentHunk: { oldStart: number };
}) {
  const prevEnd =
    prevHunk.oldStart +
    prevHunk.lines.filter((l) => l.lineType !== "addition").length;
  const gap = currentHunk.oldStart - prevEnd;
  if (gap <= 0) return null;

  return (
    <div className="flex items-center justify-center py-1.5 text-2xs text-text-tertiary bg-bg-secondary/50 border-y border-border-subtle select-none">
      ⋯ {gap} unchanged {gap === 1 ? "line" : "lines"} hidden
    </div>
  );
}

export { FileCard };
export type { FileCardProps };
