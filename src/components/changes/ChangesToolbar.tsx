import React from "react";
import { Search, Maximize2, Minimize2, MessageSquare, Copy, Check, ArrowUpRight, MoreHorizontal } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../ui/DropdownMenu";
import { DiffSearchBar } from "./DiffSearchBar";
import { openInEditor } from "../../api";

const EDITOR_LABELS: Record<string, string> = {
  vscode: "VS Code",
  cursor: "Cursor",
  zed: "Zed",
  vim: "Vim",
  custom: "editor",
};
import type { DiffFile, DiffViewMode, PrStatus, GlobalAppConfig } from "../../types";
import type { SearchMatch } from "../../hooks/useDiffSearch";

interface ChangesToolbarProps {
  focusedFilePath: string | null;
  displayFiles: DiffFile[];
  viewMode: "changes" | "commits";
  selectedCommitIndex: number | null;
  diffViewMode: DiffViewMode;
  setDiffViewMode: (worktreeId: string, mode: DiffViewMode) => void;
  worktreeId: string;
  repoPath: string;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  matches: SearchMatch[];
  currentMatchIndex: number;
  navigateMatch: (dir: "prev" | "next") => void;
  expandFullFile: boolean;
  setExpandFullFile: (v: boolean) => void;
  copiedPath: boolean;
  copyPath: (text: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  pr: PrStatus | null;
  showPrComments: boolean;
  setShowPrComments: (worktreeId: string, v: boolean) => void;
  appConfig: GlobalAppConfig | null;
  spikeFlagOn?: boolean;
  onOpenSpike?: () => void;
}

function ViewModeToggle({
  diffViewMode,
  setDiffViewMode,
  worktreeId,
}: {
  diffViewMode: DiffViewMode;
  setDiffViewMode: (worktreeId: string, mode: DiffViewMode) => void;
  worktreeId: string;
}) {
  return (
    <div className="flex border border-border-default rounded overflow-hidden">
      <button
        className={`px-2 py-0.5 text-[10px] transition-colors ${
          diffViewMode === "unified"
            ? "bg-accent-primary/15 text-accent-primary font-medium"
            : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
        }`}
        onClick={() => setDiffViewMode(worktreeId, "unified")}
      >
        Unified
      </button>
      <button
        className={`px-2 py-0.5 text-[10px] border-l border-border-default transition-colors ${
          diffViewMode === "split"
            ? "bg-accent-primary/15 text-accent-primary font-medium"
            : "text-text-tertiary hover:text-text-primary hover:bg-bg-hover"
        }`}
        onClick={() => setDiffViewMode(worktreeId, "split")}
      >
        Split
      </button>
    </div>
  );
}

function PrCommentsToggle({
  pr,
  showPrComments,
  setShowPrComments,
  worktreeId,
}: {
  pr: PrStatus | null;
  showPrComments: boolean;
  setShowPrComments: (worktreeId: string, v: boolean) => void;
  worktreeId: string;
}) {
  if (!pr) return null;
  return (
    <>
      <IconButton
        size="sm"
        label={showPrComments ? "Hide PR comments" : "Show PR comments"}
        className={`h-auto w-auto p-0 ${
          showPrComments ? "text-[var(--color-pr-comment)]" : "text-text-tertiary hover:text-text-primary"
        }`}
        onClick={() => setShowPrComments(worktreeId, !showPrComments)}
      >
        <MessageSquare size={12} />
      </IconButton>
      <span className="text-text-tertiary/50">|</span>
    </>
  );
}

function SearchControl({
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  searchInputRef,
  matches,
  currentMatchIndex,
  navigateMatch,
}: {
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  matches: SearchMatch[];
  currentMatchIndex: number;
  navigateMatch: (dir: "prev" | "next") => void;
}) {
  if (searchOpen) {
    return (
      <DiffSearchBar
        isOpen={searchOpen}
        onClose={() => { setSearchOpen(false); setSearchQuery(""); }}
        searchTerm={searchQuery}
        onSearchChange={setSearchQuery}
        matchCount={matches.length}
        activeMatch={currentMatchIndex}
        onPrev={() => navigateMatch("prev")}
        onNext={() => navigateMatch("next")}
        inputRef={searchInputRef}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label="Search in diffs"
      className="inline-flex items-center gap-1 h-[22px] px-2 rounded text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
      onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }}
    >
      <Search size={11} />
      Search
      <span className="ml-0.5 font-mono text-[9px] px-1 h-[14px] inline-grid place-items-center border border-border-default rounded-[3px] text-text-tertiary">⌘F</span>
    </button>
  );
}

