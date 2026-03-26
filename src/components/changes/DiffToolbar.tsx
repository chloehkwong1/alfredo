import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconButton } from "../ui";
import type { CommitInfo } from "../../types";

type DiffMode = "all" | "commit";

interface DiffToolbarProps {
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  commits: CommitInfo[];
  currentCommitIndex: number;
  onCommitStep: (index: number) => void;
  totalAdditions: number;
  totalDeletions: number;
  fileCount: number;
}

function DiffToolbar({
  mode,
  onModeChange,
  commits,
  currentCommitIndex,
  onCommitStep,
  totalAdditions,
  totalDeletions,
  fileCount,
}: DiffToolbarProps) {
  const currentCommit = commits[currentCommitIndex] ?? null;

  return (
    <div className="flex items-center gap-3 h-10 px-3 bg-bg-secondary border-b border-border-subtle flex-shrink-0">
      {/* Mode toggle */}
      <div className="flex items-center rounded-md border border-border-default overflow-hidden">
        <button
          type="button"
          onClick={() => onModeChange("all")}
          className={[
            "px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
            mode === "all"
              ? "bg-accent-primary text-white"
              : "bg-bg-primary text-text-secondary hover:text-text-primary",
          ].join(" ")}
        >
          All changes
        </button>
        <button
          type="button"
          onClick={() => onModeChange("commit")}
          className={[
            "px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer border-l border-border-default",
            mode === "commit"
              ? "bg-accent-primary text-white"
              : "bg-bg-primary text-text-secondary hover:text-text-primary",
          ].join(" ")}
        >
          Commit by commit
        </button>
      </div>

      {/* Commit stepper */}
      {mode === "commit" && commits.length > 0 && (
        <div className="flex items-center gap-1.5">
          <IconButton
            size="sm"
            label="Previous commit"
            disabled={currentCommitIndex <= 0}
            onClick={() => onCommitStep(currentCommitIndex - 1)}
          >
            <ChevronLeft />
          </IconButton>
          <span className="text-xs text-text-secondary whitespace-nowrap">
            {currentCommitIndex + 1} of {commits.length}
          </span>
          <IconButton
            size="sm"
            label="Next commit"
            disabled={currentCommitIndex >= commits.length - 1}
            onClick={() => onCommitStep(currentCommitIndex + 1)}
          >
            <ChevronRight />
          </IconButton>
          {currentCommit && (
            <span className="text-xs text-text-tertiary truncate max-w-[200px]">
              {currentCommit.message}
            </span>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Stats */}
      <span className="text-xs text-text-tertiary whitespace-nowrap">
        <span className="text-diff-added">+{totalAdditions}</span>
        {" "}
        <span className="text-diff-removed">-{totalDeletions}</span>
        {" "}across {fileCount} {fileCount === 1 ? "file" : "files"}
      </span>
    </div>
  );
}

export { DiffToolbar };
export type { DiffToolbarProps, DiffMode };
