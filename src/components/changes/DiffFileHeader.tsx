import { Check, ChevronDown, ChevronRight, Copy, ExternalLink, Eye, Trash2 } from "lucide-react";
import type { DiffFile, FileViewMode } from "../../types";
import { useCopyToClipboard } from "../../hooks/useCopyToClipboard";
import { openPathInEditor } from "../../services/openExternal";

// Experiment flag: set `alfredo:no-sticky-diff` to "1" to drop sticky positioning
// while debugging WebKit compositing-layer corruption in the diff view.
function isStickyDisabled(): boolean {
  return typeof window !== "undefined"
    && window.localStorage.getItem("alfredo:no-sticky-diff") === "1";
}

interface DiffFileHeaderProps {
  file: DiffFile;
  expanded: boolean;
  onToggleExpanded: (path: string) => void;
  /** Absolute repo path, used to open the file in the configured editor. */
  repoPath: string;
  onDiscardFile?: (path: string, status: string) => void;
  /** When set, renders a Diff/Rendered toggle (used for `.md` files). */
  fileViewMode?: FileViewMode;
  onChangeFileViewMode?: (mode: FileViewMode) => void;
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

function DiffFileHeader({
  file,
  expanded,
  onToggleExpanded,
  repoPath,
  onDiscardFile,
  fileViewMode,
  onChangeFileViewMode,
}: DiffFileHeaderProps) {
  const statusLabel = STATUS_LABEL[file.status];
  const statusColor = STATUS_COLOR[file.status];
  const { copied, copy } = useCopyToClipboard();

  return (
    <div
      className={[
        "group/header flex items-center gap-2 px-3 py-1.5 bg-bg-secondary border-b border-border-default cursor-pointer select-none hover:bg-bg-hover transition-colors",
        isStickyDisabled() ? "" : "sticky top-0 z-10",
      ].join(" ")}
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
      <span className="font-mono text-xs text-text-primary truncate">
        {file.path}
      </span>
      <button
        className="flex-shrink-0 opacity-0 group-hover/header:opacity-100 p-0.5 rounded text-text-tertiary hover:text-text-primary transition-all"
        onClick={(e) => {
          e.stopPropagation();
          copy(file.path);
        }}
        title="Copy file path"
      >
        {copied ? <Check size={13} className="text-diff-added" /> : <Copy size={13} />}
      </button>
      {file.status !== "deleted" && (
        <button
          className="flex-shrink-0 opacity-0 group-hover/header:opacity-100 p-0.5 rounded text-text-tertiary hover:text-text-primary transition-all"
          onClick={(e) => {
            e.stopPropagation();
            openPathInEditor(`${repoPath}/${file.path}`);
          }}
          title="Open in editor"
        >
          <ExternalLink size={13} />
        </button>
      )}
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
      {expanded && fileViewMode && onChangeFileViewMode && (
        <button
          className={[
            "flex-shrink-0 ml-auto p-0.5 rounded transition-all",
            fileViewMode === "rendered"
              ? "text-accent-primary"
              : "opacity-50 group-hover/header:opacity-100 text-text-tertiary hover:text-text-primary",
          ].join(" ")}
          onClick={(e) => {
            e.stopPropagation();
            onChangeFileViewMode(fileViewMode === "rendered" ? "diff" : "rendered");
          }}
          aria-pressed={fileViewMode === "rendered"}
          aria-label="Toggle rendered preview"
          title={fileViewMode === "rendered" ? "Show diff" : "Show rendered preview"}
        >
          <Eye size={13} />
        </button>
      )}
      {onDiscardFile && (
        <button
          className="flex-shrink-0 opacity-0 group-hover/header:opacity-100 group-focus-within:opacity-100 p-0.5 rounded text-text-tertiary hover:text-danger transition-all"
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
