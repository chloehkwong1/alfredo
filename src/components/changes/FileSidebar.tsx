import { useCallback } from "react";
import type { DiffFile, CommitInfo } from "../../types";

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
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  added: "bg-[rgba(74,222,128,0.15)] text-[#4ade80]",
  modified: "bg-[rgba(251,191,36,0.15)] text-[#fbbf24]",
  deleted: "bg-[rgba(248,113,113,0.15)] text-[#f87171]",
  renamed: "bg-[rgba(96,165,250,0.15)] text-[#60a5fa]",
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
  onSelect,
}: {
  file: DiffFile;
  isActive: boolean;
  isCollapsed: boolean;
  onSelect: () => void;
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
      <span className="truncate flex-1">{filename}</span>
      <span className="text-text-tertiary text-[10px] flex-shrink-0">
        {file.additions > 0 && <span className="text-[#4ade80]">+{file.additions}</span>}
        {file.deletions > 0 && <span className="text-[#f87171] ml-1">-{file.deletions}</span>}
      </span>
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
}: FileSidebarProps) {
  const renderFileList = useCallback(
    (files: DiffFile[]) =>
      files.map((file) => (
        <FileRow
          key={file.path}
          file={file}
          isActive={activeFilePath === file.path}
          isCollapsed={collapsedFiles.has(file.path)}
          onSelect={() => onSelectFile(file.path)}
        />
      )),
    [activeFilePath, collapsedFiles, onSelectFile],
  );

  return (
    <div className="w-[180px] bg-bg-primary border-r border-border-default flex-shrink-0 flex flex-col overflow-y-auto">
      {/* All / Commits toggle */}
      <div className="flex p-1.5 gap-0">
        <button
          onClick={() => onViewModeChange("all")}
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
          onClick={() => onViewModeChange("commits")}
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

      {viewMode === "all" ? (
        <>
          {uncommittedFiles.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
                <span className="text-[9px] uppercase tracking-wider text-text-tertiary">
                  Uncommitted
                </span>
                <span className="text-[9px] bg-bg-hover px-1.5 rounded-full text-text-tertiary">
                  {uncommittedFiles.length}
                </span>
              </div>
              {renderFileList(uncommittedFiles)}
            </div>
          )}

          {committedFiles.length > 0 && (
            <div>
              <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
                <span className="text-[9px] uppercase tracking-wider text-text-tertiary">
                  Committed
                </span>
                <span className="text-[9px] bg-bg-hover px-1.5 rounded-full text-text-tertiary">
                  {committedFiles.length}
                </span>
              </div>
              {renderFileList(committedFiles)}
            </div>
          )}

          {uncommittedFiles.length === 0 && committedFiles.length === 0 && (
            <div className="px-2.5 py-4 text-xs text-text-tertiary text-center">
              No changes
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between px-2.5 pt-2 pb-1">
            <span className="text-[9px] uppercase tracking-wider text-text-tertiary">
              Commits
            </span>
            <span className="text-[9px] bg-bg-hover px-1.5 rounded-full text-text-tertiary">
              {commits.length}
            </span>
          </div>
          <div className="text-[8px] uppercase tracking-wider text-text-tertiary px-2.5 pb-1">
            newest first
          </div>
          {commits.map((commit, index) => {
            const subject = commit.message.split("\n")[0];
            const body = commit.message.split("\n").slice(1).join("\n").trim();

            return (
              <button
                key={commit.hash}
                onClick={() => onSelectCommit(index)}
                className={[
                  "flex flex-col w-full px-2.5 py-1.5 text-left",
                  "hover:bg-bg-hover transition-colors",
                  selectedCommitIndex === index
                    ? "bg-bg-hover"
                    : "",
                ].join(" ")}
              >
                <div className="flex items-center gap-1.5 w-full">
                  <span className="text-[10px] font-mono text-text-tertiary flex-shrink-0">
                    {commit.shortHash}
                  </span>
                  <span className={[
                    "text-xs truncate flex-1",
                    selectedCommitIndex === index ? "text-text-primary" : "text-text-secondary",
                  ].join(" ")}>
                    {subject}
                  </span>
                </div>
                {body && (
                  <span className="text-[10px] text-text-tertiary mt-0.5 pl-[52px] line-clamp-2">
                    {body}
                  </span>
                )}
              </button>
            );
          })}

          {commits.length === 0 && (
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
