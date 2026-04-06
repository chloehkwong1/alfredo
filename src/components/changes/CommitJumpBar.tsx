import type React from "react";
import type { DiffFile } from "../../types";

interface CommitJumpBarProps {
  displayFiles: DiffFile[];
  focusedFilePath: string | null;
  fileRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
}

function CommitJumpBar({ displayFiles, focusedFilePath, fileRefs }: CommitJumpBarProps) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border-b border-border-default overflow-x-auto flex-shrink-0">
      {displayFiles.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => {
            const el = fileRefs.current.get(file.path);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className={[
            "px-2 py-0.5 rounded text-xs whitespace-nowrap transition-colors",
            file.path === focusedFilePath
              ? "bg-accent-primary/20 text-accent-primary"
              : "bg-bg-tertiary text-text-secondary hover:text-text-primary",
          ].join(" ")}
        >
          <span className={`mr-1 font-semibold ${
            file.status === "added" ? "text-diff-added"
              : file.status === "deleted" ? "text-diff-removed"
              : file.status === "modified" ? "text-accent-primary"
              : "text-text-secondary"
          }`}>
            {file.status === "added" ? "A" : file.status === "modified" ? "M" : file.status === "deleted" ? "D" : "R"}
          </span>
          {file.path.split("/").pop()}
        </button>
      ))}
    </div>
  );
}

export { CommitJumpBar };
export type { CommitJumpBarProps };
