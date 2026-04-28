import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Copy, ExternalLink, MessageCircle, Undo2 } from "lucide-react";
import type { DiffFile, CommitInfo, PrComment } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "../ui/ContextMenu";
import { openPathInEditor } from "../../services/openExternal";


type ViewMode = "changes" | "commits";

interface FileSidebarProps {
  viewMode: ViewMode;
  uncommittedFiles: DiffFile[];
  committedFiles: DiffFile[];
  commits: CommitInfo[];
  upstreamCommits: CommitInfo[];
  gitUser: string | null;
  selectedCommitIndex: number | null;
  onSelectCommit: (index: number) => void;
  activeFilePath: string | null;
  activeFileIsUncommitted?: boolean;
  onSelectFile: (path: string, isUncommitted: boolean) => void;
  onDiscardFile?: (path: string, status: string) => void;
  onDiscardAllUncommitted?: () => void;
  prComments?: PrComment[];
  onDoubleClickFile?: (path: string) => void;
  onDoubleClickCommit?: (index: number) => void;
  worktreePath?: string;
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
  isCopied,
  commentCount,
  onSelect,
  onDiscard,
  onDoubleClick,
  onCopyPath,
  worktreePath,
}: {
  file: DiffFile;
  filePath: string;
  isActive: boolean;
  isCopied: boolean;
  commentCount: number;
  onSelect: (path: string) => void;
  onDiscard?: (path: string, status: string) => void;
  onDoubleClick?: (path: string) => void;
  onCopyPath: (path: string) => void;
  worktreePath?: string;
}) {
  const filename = file.path.split("/").pop() ?? file.path;
  // Directory prefix without the trailing slash; the slash is rendered separately
  // so `direction: rtl` on the dimmed dir doesn't flip it to the visual left and
  // smush against the filename (e.g. "/designsros-2104...").
  const parentPath = file.path.slice(0, file.path.length - filename.length).replace(/\/$/, "");

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={[
            "group flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left text-[13px]",
            "hover:bg-bg-hover transition-colors cursor-pointer",
            isActive ? "bg-bg-hover text-text-primary" : "text-text-secondary",
          ].join(" ")}
          onClick={() => onSelect(filePath)}
          onDoubleClick={() => onDoubleClick?.(filePath)}
        >
          <span
            className={[
              "text-[10px] font-semibold px-1 py-px rounded-sm flex-shrink-0",
              STATUS_BADGE_CLASSES[file.status] ?? "",
            ].join(" ")}
          >
            {STATUS_LETTER[file.status] ?? "?"}
          </span>
          {/* Path-first display: dimmed directory prefix that left-truncates on
              overflow (direction: rtl makes the ellipsis land on the left and
              anchors the text against the filename); filename at the row's
              default emphasis. Don't add text-align or unicode-bidi here —
              both fight the rtl trick and bring back the mid-word clipping. */}
          <span className="flex-1 flex items-baseline min-w-0 overflow-hidden" title={file.path}>
            {parentPath && (
              <>
                <span
                  className="text-text-tertiary overflow-hidden whitespace-nowrap min-w-0"
                  style={{
                    direction: "rtl",
                    textOverflow: "ellipsis",
                  }}
                >
                  {parentPath}
                </span>
                <span className="shrink-0 text-text-tertiary">/</span>
              </>
            )}
            <span className="shrink-0 font-medium">{filename}</span>
          </span>
          {commentCount > 0 && (
            <span className="flex items-center gap-0.5 text-[11px] text-[var(--color-pr-comment)] flex-shrink-0" title={`${commentCount} comment${commentCount > 1 ? "s" : ""}`}>
              <MessageCircle size={10} />
              {commentCount > 1 && commentCount}
            </span>
          )}
          {isCopied ? (
            <span className="text-accent-primary text-[11px] flex-shrink-0 group-hover:hidden">Copied!</span>
          ) : (
            <span className="text-text-tertiary text-[11px] flex-shrink-0 group-hover:hidden">
              {file.additions > 0 && <span className="text-diff-added">+{file.additions}</span>}
              {file.deletions > 0 && <span className="text-diff-removed ml-1">-{file.deletions}</span>}
            </span>
          )}
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onCopyPath(file.path)}>
          <Copy className="h-4 w-4" />
          Copy Relative Path
        </ContextMenuItem>
        {worktreePath && (
          <ContextMenuItem onSelect={() => onCopyPath(`${worktreePath}/${file.path}`)}>
            <Copy className="h-4 w-4" />
            Copy Path
          </ContextMenuItem>
        )}
        {worktreePath && file.status !== "deleted" && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => openPathInEditor(`${worktreePath}/${file.path}`)}>
              <ExternalLink className="h-4 w-4" />
              Open in Editor
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}, (prev, next) =>
  prev.filePath === next.filePath &&
  prev.isActive === next.isActive &&
  prev.isCopied === next.isCopied &&
  prev.commentCount === next.commentCount &&
  prev.onSelect === next.onSelect &&
  prev.onDiscard === next.onDiscard &&
  prev.onDoubleClick === next.onDoubleClick &&
  prev.onCopyPath === next.onCopyPath &&
  prev.worktreePath === next.worktreePath
);

