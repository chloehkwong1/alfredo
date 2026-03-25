import { AnnotationBubble } from "./AnnotationBubble";
import { AnnotationInput } from "./AnnotationInput";
import type { Annotation, DiffFile } from "../../types";

interface DiffViewerProps {
  file: DiffFile | null;
  annotations: Annotation[];
  onAddAnnotation: (lineNumber: number) => void;
  onSubmitAnnotation: (lineNumber: number, text: string) => void;
  onDeleteAnnotation: (id: string) => void;
  activeAnnotationLine: number | null;
}

const lineTypeStyles: Record<string, string> = {
  addition: "bg-diff-added/10 text-text-primary",
  deletion: "bg-diff-removed/10 text-text-primary",
  context: "text-text-tertiary",
};

const lineNumberStyles: Record<string, string> = {
  addition: "text-diff-added/60",
  deletion: "text-diff-removed/60",
  context: "text-text-tertiary/50",
};

function DiffViewer({
  file,
  annotations,
  onAddAnnotation,
  onSubmitAnnotation,
  onDeleteAnnotation,
  activeAnnotationLine,
}: DiffViewerProps) {
  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-body">
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
      <div className="sticky top-0 z-10 px-4 py-2 bg-bg-secondary border-b border-border-subtle">
        <span className="text-caption font-mono text-text-secondary">
          {file.path}
        </span>
      </div>

      {/* Diff content */}
      <div className="font-mono text-caption leading-5">
        {file.hunks.map((hunk, hunkIdx) => (
          <div key={hunkIdx}>
            {/* Hunk header */}
            <div className="px-4 py-1 bg-accent-primary/8 text-accent-primary text-caption select-none">
              {hunk.header}
            </div>

            {/* Lines */}
            {hunk.lines.map((line, lineIdx) => {
              const lt = line.lineType;
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

                  {/* Inline annotations */}
                  {lineAnnotations?.map((ann) => (
                    <AnnotationBubble
                      key={ann.id}
                      annotation={ann}
                      onDelete={onDeleteAnnotation}
                    />
                  ))}

                  {/* Annotation input */}
                  {isActiveLine && (
                    <AnnotationInput
                      onSubmit={(text) => onSubmitAnnotation(lineNum, text)}
                      onCancel={() => onAddAnnotation(lineNum)}
                    />
                  )}
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
