import type { DiffFile } from "../../types";

interface FileListProps {
  files: DiffFile[];
  selectedPath: string | null;
  onSelectFile: (path: string) => void;
}

const statusConfig: Record<
  DiffFile["status"],
  { label: string; color: string }
> = {
  added: { label: "A", color: "text-diff-added bg-diff-added/15" },
  modified: { label: "M", color: "text-accent-primary bg-accent-primary/15" },
  deleted: { label: "D", color: "text-diff-removed bg-diff-removed/15" },
  renamed: { label: "R", color: "text-status-waiting bg-status-waiting/15" },
};

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function FileList({ files, selectedPath, onSelectFile }: FileListProps) {
  return (
    <div className="w-[220px] flex-shrink-0 border-r border-border-default flex flex-col bg-bg-primary overflow-y-auto">
      <div className="px-3 py-2 text-xs font-semibold text-text-tertiary uppercase tracking-wider">
        Changed files
      </div>
      <div className="flex-1">
        {files.map((file) => {
          const isSelected = file.path === selectedPath;
          const cfg = statusConfig[file.status];
          return (
            <button
              key={file.path}
              type="button"
              onClick={() => onSelectFile(file.path)}
              className={[
                "w-full flex items-center gap-2 px-3 py-1.5 text-left cursor-pointer transition-colors",
                isSelected
                  ? "bg-bg-hover border-l-2 border-l-accent-primary"
                  : "border-l-2 border-l-transparent hover:bg-bg-hover/50",
              ].join(" ")}
            >
              <span
                className={[
                  "inline-flex items-center justify-center h-4 w-4 rounded text-[10px] font-bold flex-shrink-0",
                  cfg.color,
                ].join(" ")}
              >
                {cfg.label}
              </span>
              <span className="text-xs text-text-primary truncate flex-1">
                {basename(file.path)}
              </span>
              <span className="text-[10px] text-text-tertiary whitespace-nowrap flex-shrink-0">
                {file.additions > 0 && (
                  <span className="text-diff-added">+{file.additions}</span>
                )}
                {file.additions > 0 && file.deletions > 0 && " "}
                {file.deletions > 0 && (
                  <span className="text-diff-removed">-{file.deletions}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export { FileList };
export type { FileListProps };
