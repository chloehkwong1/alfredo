import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Undo2 } from "lucide-react";
import type { DiffFile, CommitInfo } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";

type ViewMode = "changes" | "commits";

interface FileSidebarProps {
  viewMode: ViewMode;
  uncommittedFiles: DiffFile[];
  committedFiles: DiffFile[];
  commits: CommitInfo[];
  selectedCommitIndex: number | null;
  onSelectCommit: (index: number) => void;
  activeFilePath: string | null;
  collapsedFiles: Set<string>;
  onSelectFile: (path: string) => void;
  onDiscardFile?: (path: string, status: string) => void;
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  added: "bg-diff-added/15 text-diff-added",
  modified: "bg-accent-primary/15 text-accent-primary",
  deleted: "bg-diff-removed/15 text-diff-removed",
  renamed: "bg-bg-hover text-text-secondary",
};

const STATUS_LETTER: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
};

const FileRow = memo(function FileRow({
  file,
  filePath,
  isActive,
  isCollapsed,
  onSelect,
  onDiscard,
}: {
  file: DiffFile;
  filePath: string;
  isActive: boolean;
  isCollapsed: boolean;
  onSelect: (path: string) => void;
  onDiscard?: (path: string, status: string) => void;
}) {
  const filename = file.path.split("/").pop() ?? file.path;

  return (
    <div
      className={[
        "group flex items-center gap-1.5 w-full px-2.5 py-1 text-left text-xs",
        "hover:bg-bg-hover transition-colors cursor-pointer",
        isActive ? "bg-bg-hover text-text-primary" : "text-text-secondary",
      ].join(" ")}
      onClick={() => onSelect(filePath)}
    >
      {isCollapsed ? (
        <ChevronRight size={12} className="flex-shrink-0 text-text-tertiary" />
      ) : (
        <ChevronDown size={12} className="flex-shrink-0 text-text-tertiary" />
      )}
      <span
        className={[
          "text-[9px] font-semibold px-1 py-px rounded-sm flex-shrink-0",
          STATUS_BADGE_CLASSES[file.status] ?? "",
        ].join(" ")}
      >
        {STATUS_LETTER[file.status] ?? "?"}
      </span>
      <span className="truncate flex-1" title={file.path}>{filename}</span>
      <span className="text-text-tertiary text-[10px] flex-shrink-0 group-hover:hidden">
        {file.additions > 0 && <span className="text-diff-added">+{file.additions}</span>}
        {file.deletions > 0 && <span className="text-diff-removed ml-1">-{file.deletions}</span>}
      </span>
      {onDiscard && (
        <button
          onClick={(e) => { e.stopPropagation(); onDiscard(file.path, file.status); }}
          className="hidden group-hover:flex group-focus-within:flex items-center p-0.5 rounded text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors flex-shrink-0"
          title="Discard changes"
        >
          <Undo2 size={12} />
        </button>
      )}
    </div>
  );
}, (prev, next) =>
  prev.filePath === next.filePath &&
  prev.isActive === next.isActive &&
  prev.isCollapsed === next.isCollapsed &&
  prev.onSelect === next.onSelect &&
  prev.onDiscard === next.onDiscard
);

