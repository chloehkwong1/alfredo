import type { Annotation, DiffFile, DiffLine } from "../../types";

interface DiffViewerProps {
  file: DiffFile | null;
  annotations: Annotation[];
  onAddAnnotation: (lineNumber: number) => void;
  activeAnnotationLine: number | null;
}

/**
 * Normalize a DiffLine coming from the Rust backend.
 * The backend serializes `line_type` as `lineType` (camelCase),
 * but the TS interface declares `type`. Handle both shapes.
 */
function getLineType(
  line: DiffLine,
): "context" | "addition" | "deletion" {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (line as any).lineType ?? line.type ?? "context";
}

const lineTypeStyles: Record<string, string> = {
  addition: "bg-status-busy/10 text-text-primary",
  deletion: "bg-status-error/10 text-text-primary",
  context: "text-text-tertiary",
};

const lineNumberStyles: Record<string, string> = {
  addition: "text-status-busy/60",
  deletion: "text-status-error/60",
  context: "text-text-tertiary/50",
};

function DiffViewer({
  file,
  annotations,
  onAddAnnotation,
  activeAnnotationLine,
}: DiffViewerProps) {
  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        Select a file to view changes
      </div>
    );
  }

  // Index annotations by line number for quick lookup
  const annotationsByLine = new Map<number, Annotation[]>();
  for (const ann of annotations) {
    if (ann.filePath === file.path) {
      const existing = annotationsByLine.get(ann.lineNumber) ?? [];
      existing.push(ann);
      annotationsByLine.set(ann.lineNumber, existing);
    }
  }

  return (
    <div className="flex-1 overflow-auto bg-bg-primary">
      {/* File header */}
      <div className="sticky top-0 z-10 px-4 py-2 bg-bg-secondary border-b border-border-default">
        <span className="text-xs font-mono text-text-secondary">
          {file.path}
        </span>
      </div>

      {/* Diff content */}
      <div className="font-mono text-xs leading-5">
        {file.hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx}>
            {/* Hunk header */}
            <div className="px-4 py-1 bg-accent-primary/8 text-accent-primary text-xs select-none">
              {hunk.header}
            </div>

            {/* Lines */}
            {hunk.lines.map((line, lineIdx) => {
              const lt = getLineType(line);
              const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0;
              const lineAnnotations = annotationsByLine.get(lineNum);
              const isActiveLine = activeAnnotationLine === lineNum;

              return (
                <div key={`${hunkIdx}-${lineIdx}`}>
                  <div
                    className={[
                      "flex hover:brightness-95 cursor-pointer",
                      lineTypeStyles[lt],
                      isActiveLine ? "ring-1 ring-inset ring-accent-primary" : "",
                    ].join(" ")}
                    onClick={() => onAddAnnotation(lineNum)}
                  >
                    {/* Old line number */}
                    <span
                      className={[
                        "w-12 flex-shrink-0 text-right pr-2 select-none",
                        lineNumberStyles[lt],
                      ].join(" ")}
                    >
                      {line.oldLineNumber ?? ""}
                    </span>
                    {/* New line number */}
                    <span
                      className={[
                        "w-12 flex-shrink-0 text-right pr-2 select-none",
                        lineNumberStyles[lt],
                      ].join(" ")}
                    >
                      {line.newLineNumber ?? ""}
                    </span>
                    {/* Content */}
                    <span className="flex-1 px-2 whitespace-pre overflow-x-auto">
                      {lt === "addition" && "+"}
                      {lt === "deletion" && "-"}
                      {lt === "context" && " "}
                      {line.content}
                    </span>
                  </div>

                  {/* Inline annotations (placeholder for AnnotationBubble from Task 8) */}
                  {lineAnnotations?.map((ann) => (
                    <div
                      key={ann.id}
                      className="ml-24 mr-4 my-1 px-3 py-1.5 rounded-md bg-accent-primary/10 border border-accent-primary/20 text-xs text-text-secondary"
                    >
                      {ann.text}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export { DiffViewer };
export type { DiffViewerProps };