function ChangesToolbar({
  focusedFilePath,
  displayFiles,
  viewMode,
  selectedCommitIndex,
  diffViewMode,
  setDiffViewMode,
  worktreeId,
  repoPath,
  searchOpen,
  setSearchOpen,
  searchQuery,
  setSearchQuery,
  searchInputRef,
  matches,
  currentMatchIndex,
  navigateMatch,
  expandFullFile,
  setExpandFullFile,
  copiedPath,
  copyPath,
  expandAll,
  collapseAll,
  pr,
  showPrComments,
  setShowPrComments,
  appConfig,
  spikeFlagOn,
  onOpenSpike,
}: ChangesToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-b border-border-default flex-shrink-0">
      {focusedFilePath ? (
        <>
          {/* Focused file toolbar — click path to copy */}
          <button
            type="button"
            className="flex items-center gap-1.5 min-w-0 cursor-copy group/path"
            onClick={() => copyPath(focusedFilePath)}
            title="Click to copy file path"
          >
            <span className="text-[11px] font-mono text-text-primary truncate">
              {focusedFilePath.split("/").pop()}
            </span>
            <span className="text-[10px] text-text-tertiary truncate hidden sm:inline">
              {focusedFilePath.split("/").slice(0, -1).join("/")}
            </span>
            {copiedPath
              ? <Check size={11} className="flex-shrink-0 text-diff-added" />
              : <Copy size={11} className="flex-shrink-0 text-text-tertiary opacity-0 group-hover/path:opacity-100 transition-opacity" />
            }
          </button>
          <div className="flex items-center gap-2.5 ml-auto">
            <SearchControl
              searchOpen={searchOpen}
              setSearchOpen={setSearchOpen}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              searchInputRef={searchInputRef}
              matches={matches}
              currentMatchIndex={currentMatchIndex}
              navigateMatch={navigateMatch}
            />
            {appConfig && (
              <button
                type="button"
                aria-label={`Open in ${EDITOR_LABELS[appConfig.preferredEditor] ?? "editor"}`}
                className="inline-flex items-center gap-1 h-[22px] px-2 rounded text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                onClick={() =>
                  openInEditor(
                    `${repoPath}/${focusedFilePath}`,
                    appConfig.preferredEditor,
                    appConfig.customEditorPath ?? undefined,
                  )
                }
              >
                Open in {EDITOR_LABELS[appConfig.preferredEditor] ?? "editor"}
                <ArrowUpRight size={11} />
              </button>
            )}
            <ViewModeToggle
              diffViewMode={diffViewMode}
              setDiffViewMode={setDiffViewMode}
              worktreeId={worktreeId}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="More actions"
                  className="w-[22px] h-[22px] rounded grid place-items-center text-text-tertiary hover:text-text-primary hover:bg-bg-hover transition-colors"
                >
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setExpandFullFile(!expandFullFile)}>
                  {expandFullFile ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                  {expandFullFile ? "Show diffs only" : "Show full file"}
                </DropdownMenuItem>
                {pr && (
                  <DropdownMenuItem onSelect={() => setShowPrComments(worktreeId, !showPrComments)}>
                    <MessageSquare size={14} />
                    {showPrComments ? "Hide PR comments" : "Show PR comments"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => copyPath(focusedFilePath)}>
                  {copiedPath ? <Check size={14} className="text-diff-added" /> : <Copy size={14} />}
                  Copy file path
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </>
      ) : (
        <>
          <span className="text-[10px] text-text-tertiary">
            {viewMode === "changes"
              ? `${displayFiles.length} file${displayFiles.length !== 1 ? "s" : ""}`
              : selectedCommitIndex !== null
                ? `${displayFiles.length} file${displayFiles.length !== 1 ? "s" : ""} in commit`
                : "Select a commit"}
          </span>
          {(searchOpen || displayFiles.length > 0) && (
            <div className="flex items-center gap-1.5 ml-auto">
              {/* Search within diffs — pre-mounts when searchOpen so Cmd+F works
                  even before displayFiles has loaded (e.g. just-selected commit). */}
              <SearchControl
                searchOpen={searchOpen}
                setSearchOpen={setSearchOpen}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                searchInputRef={searchInputRef}
                matches={matches}
                currentMatchIndex={currentMatchIndex}
                navigateMatch={navigateMatch}
              />
              {displayFiles.length > 0 && (
                <>
                  <span className="text-text-tertiary/50">|</span>
                  <Button size="sm" variant="ghost" className="h-auto px-0 text-[10px] text-text-tertiary hover:text-text-primary" onClick={expandAll}>
                    Expand all
                  </Button>
                  <span className="text-text-tertiary/50">|</span>
                  <Button size="sm" variant="ghost" className="h-auto px-0 text-[10px] text-text-tertiary hover:text-text-primary" onClick={collapseAll}>
                    Collapse all
                  </Button>
                  <span className="text-text-tertiary/50 mx-1">|</span>
                  <PrCommentsToggle
                    pr={pr}
                    showPrComments={showPrComments}
                    setShowPrComments={setShowPrComments}
                    worktreeId={worktreeId}
                  />
                  <ViewModeToggle
                    diffViewMode={diffViewMode}
                    setDiffViewMode={setDiffViewMode}
                    worktreeId={worktreeId}
                  />
                  {spikeFlagOn && onOpenSpike && (
                    <>
                      <span className="text-text-tertiary/50 mx-1">|</span>
                      <button
                        type="button"
                        onClick={onOpenSpike}
                        className="inline-flex items-center gap-1 h-[22px] px-2 rounded text-[11px] text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors"
                        title="Open Monaco DiffEditor spike"
                      >
                        Monaco
                      </button>
                    </>
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

export { ChangesToolbar };
export type { ChangesToolbarProps };