function FileSidebar({
  viewMode,
  uncommittedFiles,
  committedFiles,
  commits,
  upstreamCommits,
  gitUser,
  selectedCommitIndex,
  onSelectCommit,
  activeFilePath,
  activeFileIsUncommitted,
  onSelectFile,
  onDiscardFile,
  onDiscardAllUncommitted,
  prComments = [],
  onDoubleClickFile,
  onDoubleClickCommit,
  worktreePath,
}: FileSidebarProps) {
  const [filter, setFilter] = useState("");
  const [upstreamExpanded, setUpstreamExpanded] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).catch(console.error);
    setCopiedPath(path);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedPath(null), 1500);
  }, []);

  useEffect(() => {
    return () => clearTimeout(copiedTimerRef.current);
  }, []);

  // Build per-file comment counts from PR comments
  const commentCountByFile = useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of prComments) {
      if (comment.path) {
        counts.set(comment.path, (counts.get(comment.path) ?? 0) + 1);
      }
    }
    return counts;
  }, [prComments]);
  const filterInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const firstCommitRef = useRef<HTMLButtonElement>(null);
  const pendingCommitFocusRef = useRef(false);

  // Cmd+F focuses the filter input — scoped to this sidebar so it doesn't
  // steal Cmd+F from terminal panes or other surfaces in a split layout.
  useEffect(() => {
    const root = sidebarRef.current;
    if (!root) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey && e.key === "f")) return;
      // When viewing a commit, hand off to the diff search. FileSidebar lives
      // outside ChangesView's subtree, so a passive bail-out wouldn't reach it.
      if (selectedCommitIndex !== null) {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("alfredo:open-diff-search"));
        return;
      }
      // If filter input is hidden (totalItems <= 5 or commits view), skip
      if (!filterInputRef.current) return;

      e.preventDefault();
      e.stopPropagation();

      if (document.activeElement === filterInputRef.current) {
        filterInputRef.current.select();
      } else {
        filterInputRef.current.focus();
      }
    };

    root.addEventListener("keydown", handleKeyDown);
    return () => root.removeEventListener("keydown", handleKeyDown);
  }, [selectedCommitIndex]);

  // Clear filter when view mode changes (e.g., switching between files and commits)
  useEffect(() => {
    setFilter("");
  }, [viewMode]);

  // Arm a latch when entering commits view; the next effect consumes it once
  // commits are loaded. This avoids refocusing when new commits arrive later.
  useEffect(() => {
    pendingCommitFocusRef.current = viewMode === "commits";
  }, [viewMode]);

  useEffect(() => {
    if (pendingCommitFocusRef.current && commits.length > 0) {
      firstCommitRef.current?.focus();
      pendingCommitFocusRef.current = false;
    }
  }, [commits.length, viewMode]);

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
  const filteredCommits = useMemo(() => [...commits].reverse(), [commits]);

  const filteredUpstream = useMemo(
    () => (upstreamExpanded ? [...upstreamCommits].reverse() : []),
    [upstreamCommits, upstreamExpanded],
  );

  const allFiles = viewMode === "changes"
    ? uncommittedFiles.length + committedFiles.length
    : 0;
  const totalItems = viewMode === "commits"
    ? commits.length + upstreamCommits.length
    : allFiles;

  // Progressive rendering: show first batch, expand on demand
  const INITIAL_FILE_LIMIT = 50;
  const [showAllFiles, setShowAllFiles] = useState(false);

  // Reset when files change (e.g., tab switch)
  useEffect(() => {
    setShowAllFiles(false);
  }, [viewMode]);

  const renderFileList = useCallback(
    (filesToRender: DiffFile[], isUncommitted: boolean, onDiscard?: (path: string, status: string) => void) =>
      filesToRender.map((file) => (
        <FileRow
          key={`${isUncommitted ? "u" : "c"}:${file.path}`}
          file={file}
          filePath={file.path}
          isActive={
            activeFilePath === file.path &&
            (activeFileIsUncommitted === undefined || activeFileIsUncommitted === isUncommitted)
          }
          isCopied={copiedPath === file.path}
          commentCount={commentCountByFile.get(file.path) ?? 0}
          onSelect={(path: string) => onSelectFile(path, isUncommitted)}
          onDiscard={onDiscard}
          onDoubleClick={onDoubleClickFile}
          onCopyPath={handleCopyPath}
          worktreePath={worktreePath}
        />
      )),
    [activeFilePath, activeFileIsUncommitted, copiedPath, commentCountByFile, onSelectFile, onDoubleClickFile, handleCopyPath, worktreePath],
  );

  const formatAuthor = useCallback(
    (author: string) => {
      if (gitUser && author.toLowerCase() === gitUser.toLowerCase()) {
        return { text: "You", className: "text-text-tertiary" };
      }
      return { text: author, className: "text-accent-primary" };
    },
    [gitUser],
  );

  return (
    <div ref={sidebarRef} className="w-full bg-bg-primary border-r border-border-default flex flex-col overflow-y-auto">
      {totalItems > 5 && (
        <div className="px-2.5 pb-1.5">
          <input
            ref={filterInputRef}
            type="text"
            placeholder={viewMode === "commits" ? "Filter commits..." : "Filter files..."}
            className="w-full px-2 py-1 text-[11px] bg-bg-secondary border border-border-subtle rounded text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-primary/40"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}

      {viewMode === "commits" ? (
        <>
          {filteredCommits.map((commit, displayIndex) => {
            const subject = commit.message.split("\n")[0];
            const originalIndex = commits.indexOf(commit);
            const isSelected = selectedCommitIndex === originalIndex;
            const author = formatAuthor(commit.author);
            const commitNumber = originalIndex + 1;

            return (
              <button
                key={commit.hash}
                ref={displayIndex === 0 ? firstCommitRef : undefined}
                onClick={() => onSelectCommit(originalIndex)}
                onDoubleClick={() => onDoubleClickCommit?.(originalIndex)}
                className={[
                  "w-full px-2.5 py-2 text-left border-l-2",
                  "hover:bg-bg-hover transition-colors",
                  isSelected
                    ? "bg-bg-hover border-accent-primary"
                    : "border-transparent",
                ].join(" ")}
              >
                <div className="text-[13px] leading-snug text-text-primary font-medium">
                  <span className="text-[11px] text-text-tertiary font-mono mr-1.5">#{commitNumber}</span>
                  {subject}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] font-mono text-text-tertiary">
                    {commit.shortHash}
                  </span>
                  <span className="text-[11px] text-text-tertiary">·</span>
                  <span className={`text-[11px] ${author.className}`}>
                    {author.text}
                  </span>
                  <span className="text-[11px] text-text-tertiary">·</span>
                  <span className="text-[11px] text-text-tertiary">
                    {formatRelativeTime(commit.timestamp)}
                  </span>
                </div>
              </button>
            );
          })}

          {filteredCommits.length === 0 && upstreamCommits.length === 0 && (
            <div className="px-2.5 py-4 text-[13px] text-text-tertiary text-center">
              No commits
            </div>
          )}

          {/* Upstream commits: always collapsible */}
          {upstreamCommits.length > 0 && (
            <>
              <button
                onClick={() => setUpstreamExpanded((prev) => !prev)}
                className={`w-full flex items-center gap-1.5 px-2.5 py-2 text-left text-[11px] font-medium text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors${commits.length > 0 ? " border-t border-border-subtle" : ""}`}
              >
                <ChevronDown
                  size={12}
                  className={`text-text-tertiary shrink-0 transition-transform duration-150 ${upstreamExpanded ? "" : "-rotate-90"}`}
                />
                Upstream commits
              </button>

              {upstreamExpanded && filteredUpstream.map((commit) => {
                const subject = commit.message.split("\n")[0];
                const originalIndex = commits.length + upstreamCommits.indexOf(commit);
                const isSelected = selectedCommitIndex === originalIndex;
                const author = formatAuthor(commit.author);

                return (
                  <button
                    key={commit.hash}
                    onClick={() => onSelectCommit(originalIndex)}
                    onDoubleClick={() => onDoubleClickCommit?.(originalIndex)}
                    className={[
                      "w-full px-2.5 py-2 text-left border-l-2 opacity-55",
                      "hover:bg-bg-hover hover:opacity-100 transition-all",
                      isSelected
                        ? "bg-bg-hover border-accent-primary opacity-100"
                        : "border-transparent",
                    ].join(" ")}
                  >
                    <div className="text-[13px] leading-snug text-text-primary font-medium">
                      {subject}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] font-mono text-text-tertiary">
                        {commit.shortHash}
                      </span>
                      <span className="text-[11px] text-text-tertiary">·</span>
                      <span className={`text-[11px] ${author.className}`}>
                        {author.text}
                      </span>
                      <span className="text-[11px] text-text-tertiary">·</span>
                      <span className="text-[11px] text-text-tertiary">
                        {formatRelativeTime(commit.timestamp)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </>
      ) : (
        <>
          {filteredUncommitted.length === 0 && filteredCommitted.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 px-4 py-8 text-center">
              <span className="text-lg text-text-tertiary/30 mb-2">✓</span>
              <span className="text-[13px] text-text-tertiary">No changes on this branch</span>
              <span className="text-[11px] text-text-tertiary/60 mt-1">
                Edits you make will appear here
              </span>
            </div>
          ) : (
            <div>
              {/* Uncommitted section — header carries the Discard all action */}
              {filteredUncommitted.length > 0 && (
                <>
                  <div className="group flex items-center gap-2 px-2.5 pt-2.5 pb-1.5">
                    <span className="flex items-center gap-1.5 text-[11px] font-medium text-status-busy">
                      <span className="w-1.5 h-1.5 rounded-full bg-status-busy inline-block" />
                      Uncommitted
                    </span>
                    {onDiscardAllUncommitted && (
                      <button
                        type="button"
                        onClick={onDiscardAllUncommitted}
                        className="inline-flex items-center gap-1 text-[11px] text-text-tertiary hover:text-danger transition-colors px-1 py-0.5 rounded"
                        title="Discard all uncommitted changes"
                      >
                        <Undo2 size={11} />
                        Discard all
                      </button>
                    )}
                    <span className="ml-auto text-[11px] bg-bg-hover px-1.5 rounded-full text-text-tertiary">
                      {filteredUncommitted.length}
                    </span>
                  </div>
                  {renderFileList(filteredUncommitted, true, onDiscardFile)}
                </>
              )}

              {/* Divider between sections */}
              {filteredUncommitted.length > 0 && filteredCommitted.length > 0 && (
                <div className="border-t border-border-default mx-2.5 my-1" />
              )}

              {/* Committed section */}
              {filteredCommitted.length > 0 && (
                <>
                  <div className="flex items-center justify-between px-2.5 pt-2.5 pb-1.5">
                    <span className="text-[11px] font-medium text-text-tertiary">
                      Committed
                    </span>
                    <span className="text-[11px] bg-bg-hover px-1.5 rounded-full text-text-tertiary">
                      {filteredCommitted.length}
                    </span>
                  </div>
                  {renderFileList(
                    showAllFiles ? filteredCommitted : filteredCommitted.slice(0, INITIAL_FILE_LIMIT),
                    false,
                  )}
                  {filteredCommitted.length > INITIAL_FILE_LIMIT && !showAllFiles && (
                    <button
                      onClick={() => setShowAllFiles(true)}
                      className="w-full px-2.5 py-1.5 text-[11px] text-accent-primary hover:text-accent-primary/80 hover:bg-bg-hover transition-colors text-center"
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
