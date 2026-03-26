type DiffMode = "all" | "commit";

interface DiffToolbarProps {
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  totalAdditions: number;
  totalDeletions: number;
  fileCount: number;
}

function DiffToolbar({
  mode,
  onModeChange,
  totalAdditions,
  totalDeletions,
  fileCount,
}: DiffToolbarProps) {
  return (
    <div className="bg-bg-secondary border-b border-border-subtle flex-shrink-0">
      <div className="flex items-center gap-3 h-10 px-3">
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

        <span className="text-xs text-text-tertiary whitespace-nowrap">
          <span className="text-diff-added">+{totalAdditions}</span>{" "}
          <span className="text-diff-removed">-{totalDeletions}</span>{" "}
          across {fileCount} {fileCount === 1 ? "file" : "files"}
        </span>
      </div>
    </div>
  );
}

export { DiffToolbar };
export type { DiffToolbarProps, DiffMode };