function FileSidebar({
  viewMode,
  uncommittedFiles,
  committedFiles,
  commits,
  selectedCommitIndex,
  onSelectCommit,
  activeFilePath,
  collapsedFiles,
  onSelectFile,
  onDiscardFile,
}: FileSidebarProps) {
  const [filter, setFilter] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Cmd+F focuses the filter input when this component is visible
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "f") {
        // If filter input is hidden (totalItems <= 5), skip — nothing to focus
        if (!filterInputRef.current) return;

        e.preventDefault();
        e.stopPropagation();

        if (document.activeElement === filterInputRef.current) {
          // Already focused — select all text (standard Cmd+F-again behavior)
          filterInputRef.current.select();
        } else {
          filterInputRef.current.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  // Clear filter when view mode changes (e.g., switching between files and commits)
  useEffect(() => {
    setFilter("");
  }, [viewMode]);

  const filterFile = useCallback(
    (file: DiffFile) =>
      filter === "" || file.path.toLowerCase().includes(filter.toLowerCase()),
    [filter],
  );

  const filteredUncommitted = useMemo(
    () => uncommittedFiles.filter(filterFile),
    [uncommittedFiles, filterFile],
  );
  const filteredCommitted = useMemo(
    () => committedFiles.filter(filterFile),
    [committedFiles, filterFile],
  );
  const filteredCommits = useMemo(
    () =>
      filter === ""
        ? commits
        : commits.filter((c) =>
            c.message.toLowerCase().includes(filter.toLowerCase()),
          ),
    [commits, filter],
  );

  const allFiles = viewMode === "changes"
    ? uncommittedFiles.length + committedFiles.length
    : 0;
  const totalItems = viewMode === "commits" ? commits.length : allFiles;

  // Progressive rendering: show first batch, expand on demand
  const INITIAL_FILE_LIMIT = 50;
  const [showAllFiles, setShowAllFiles] = useState(false);

  // Reset when files change (e.g., tab switch)
  useEffect(() => {
    setShowAllFiles(false);
  }, [viewMode]);

  const renderFileList = useCallback(
    (filesToRender: DiffFile[], onDiscard?: (path: string, status: string) => void) =>
      filesToRender.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          filePath={file.path}
          isActive={activeFilePath === file.path}
          isCollapsed={collapsedFiles.has(file.path)}
          onSelect={onSelectFile}
          onDiscard={onDiscard}
        />
      )),
    [activeFilePath, collapsedFiles, onSelectFile],
  );

  return (
    <div className="w-full bg-bg-primary border-r border-border-default flex flex-col overflow-y-auto">
      {totalItems > 5 && (
        <div className="px-2.5 pb-1">
          <input
            ref={filterInputRef}
            type="text"
            placeholder={viewMode === "commits" ? "Filter commits..." : "Filter files..."}
            className="w-full px-2 py-1 text-[10px] bg-bg-secondary border border-border-subtle rounded text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary/40"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}

      {viewMode === "commits" ? (
        <>
          {filteredCommits.map((commit) => {
            const subject = commit.message.split("\n")[0];
            const originalIndex = commits.indexOf(commit);
            const isSelected = selectedCommitIndex === originalIndex;

            return (
              <button
                key={commit.hash}
                onClick={() => onSelectCommit(originalIndex)}
                className={[
                  "w-full px-2.5 py-1.5 text-left border-l-2",
                  "hover:bg-bg-hover transition-colors",
                  isSelected
                    ? "bg-bg-hover border-accent-primary"
                    : "border-transparent",
                ].join(" ")}
              >
                <div className="text-xs leading-snug text-text-primary font-medium">
                  {subject}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-text-tertiary">
                    {commit.shortHash}
                  </span>
                  <span className="text-[10px] text-text-tertiary">
                    {formatRelativeTime(commit.timestamp)}
                  </span>
                </div>
              </button>
            );
          })}

          {filteredCommits.length === 0 && (
            <div className="px-2.5 py-4 text-xs text-text-tertiary text-center">
              No commits
            </div>
          )}
        </>
      ) : (
        <>
          {filteredUncommitted.length === 0 && filteredCommitted.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 px-4 py-8 text-center">
              <span className="text-lg text-text-tertiary/30 mb-2">✓</span>
              <span className="text-xs text-text-tertiary">No changes on this branch</span>
              <span className="text-[10px] text-text-tertiary/60 mt-1">
                Edits you make will appear here
              </span>
            </div>
          ) : (
            <div>
              {/* Uncommitted section */}
              {filteredUncommitted.length > 0 && (
                <>
                  <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
                    <span className="text-2xs font-semibold uppercase tracking-wider text-status-busy">
                      ● Uncommitted
                    </span>
                    <span className="text-2xs bg-bg-hover px-1.5 rounded-full text-text-tertiary">
                      {filteredUncommitted.length}
                    </span>
                  </div>
                  {renderFileList(filteredUncommitted, onDiscardFile)}
                </>
              )}

              {/* Divider between sections */}
              {filteredUncommitted.length > 0 && filteredCommitted.length > 0 && (
                <div className="border-t border-border-default mx-2.5 my-1" />
              )}

              {/* Committed section */}
              {filteredCommitted.length > 0 && (
                <>
                  <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
                    <span className="text-2xs font-semibold uppercase tracking-wider text-text-tertiary">
                      Committed
                    </span>
                    <span className="text-2xs bg-bg-hover px-1.5 rounded-full text-text-tertiary">
                      {filteredCommitted.length}
                    </span>
                  </div>
                  {renderFileList(
                    showAllFiles ? filteredCommitted : filteredCommitted.slice(0, INITIAL_FILE_LIMIT),
                  )}
                  {filteredCommitted.length > INITIAL_FILE_LIMIT && !showAllFiles && (
                    <button
                      onClick={() => setShowAllFiles(true)}
                      className="w-full px-2.5 py-1.5 text-[10px] text-accent-primary hover:text-accent-primary/80 hover:bg-bg-hover transition-colors text-center"
                    >
                      Show {filteredCommitted.length - INITIAL_FILE_LIMIT} more files
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export { FileSidebar };
export type { FileSidebarProps, ViewMode };
