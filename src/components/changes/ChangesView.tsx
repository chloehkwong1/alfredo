import { useCallback, useEffect, useState } from "react";
import { Send, Trash2, MessageSquare } from "lucide-react";
import { DiffToolbar } from "./DiffToolbar";
import { FileList } from "./FileList";
import { DiffViewer } from "./DiffViewer";
import { getDiff, getCommits, getDiffForCommit, writePty } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { sessionManager } from "../../services/sessionManager";
import { Button } from "../ui/Button";
import type { DiffFile, CommitInfo } from "../../types";
import type { DiffMode } from "./DiffToolbar";

interface ChangesViewProps {
  worktreeId: string;
  repoPath: string;
}

function ChangesView({ worktreeId, repoPath }: ChangesViewProps) {
  const [mode, setMode] = useState<DiffMode>("all");
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [currentCommitIndex, setCurrentCommitIndex] = useState(0);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [activeAnnotationLine, setActiveAnnotationLine] = useState<
    number | null
  >(null);

  const annotations =
    useWorkspaceStore((s) => s.annotations[worktreeId]) ?? [];
  const addAnnotation = useWorkspaceStore((s) => s.addAnnotation);
  const removeAnnotation = useWorkspaceStore((s) => s.removeAnnotation);
  const clearAnnotations = useWorkspaceStore((s) => s.clearAnnotations);

  // Load diff data based on mode
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (mode === "all") {
          const diffFiles = await getDiff(repoPath);
          if (!cancelled) {
            setFiles(diffFiles);
            setSelectedFilePath(diffFiles[0]?.path ?? null);
          }
        } else {
          const commitList = await getCommits(repoPath);
          if (cancelled) return;
          setCommits(commitList);

          if (commitList.length > 0) {
            const idx = Math.min(currentCommitIndex, commitList.length - 1);
            setCurrentCommitIndex(idx);
            const diffFiles = await getDiffForCommit(
              repoPath,
              commitList[idx].hash,
            );
            if (!cancelled) {
              setFiles(diffFiles);
              setSelectedFilePath(diffFiles[0]?.path ?? null);
            }
          } else {
            setFiles([]);
            setSelectedFilePath(null);
          }
        }
      } catch (err) {
        console.error("Failed to load diff data:", err);
        if (!cancelled) {
          setFiles([]);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // Re-run when mode changes. For commit mode, we also load on index change below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, repoPath]);

  // Load diff when stepping through commits
  useEffect(() => {
    if (mode !== "commit" || commits.length === 0) return;

    let cancelled = false;
    async function loadCommitDiff() {
      try {
        const diffFiles = await getDiffForCommit(
          repoPath,
          commits[currentCommitIndex].hash,
        );
        if (!cancelled) {
          setFiles(diffFiles);
          setSelectedFilePath(diffFiles[0]?.path ?? null);
        }
      } catch (err) {
        console.error("Failed to load commit diff:", err);
      }
    }

    loadCommitDiff();
    return () => {
      cancelled = true;
    };
  }, [mode, commits, currentCommitIndex, repoPath]);

  const handleModeChange = useCallback((newMode: DiffMode) => {
    setMode(newMode);
    setCurrentCommitIndex(0);
    setActiveAnnotationLine(null);
  }, []);

  const handleCommitStep = useCallback((index: number) => {
    setCurrentCommitIndex(index);
    setActiveAnnotationLine(null);
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedFilePath(path);
    setActiveAnnotationLine(null);
  }, []);

  const handleAddAnnotation = useCallback((lineNumber: number) => {
    setActiveAnnotationLine((prev) =>
      prev === lineNumber ? null : lineNumber,
    );
  }, []);

  const handleSubmitAnnotation = useCallback(
    (lineNumber: number, text: string) => {
      const commitHash =
        mode === "commit" && commits.length > 0
          ? commits[currentCommitIndex].hash
          : null;
      addAnnotation({
        id: crypto.randomUUID(),
        worktreeId,
        filePath: selectedFilePath ?? "",
        lineNumber,
        commitHash,
        text,
        createdAt: Date.now(),
      });
      setActiveAnnotationLine(null);
    },
    [worktreeId, selectedFilePath, mode, commits, currentCommitIndex, addAnnotation],
  );

  const handleDeleteAnnotation = useCallback(
    (annotationId: string) => {
      removeAnnotation(worktreeId, annotationId);
    },
    [worktreeId, removeAnnotation],
  );

  const handleSendToClaude = useCallback(async () => {
    if (annotations.length === 0) return;

    // Find the first Claude session for this worktree
    const tabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];
    const claudeTab = tabs.find((t) => t.type === "claude");
    const targetKey = claudeTab?.id ?? worktreeId;

    const session = sessionManager.getSession(targetKey);
    if (!session) return;

    const lines = annotations.map(
      (a) => `Feedback on ${a.filePath}:${a.lineNumber} — ${a.text}`,
    );
    const message = "\n" + lines.join("\n") + "\n";
    const bytes = Array.from(new TextEncoder().encode(message));
    await writePty(session.sessionId, bytes);
    clearAnnotations(worktreeId);
  }, [worktreeId, annotations, clearAnnotations]);

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);
  const selectedFile = files.find((f) => f.path === selectedFilePath) ?? null;

  // Filter annotations to current commit when in commit-by-commit mode
  const filteredAnnotations =
    mode === "commit" && commits.length > 0
      ? annotations.filter(
          (a) => a.commitHash === commits[currentCommitIndex].hash,
        )
      : annotations;

  return (
    <div className="flex flex-col h-full">
      {annotations.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-accent-primary/8 border-b border-accent-primary/20 flex-shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-accent-primary font-medium">
            <MessageSquare size={14} />
            <span>
              {annotations.length}{" "}
              {annotations.length === 1 ? "annotation" : "annotations"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <Button size="sm" variant="primary" onClick={handleSendToClaude}>
              <Send size={12} />
              Send to Claude
            </Button>
            <Button size="sm" variant="ghost" onClick={() => clearAnnotations(worktreeId)}>
              <Trash2 size={12} />
              Clear
            </Button>
          </div>
        </div>
      )}
      <DiffToolbar
        mode={mode}
        onModeChange={handleModeChange}
        commits={commits}
        currentCommitIndex={currentCommitIndex}
        onCommitStep={handleCommitStep}
        totalAdditions={totalAdditions}
        totalDeletions={totalDeletions}
        fileCount={files.length}
      />
      <div className="flex flex-1 min-h-0">
        <FileList
          files={files}
          selectedPath={selectedFilePath}
          onSelectFile={handleSelectFile}
        />
        <DiffViewer
          file={selectedFile}
          annotations={filteredAnnotations}
          onAddAnnotation={handleAddAnnotation}
          onSubmitAnnotation={handleSubmitAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          activeAnnotationLine={activeAnnotationLine}
        />
      </div>
    </div>
  );
}

export { ChangesView };
export type { ChangesViewProps };
