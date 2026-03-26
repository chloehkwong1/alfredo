// src/components/changes/StackedDiffView.tsx
import { useCallback, useEffect, useRef } from "react";
import { FileCard } from "./FileCard";
import type { Annotation, DiffFile } from "../../types";

interface StackedDiffViewProps {
  files: DiffFile[];
  expandedFiles: Set<string>;
  onToggleExpanded: (path: string) => void;
  annotations: Annotation[];
  activeAnnotationLine: number | null;
  onAddAnnotation: (filePath: string, lineNumber: number) => void;
  onSubmitAnnotation: (filePath: string, lineNumber: number, text: string) => void;
  onDeleteAnnotation: (id: string) => void;
  onVisibleFileChange: (path: string) => void;
  scrollToFile: string | null;
  onScrollComplete: () => void;
}

function StackedDiffView({
  files,
  expandedFiles,
  onToggleExpanded,
  annotations,
  activeAnnotationLine,
  onAddAnnotation,
  onSubmitAnnotation,
  onDeleteAnnotation,
  onVisibleFileChange,
  scrollToFile,
  onScrollComplete,
}: StackedDiffViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setCardRef = useCallback(
    (path: string) => (el: HTMLDivElement | null) => {
      if (el) {
        cardRefs.current.set(path, el);
      } else {
        cardRefs.current.delete(path);
      }
    },
    [],
  );

  // Intersection observer for scroll tracking
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const path = (entry.target as HTMLElement).dataset.filePath;
            if (path) {
              onVisibleFileChange(path);
              break;
            }
          }
        }
      },
      {
        root: container,
        rootMargin: "-10% 0px -80% 0px",
        threshold: 0,
      },
    );

    for (const el of cardRefs.current.values()) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [files, onVisibleFileChange]);

  // Scroll to file when requested
  useEffect(() => {
    if (!scrollToFile) return;
    const el = cardRefs.current.get(scrollToFile);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      onScrollComplete();
    }
  }, [scrollToFile, onScrollComplete]);

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        No changes to display
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto p-3 space-y-3">
      {files.map((file) => (
        <FileCard
          key={file.path}
          ref={setCardRef(file.path)}
          file={file}
          expanded={expandedFiles.has(file.path)}
          onToggleExpanded={() => onToggleExpanded(file.path)}
          annotations={annotations}
          activeAnnotationLine={activeAnnotationLine}
          onAddAnnotation={onAddAnnotation}
          onSubmitAnnotation={onSubmitAnnotation}
          onDeleteAnnotation={onDeleteAnnotation}
        />
      ))}
    </div>
  );
}

export { StackedDiffView };
export type { StackedDiffViewProps };
