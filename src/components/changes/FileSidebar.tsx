import { useCallback, useMemo, useState } from "react";
import { Check } from "lucide-react";
import type { DiffFile, CommitInfo } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";

type ViewMode = "all" | "commits";

interface FileSidebarProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  uncommittedFiles: DiffFile[];
  committedFiles: DiffFile[];
  commits: CommitInfo[];
  selectedCommitIndex: number | null;
  onSelectCommit: (index: number) => void;
  activeFilePath: string | null;
  collapsedFiles: Set<string>;
  onSelectFile: (path: string) => void;
  reviewedFiles: Set<string>;
  onToggleReviewed: (path: string) => void;
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

function FileRow({
  file,
  isActive,
  isCollapsed,
  isReviewed,
  onSelect,
  onToggleReviewed,
}: {
  file: DiffFile;
  isActive: boolean;
  isCollapsed: boolean;
  isReviewed: boolean;
  onSelect: () => void;
  onToggleReviewed: () => void;
}) {
  const filename = file.path.split("/").pop() ?? file.path;

  return (
    <button
      onClick={onSelect}
      className={[
        "flex items-center gap-1.5 w-full px-2.5 py-1 text-left text-xs",
        "hover:bg-bg-hover transition-colors",
        isActive ? "bg-bg-hover text-text-primary" : "text-text-secondary",
        isCollapsed ? "opacity-50" : "",
        isReviewed ? "opacity-60" : "",
      ].join(" ")}
    >
      <span
        className={[
          "text-[9px] font-semibold px-1 py-px rounded-sm flex-shrink-0",
          STATUS_BADGE_CLASSES[file.status] ?? "",
        ].join(" ")}
      >
        {STATUS_LETTER[file.status] ?? "?"}
      </span>
      <span className="truncate flex-1" title={file.path}>{filename}</span>
      <span className="text-text-tertiary text-[10px] flex-shrink-0">
        {file.additions > 0 && <span className="text-diff-added">+{file.additions}</span>}
        {file.deletions > 0 && <span className="text-diff-removed ml-1">-{file.deletions}</span>}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); onToggleReviewed(); }}
        className={[
          "flex-shrink-0 w-3.5 h-3.5 rounded-sm border flex items-center justify-center",
          isReviewed
            ? "bg-accent-primary/20 border-accent-primary/40 text-accent-primary"
            : "border-border-subtle text-transparent hover:border-border-hover hover:text-text-tertiary",
        ].join(" ")}
      >
        <Check size={8} />
      </button>
    </button>
  );
}

function FileSidebar({
  viewMode,
  onViewModeChange,
  uncommittedFiles,
  committedFiles,
  commits,
  selectedCommitIndex,
  onSelectCommit,
  activeFilePath,
  collapsedFiles,
  onSelectFile,
  reviewedFiles,
  onToggleReviewed,
}: FileSidebarProps) {
  const [filter, setFilter] = useState("");

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      setFilter("");
      onViewModeChange(mode);
    },
    [onViewModeChange],
  );

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

  const totalItems =
    viewMode === "all"
      ? uncommittedFiles.length + committedFiles.length
      : commits.length;

  const renderFileList = useCallback(
    (files: DiffFile[]) =>
      files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          isActive={activeFilePath === file.path}
          isCollapsed={collapsedFiles.has(file.path)}
          isReviewed={reviewedFiles.has(file.path)}
          onSelect={() => onSelectFile(file.path)}
          onToggleReviewed={() => onToggleReviewed(file.path)}
        />
      )),
    [activeFilePath, collapsedFiles, reviewedFiles, onSelectFile, onToggleReviewed],
  );

  return (
    <div className="w-[200px] bg-bg-primary border-r border-border-default flex-shrink-0 flex flex-col overflow-y-auto">
      {/* All / Commits toggle */}
      <div className="flex p-1.5 gap-0">
        <button
          onClick={() => handleViewModeChange("all")}
          className={[
            "flex-1 px-2 py-1 text-[10px] border border-border-default rounded-l-md",
            viewMode === "all"
              ? "bg-accent-muted text-accent-primary border-accent-primary/40"
              : "text-text-tertiary",
          ].join(" ")}
        >
          All
        </button>
        <button
          onClick={() => handleViewModeChange("commits")}
          className={[
            "flex-1 px-2 py-1 text-[10px] border border-l-0 border-border-default rounded-r-md",
            viewMode === "commits"
              ? "bg-accent-muted text-accent-primary border-accent-primary/40"
              : "text-text-tertiary",
          ].join(" ")}
        >
          Commits
        </button>
      </div>

      {totalItems > 5 && (
        <div className="px-1.5 pb-1">
          <input
            type="text"
            placeholder="Filter files..."
            className="w-full px-2 py-1 text-[10px] bg-bg-secondary border border-border-subtle rounded text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary/40"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}

      {viewMode === "all" ? (
        <>
          {filteredUncommitted.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
                <span className="text-[9px] uppercase tracking-wider text-text-tertiary">
                  Uncommitted
                </span>
                <span className="text-[9px] bg-bg-hover px-1.5 rounded-full text-text-tertiary">
                  {filteredUncommitted.length}
                </span>
              </div>
              {renderFileList(filteredUncommitted)}
            </div>
          )}

          {filteredCommitted.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
                <span className="text-[9px] uppercase tracking-wider text-text-tertiary">
                  Committed
                </span>
                <span className="text-[9px] bg-bg-hover px-1.5 rounded-full text-text-tertiary">
                  {filteredCommitted.length}
                </span>
              </div>
              {renderFileList(filteredCommitted)}
            </div>
          )}

          {filteredUncommitted.length === 0 && filteredCommitted.length === 0 && (
            <div className="px-2.5 py-4 text-xs text-text-tertiary text-center">
              No changes
            </div>
          )}
        </>
      ) : (
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
                <div className={[
                  "text-xs leading-snug",
                  isSelected ? "text-text-primary" : "text-text-secondary",
                ].join(" ")}>
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
      )}
    </div>
  );
}

export { FileSidebar };
export type { FileSidebarProps, ViewMode };
