// src/components/changes/DiffToolbar.tsx
import { FolderTree } from "lucide-react";

type DiffMode = "all" | "commit";

interface DiffToolbarProps {
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  totalAdditions: number;
  totalDeletions: number;
  fileCount: number;
  fileTreeOpen: boolean;
  onToggleFileTree: () => void;
}

function DiffToolbar({
  mode,
  onModeChange,
  totalAdditions,
  totalDeletions,
  fileCount,
  fileTreeOpen,
  onToggleFileTree,
}: DiffToolbarProps) {
  return (
    <div className="bg-bg-secondary border-b border-border-subtle flex-shrink-0">
      <div className="flex items-center gap-3 h-10 px-3">
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
            By commit
          </button>
        </div>

        <div className="flex-1" />

        {/* Stats */}
        <span className="text-xs text-text-tertiary whitespace-nowrap">
          <span className="text-text-secondary font-medium">
            {fileCount} {fileCount === 1 ? "file" : "files"}
          </span>
          {" · "}
          <span className="text-diff-added">+{totalAdditions}</span>{" "}
          <span className="text-diff-removed">-{totalDeletions}</span>
        </span>

        {/* File tree toggle */}
        <button
          type="button"
          onClick={onToggleFileTree}
          className={[
            "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer",
            fileTreeOpen
              ? "bg-accent-primary/15 text-accent-primary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
          ].join(" ")}
        >
          <FolderTree size={14} />
          <span>File tree</span>
        </button>
      </div>
    </div>
  );
}

export { DiffToolbar };
export type { DiffToolbarProps, DiffMode };
