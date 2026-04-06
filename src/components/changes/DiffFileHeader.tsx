import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import type { DiffFile } from "../../types";

interface DiffFileHeaderProps {
  file: DiffFile;
  expanded: boolean;
  onToggleExpanded: (path: string) => void;
  onDiscardFile?: (path: string, status: string) => void;
}

const STATUS_LABEL: Record<DiffFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

const STATUS_COLOR: Record<DiffFile["status"], string> = {
  added: "text-diff-added bg-diff-added/10",
  modified: "text-accent-primary bg-accent-primary/10",
  deleted: "text-diff-removed bg-diff-removed/10",
  renamed: "text-text-secondary bg-bg-hover",
};

function DiffFileHeader({ file, expanded, onToggleExpanded, onDiscardFile }: DiffFileHeaderProps) {
  const statusLabel = STATUS_LABEL[file.status];
  const statusColor = STATUS_COLOR[file.status];

  return (
    <div
      className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border-b border-border-default cursor-pointer select-none hover:bg-bg-hover transition-colors"
      onClick={() => onToggleExpanded(file.path)}
    >
      <span className="text-text-tertiary flex-shrink-0">
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </span>
      <span
        className={[
          "flex-shrink-0 w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center",
          statusColor,
        ].join(" ")}
      >
        {statusLabel}
      </span>
      <span className="flex-1 font-mono text-xs text-text-primary truncate">
        {file.path}
      </span>
      {(file.additions > 0 || file.deletions > 0) && (
        <span className="flex items-center gap-1.5 flex-shrink-0 text-[11px] font-mono">
          {file.additions > 0 && (
            <span className="text-diff-added">+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-diff-removed">-{file.deletions}</span>
          )}
        </span>
      )}
      {onDiscardFile && (
        <button
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 p-0.5 rounded text-text-tertiary hover:text-danger transition-all"
          onClick={(e) => {
            e.stopPropagation();
            onDiscardFile(file.path, file.status);
          }}
          title="Discard changes"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

export { DiffFileHeader };
export type { DiffFileHeaderProps };
