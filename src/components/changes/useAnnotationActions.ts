import { useCallback, useRef, useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { lifecycleManager } from "../../services/lifecycleManager";
import type { Annotation, CommitInfo, DiffSide } from "../../types";

export type ActiveAnnotationLine = {
  filePath: string;
  lineNumber: number;
  side: DiffSide;
} | null;

export function useAnnotationActions(
  worktreeId: string,
  viewMode: "changes" | "commits",
  selectedCommitIndex: number | null,
  commits: CommitInfo[],
) {
  const [activeAnnotationLine, setActiveAnnotationLine] = useState<ActiveAnnotationLine>(null);

  const annotations: Annotation[] = useWorkspaceStore((s) => s.annotations[worktreeId]) ?? [];
  const addAnnotation = useWorkspaceStore((s) => s.addAnnotation);
  const removeAnnotation = useWorkspaceStore((s) => s.removeAnnotation);
  const editAnnotation = useWorkspaceStore((s) => s.editAnnotation);
  const clearAnnotations = useWorkspaceStore((s) => s.clearAnnotations);

  // Use ref to avoid re-creating callback when commits array changes from polling
  const commitsRef = useRef(commits);
  commitsRef.current = commits;

  const handleAddAnnotation = useCallback(
    (filePath: string, lineNumber: number, side: DiffSide) => {
      setActiveAnnotationLine((prev) => {
        const toggling = prev?.filePath === filePath && prev?.lineNumber === lineNumber && prev?.side === side;
        return toggling ? null : { filePath, lineNumber, side };
      });
    },
    [],
  );

  const handleSubmitAnnotation = useCallback(
    (filePath: string, lineNumber: number, side: DiffSide, text: string) => {
      lifecycleManager.pinCurrentPreview(worktreeId);
      const currentCommits = commitsRef.current;
      const commitHash =
        viewMode === "commits" && selectedCommitIndex !== null && currentCommits.length > 0
          ? currentCommits[selectedCommitIndex].hash
          : null;
      addAnnotation({
        id: crypto.randomUUID(),
        worktreeId,
        filePath,
        lineNumber,
        side,
        commitHash,
        text,
        createdAt: Date.now(),
      });
      setActiveAnnotationLine(null);
    },
    [worktreeId, viewMode, selectedCommitIndex, addAnnotation],
  );

  const handleDeleteAnnotation = useCallback(
    (annotationId: string) => {
      removeAnnotation(worktreeId, annotationId);
    },
    [worktreeId, removeAnnotation],
  );

  const handleEditAnnotation = useCallback(
    (annotationId: string, newText: string) => {
      editAnnotation(worktreeId, annotationId, newText);
    },
    [worktreeId, editAnnotation],
  );

  const resetActiveAnnotation = useCallback(() => {
    setActiveAnnotationLine(null);
  }, []);

  return {
    annotations,
    activeAnnotationLine,
    handleAddAnnotation,
    handleSubmitAnnotation,
    handleDeleteAnnotation,
    handleEditAnnotation,
    clearAnnotations,
    resetActiveAnnotation,
  };
}
