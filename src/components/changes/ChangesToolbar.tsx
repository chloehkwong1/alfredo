import React from "react";
import { Search, Maximize2, Minimize2, MessageSquare, Copy, Check, ExternalLink } from "lucide-react";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { DiffSearchBar } from "./DiffSearchBar";
import { openInEditor } from "../../api";
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
  setCopiedPath: (v: boolean) => void;
  expandAll: () => void;
  collapseAll: () => void;
  pr: PrStatus | null;
  showPrComments: boolean;
  setShowPrComments: (worktreeId: string, v: boolean) => void;
  appConfig: GlobalAppConfig | null;
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
    <IconButton
      size="sm"
      label="Search in diffs (/)"
      className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary"
      onClick={() => { setSearchOpen(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }}
    >
      <Search size={12} />
    </IconButton>
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
  setCopiedPath,
  expandAll,
  collapseAll,
  pr,
  showPrComments,
  setShowPrComments,
  appConfig,
}: ChangesToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-b border-border-default flex-shrink-0">
      {focusedFilePath ? (
        <>
          {/* Focused file toolbar — click path to copy */}
          <button
            type="button"
            className="flex items-center gap-1.5 min-w-0 cursor-copy group/path"
            onClick={() => {
              navigator.clipboard.writeText(focusedFilePath);
              setCopiedPath(true);
              setTimeout(() => setCopiedPath(false), 1500);
            }}
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
          <div className="flex items-center gap-1.5 ml-auto">
            <IconButton
              size="sm"
              label="Open in editor"
              className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary"
              onClick={() => {
                if (appConfig) {
                  openInEditor(
                    `${repoPath}/${focusedFilePath}`,
                    appConfig.preferredEditor,
                    appConfig.customEditorPath ?? undefined,
                  );
                }
              }}
            >
              <ExternalLink size={12} />
            </IconButton>
            <span className="text-text-tertiary/50">|</span>
            <IconButton
              size="sm"
              label={expandFullFile ? "Show diffs only" : "Expand full file"}
              className="h-auto w-auto p-0 text-text-tertiary hover:text-text-primary"
              onClick={() => setExpandFullFile(!expandFullFile)}
            >
              {expandFullFile ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </IconButton>
            <span className="text-text-tertiary/50">|</span>
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
            <span className="text-text-tertiary/50">|</span>
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
          {displayFiles.length > 0 && (
            <div className="flex items-center gap-1.5 ml-auto">
              {/* Search within diffs */}
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
            </div>
          )}
        </>
      )}
    </div>
  );
}

export { ChangesToolbar };
export type { ChangesToolbarProps };
