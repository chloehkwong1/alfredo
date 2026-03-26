# Changes View Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar+diff split changes view with a GitHub PR-style stacked file card layout and a toggleable right-side file tree.

**Architecture:** Stacked `FileCard` components render all changed files vertically. A `FileTreeSidebar` on the right provides directory-grouped navigation with scroll tracking via intersection observer. The existing `ChangesView` orchestrator is rewired to compose these new components instead of the old `FileList` + `DiffViewer` split.

**Tech Stack:** React, TypeScript, Tailwind CSS, Lucide icons, existing Alfredo design tokens

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `src/components/changes/FileCard.tsx` | Single file's diff rendered as a collapsible card with sticky header, hunks, diff lines, annotations |
| Create | `src/components/changes/HiddenLinesIndicator.tsx` | "⋯ N unchanged lines hidden" separator between hunks |
| Create | `src/components/changes/StackedDiffView.tsx` | Renders all FileCards vertically, manages intersection observer for scroll tracking |
| Create | `src/components/changes/FileTreeSidebar.tsx` | Right-side toggleable sidebar with directory-grouped file navigation |
| Modify | `src/components/changes/DiffToolbar.tsx` | Add file tree toggle button, rearrange stats layout |
| Modify | `src/components/changes/ChangesView.tsx` | Replace left panel split with stacked view + right sidebar, add new state |
| Delete | `src/components/changes/FileList.tsx` | Replaced by FileTreeSidebar |
| Delete | `src/components/changes/DiffViewer.tsx` | Replaced by StackedDiffView + FileCard |

---

### Task 1: FileCard Component

The core building block — a single file's diff rendered as a collapsible card.

**Files:**
- Create: `src/components/changes/FileCard.tsx`

**Depends on:** Nothing (leaf component)

- [ ] **Step 1: Create FileCard with collapsible header and diff lines**

```tsx
// src/components/changes/FileCard.tsx
import { forwardRef, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { AnnotationBubble } from "./AnnotationBubble";
import { AnnotationInput } from "./AnnotationInput";
import type { Annotation, DiffFile } from "../../types";

interface FileCardProps {
  file: DiffFile;
  expanded: boolean;
  onToggleExpanded: () => void;
  annotations: Annotation[];
  activeAnnotationLine: number | null;
  onAddAnnotation: (lineNumber: number) => void;
  onSubmitAnnotation: (lineNumber: number, text: string) => void;
  onDeleteAnnotation: (id: string) => void;
}

const statusConfig: Record<
  DiffFile["status"],
  { label: string; color: string }
> = {
  added: { label: "A", color: "text-diff-added bg-diff-added/15" },
  modified: {
    label: "M",
    color: "text-accent-primary bg-accent-primary/15",
  },
  deleted: { label: "D", color: "text-diff-removed bg-diff-removed/15" },
  renamed: {
    label: "R",
    color: "text-status-waiting bg-status-waiting/15",
  },
};

const lineTypeStyles: Record<string, string> = {
  addition: "bg-diff-added/6 text-text-primary",
  deletion: "bg-diff-removed/6 text-text-primary",
  context: "text-text-tertiary",
};

const lineNumberStyles: Record<string, string> = {
  addition: "text-diff-added/60",
  deletion: "text-diff-removed/60",
  context: "text-text-tertiary/50",
};

const FileCard = forwardRef<HTMLDivElement, FileCardProps>(function FileCard(
  {
    file,
    expanded,
    onToggleExpanded,
    annotations,
    activeAnnotationLine,
    onAddAnnotation,
    onSubmitAnnotation,
    onDeleteAnnotation,
  },
  ref,
) {
  const cfg = statusConfig[file.status];

  // Index annotations by line number for this file
  const annotationsByLine = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const ann of annotations) {
      if (ann.filePath === file.path) {
        const existing = map.get(ann.lineNumber) ?? [];
        existing.push(ann);
        map.set(ann.lineNumber, existing);
      }
    }
    return map;
  }, [annotations, file.path]);

  return (
    <div
      ref={ref}
      className="border border-border-subtle rounded-lg overflow-hidden"
      data-file-path={file.path}
    >
      {/* Sticky file header */}
      <button
        type="button"
        onClick={onToggleExpanded}
        className="sticky top-0 z-10 w-full flex items-center gap-2 px-3 py-2 bg-bg-secondary border-b border-border-subtle cursor-pointer hover:bg-bg-hover/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-text-tertiary flex-shrink-0" />
        ) : (
          <ChevronRight
            size={14}
            className="text-text-tertiary flex-shrink-0"
          />
        )}
        <span
          className={[
            "inline-flex items-center justify-center h-4 w-4 rounded text-2xs font-bold flex-shrink-0",
            cfg.color,
          ].join(" ")}
        >
          {cfg.label}
        </span>
        <span className="text-xs font-mono text-text-primary truncate flex-1 text-left">
          {file.path}
        </span>
        <span className="text-2xs text-text-tertiary whitespace-nowrap flex-shrink-0">
          {file.additions > 0 && (
            <span className="text-diff-added">+{file.additions}</span>
          )}
          {file.additions > 0 && file.deletions > 0 && " "}
          {file.deletions > 0 && (
            <span className="text-diff-removed">-{file.deletions}</span>
          )}
        </span>
      </button>

      {/* Diff content */}
      {expanded && (
        <div className="font-mono text-xs leading-5">
          {file.hunks.map((hunk, hunkIdx) => (
            <div key={hunkIdx}>
              {/* Hunk separator for non-first hunks */}
              {hunkIdx > 0 && (
                <HunkSeparator
                  prevHunk={file.hunks[hunkIdx - 1]}
                  currentHunk={hunk}
                />
              )}

              {/* Hunk header */}
              <div className="px-4 py-1 bg-accent-primary/8 text-accent-primary text-xs select-none">
                {hunk.header}
              </div>

              {/* Lines */}
              {hunk.lines.map((line, lineIdx) => {
                const lt = line.lineType;
                const lineNum =
                  line.newLineNumber ?? line.oldLineNumber ?? 0;
                const lineAnnotations = annotationsByLine.get(lineNum);
                const isActiveLine = activeAnnotationLine === lineNum;

                return (
                  <div key={`${hunkIdx}-${lineIdx}`}>
                    <div
                      className={[
                        "flex hover:brightness-95 cursor-pointer",
                        lineTypeStyles[lt],
                        isActiveLine
                          ? "ring-1 ring-inset ring-accent-primary"
                          : "",
                      ].join(" ")}
                      onClick={() => onAddAnnotation(lineNum)}
                    >
                      <span
                        className={[
                          "w-12 flex-shrink-0 text-right pr-2 select-none",
                          lineNumberStyles[lt],
                        ].join(" ")}
                      >
                        {line.oldLineNumber ?? ""}
                      </span>
                      <span
                        className={[
                          "w-12 flex-shrink-0 text-right pr-2 select-none",
                          lineNumberStyles[lt],
                        ].join(" ")}
                      >
                        {line.newLineNumber ?? ""}
                      </span>
                      <span className="flex-1 px-2 whitespace-pre overflow-x-auto">
                        {lt === "addition" && "+"}
                        {lt === "deletion" && "-"}
                        {lt === "context" && " "}
                        {line.content}
                      </span>
                    </div>

                    {lineAnnotations?.map((ann) => (
                      <AnnotationBubble
                        key={ann.id}
                        annotation={ann}
                        onDelete={onDeleteAnnotation}
                      />
                    ))}

                    {isActiveLine && (
                      <AnnotationInput
                        onSubmit={(text) => onSubmitAnnotation(lineNum, text)}
                        onCancel={() => onAddAnnotation(lineNum)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/** Separator showing hidden lines between hunks */
function HunkSeparator({
  prevHunk,
  currentHunk,
}: {
  prevHunk: { oldStart: number; lines: { lineType: string }[] };
  currentHunk: { oldStart: number };
}) {
  const prevEnd =
    prevHunk.oldStart +
    prevHunk.lines.filter((l) => l.lineType !== "addition").length;
  const gap = currentHunk.oldStart - prevEnd;
  if (gap <= 0) return null;

  return (
    <div className="flex items-center justify-center py-1.5 text-2xs text-text-tertiary bg-bg-secondary/50 border-y border-border-subtle select-none">
      ⋯ {gap} unchanged {gap === 1 ? "line" : "lines"} hidden
    </div>
  );
}

export { FileCard };
export type { FileCardProps };
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to FileCard.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/FileCard.tsx
git commit -m "feat(changes): add FileCard component for stacked diff layout"
```

---

### Task 2: StackedDiffView Component

Renders all FileCards vertically and tracks which file is currently visible via intersection observer.

**Files:**
- Create: `src/components/changes/StackedDiffView.tsx`

**Depends on:** Task 1 (FileCard)

- [ ] **Step 1: Create StackedDiffView with intersection observer**

```tsx
// src/components/changes/StackedDiffView.tsx
import { useCallback, useEffect, useRef } from "react";
import { FileCard } from "./FileCard";
import type { Annotation, DiffFile } from "../../types";

interface StackedDiffViewProps {
  files: DiffFile[];
  expandedFiles: Set<string>;
  onToggleExpanded: (path: string) => void;
  annotations: Annotation[];
  activeAnnotationLine: number | null;
  onAddAnnotation: (lineNumber: number) => void;
  onSubmitAnnotation: (lineNumber: number, text: string) => void;
  onDeleteAnnotation: (id: string) => void;
  onVisibleFileChange: (path: string) => void;
  scrollToFile: string | null;
  onScrollComplete: () => void;
}

function StackedDiffView({
  files,
  expandedFiles,
  onToggleExpanded,
  annotations,
  activeAnnotationLine,
  onAddAnnotation,
  onSubmitAnnotation,
  onDeleteAnnotation,
  onVisibleFileChange,
  scrollToFile,
  onScrollComplete,
}: StackedDiffViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setCardRef = useCallback(
    (path: string) => (el: HTMLDivElement | null) => {
      if (el) {
        cardRefs.current.set(path, el);
      } else {
        cardRefs.current.delete(path);
      }
    },
    [],
  );

  // Intersection observer for scroll tracking
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const path = (entry.target as HTMLElement).dataset.filePath;
            if (path) {
              onVisibleFileChange(path);
              break;
            }
          }
        }
      },
      {
        root: container,
        rootMargin: "-10% 0px -80% 0px",
        threshold: 0,
      },
    );

    for (const el of cardRefs.current.values()) {
      observer.observe(el);
    }

    return () => observer.disconnect();
  }, [files, onVisibleFileChange]);

  // Scroll to file when requested
  useEffect(() => {
    if (!scrollToFile) return;
    const el = cardRefs.current.get(scrollToFile);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      onScrollComplete();
    }
  }, [scrollToFile, onScrollComplete]);

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-tertiary text-sm">
        No changes to display
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-auto p-3 space-y-3">
      {files.map((file) => (
        <FileCard
          key={file.path}
          ref={setCardRef(file.path)}
          file={file}
          expanded={expandedFiles.has(file.path)}
          onToggleExpanded={() => onToggleExpanded(file.path)}
          annotations={annotations}
          activeAnnotationLine={activeAnnotationLine}
          onAddAnnotation={onAddAnnotation}
          onSubmitAnnotation={onSubmitAnnotation}
          onDeleteAnnotation={onDeleteAnnotation}
        />
      ))}
    </div>
  );
}

export { StackedDiffView };
export type { StackedDiffViewProps };
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to StackedDiffView.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/StackedDiffView.tsx
git commit -m "feat(changes): add StackedDiffView with intersection observer scroll tracking"
```

---

### Task 3: FileTreeSidebar Component

Right-side toggleable sidebar with directory-grouped file navigation.

**Files:**
- Create: `src/components/changes/FileTreeSidebar.tsx`

**Depends on:** Nothing (leaf component)

- [ ] **Step 1: Create FileTreeSidebar**

```tsx
// src/components/changes/FileTreeSidebar.tsx
import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { CommitList } from "./CommitList";
import type { CommitInfo, DiffFile } from "../../types";

interface FileTreeSidebarProps {
  files: DiffFile[];
  visibleFilePath: string | null;
  onSelectFile: (path: string) => void;
  /** Commit mode props — when present, shows commit list above file tree */
  commits?: CommitInfo[];
  selectedCommitIndex?: number;
  onSelectCommit?: (index: number) => void;
}

const statusConfig: Record<
  DiffFile["status"],
  { label: string; color: string }
> = {
  added: { label: "A", color: "text-diff-added bg-diff-added/15" },
  modified: {
    label: "M",
    color: "text-accent-primary bg-accent-primary/15",
  },
  deleted: { label: "D", color: "text-diff-removed bg-diff-removed/15" },
  renamed: {
    label: "R",
    color: "text-status-waiting bg-status-waiting/15",
  },
};

interface DirectoryGroup {
  dir: string;
  files: DiffFile[];
}

function groupByDirectory(files: DiffFile[]): DirectoryGroup[] {
  const groups = new Map<string, DiffFile[]>();
  for (const file of files) {
    const lastSlash = file.path.lastIndexOf("/");
    const dir = lastSlash >= 0 ? file.path.slice(0, lastSlash + 1) : "";
    const existing = groups.get(dir) ?? [];
    existing.push(file);
    groups.set(dir, existing);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, files]) => ({ dir, files }));
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function FileTreeSidebar({
  files,
  visibleFilePath,
  onSelectFile,
  commits,
  selectedCommitIndex,
  onSelectCommit,
}: FileTreeSidebarProps) {
  const groups = useMemo(() => groupByDirectory(files), [files]);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  function toggleDir(dir: string) {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) {
        next.delete(dir);
      } else {
        next.add(dir);
      }
      return next;
    });
  }

  const showCommitList =
    commits && commits.length > 0 && onSelectCommit && selectedCommitIndex !== undefined;

  return (
    <div className="w-[220px] flex-shrink-0 border-l border-border-subtle bg-bg-secondary flex flex-col min-h-0">
      {/* Commit list (commit mode only) */}
      {showCommitList && (
        <CommitList
          commits={commits}
          selectedIndex={selectedCommitIndex}
          onSelect={onSelectCommit}
        />
      )}

      {/* File tree */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="px-3 py-2 text-xs font-semibold text-text-tertiary uppercase tracking-wider flex-shrink-0">
          Files
        </div>
        <div className="flex-1 overflow-y-auto">
          {groups.map((group) => {
            const isCollapsed = collapsedDirs.has(group.dir);
            return (
              <div key={group.dir}>
                {/* Directory header */}
                {group.dir && (
                  <button
                    type="button"
                    onClick={() => toggleDir(group.dir)}
                    className="w-full flex items-center gap-1 px-3 py-1 text-2xs text-text-tertiary hover:text-text-secondary cursor-pointer"
                  >
                    {isCollapsed ? (
                      <ChevronRight size={10} />
                    ) : (
                      <ChevronDown size={10} />
                    )}
                    <span className="truncate">{group.dir}</span>
                  </button>
                )}

                {/* Files in directory */}
                {!isCollapsed &&
                  group.files.map((file) => {
                    const isVisible = file.path === visibleFilePath;
                    const cfg = statusConfig[file.status];
                    const isDeleted = file.status === "deleted";

                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => onSelectFile(file.path)}
                        className={[
                          "w-full flex items-center gap-2 py-1.5 text-left cursor-pointer transition-colors",
                          group.dir ? "pl-6 pr-3" : "px-3",
                          isVisible
                            ? "bg-bg-hover border-l-2 border-l-accent-primary"
                            : "border-l-2 border-l-transparent hover:bg-bg-hover/50",
                        ].join(" ")}
                      >
                        <span
                          className={[
                            "inline-flex items-center justify-center h-4 w-4 rounded text-2xs font-bold flex-shrink-0",
                            cfg.color,
                          ].join(" ")}
                        >
                          {cfg.label}
                        </span>
                        <span
                          className={[
                            "text-xs truncate flex-1",
                            isDeleted
                              ? "text-text-tertiary line-through opacity-60"
                              : "text-text-primary",
                          ].join(" ")}
                        >
                          {basename(file.path)}
                        </span>
                        <span className="text-2xs whitespace-nowrap flex-shrink-0">
                          {file.additions > 0 && (
                            <span className="text-diff-added">
                              +{file.additions}
                            </span>
                          )}
                          {file.additions > 0 && file.deletions > 0 && " "}
                          {file.deletions > 0 && (
                            <span className="text-diff-removed">
                              -{file.deletions}
                            </span>
                          )}
                        </span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { FileTreeSidebar };
export type { FileTreeSidebarProps };
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to FileTreeSidebar.tsx

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/FileTreeSidebar.tsx
git commit -m "feat(changes): add FileTreeSidebar with directory grouping and scroll highlight"
```

---

### Task 4: Update DiffToolbar

Add file tree toggle button on the right side of the toolbar.

**Files:**
- Modify: `src/components/changes/DiffToolbar.tsx`

**Depends on:** Nothing

- [ ] **Step 1: Update DiffToolbar to include file tree toggle**

Replace the entire contents of `src/components/changes/DiffToolbar.tsx` with:

```tsx
// src/components/changes/DiffToolbar.tsx
import { FolderTree } from "lucide-react";

type DiffMode = "all" | "commit";

interface DiffToolbarProps {
  mode: DiffMode;
  onModeChange: (mode: DiffMode) => void;
  totalAdditions: number;
  totalDeletions: number;
  fileCount: number;
  fileTreeOpen: boolean;
  onToggleFileTree: () => void;
}

function DiffToolbar({
  mode,
  onModeChange,
  totalAdditions,
  totalDeletions,
  fileCount,
  fileTreeOpen,
  onToggleFileTree,
}: DiffToolbarProps) {
  return (
    <div className="bg-bg-secondary border-b border-border-subtle flex-shrink-0">
      <div className="flex items-center gap-3 h-10 px-3">
        {/* Mode toggle */}
        <div className="flex items-center rounded-md border border-border-default overflow-hidden">
          <button
            type="button"
            onClick={() => onModeChange("all")}
            className={[
              "px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
              mode === "all"
                ? "bg-accent-primary text-white"
                : "bg-bg-primary text-text-secondary hover:text-text-primary",
            ].join(" ")}
          >
            All changes
          </button>
          <button
            type="button"
            onClick={() => onModeChange("commit")}
            className={[
              "px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer border-l border-border-default",
              mode === "commit"
                ? "bg-accent-primary text-white"
                : "bg-bg-primary text-text-secondary hover:text-text-primary",
            ].join(" ")}
          >
            By commit
          </button>
        </div>

        <div className="flex-1" />

        {/* Stats */}
        <span className="text-xs text-text-tertiary whitespace-nowrap">
          <span className="text-text-secondary font-medium">
            {fileCount} {fileCount === 1 ? "file" : "files"}
          </span>
          {" · "}
          <span className="text-diff-added">+{totalAdditions}</span>{" "}
          <span className="text-diff-removed">-{totalDeletions}</span>
        </span>

        {/* File tree toggle */}
        <button
          type="button"
          onClick={onToggleFileTree}
          className={[
            "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer",
            fileTreeOpen
              ? "bg-accent-primary/15 text-accent-primary"
              : "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
          ].join(" ")}
        >
          <FolderTree size={14} />
          <span>File tree</span>
        </button>
      </div>
    </div>
  );
}

export { DiffToolbar };
export type { DiffToolbarProps, DiffMode };
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: Errors about missing props in ChangesView.tsx (expected — we update that in Task 5)

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/DiffToolbar.tsx
git commit -m "feat(changes): add file tree toggle to DiffToolbar"
```

---

### Task 5: Rewire ChangesView Orchestrator

Replace the old sidebar+diff split with the new stacked view + right sidebar layout. This is the integration task.

**Files:**
- Modify: `src/components/changes/ChangesView.tsx`
- Delete: `src/components/changes/FileList.tsx`
- Delete: `src/components/changes/DiffViewer.tsx`

**Depends on:** Tasks 1-4

- [ ] **Step 1: Rewrite ChangesView**

Replace the entire contents of `src/components/changes/ChangesView.tsx` with:

```tsx
// src/components/changes/ChangesView.tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Send, Trash2, MessageSquare } from "lucide-react";
import { DiffToolbar } from "./DiffToolbar";
import { CommitDetailBar } from "./CommitDetailBar";
import { StackedDiffView } from "./StackedDiffView";
import { FileTreeSidebar } from "./FileTreeSidebar";
import { getDiff, getCommits, getDiffForCommit, writePty } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { sessionManager } from "../../services/sessionManager";
import { Button } from "../ui/Button";
import type { DiffFile, CommitInfo } from "../../types";
import type { DiffMode } from "./DiffToolbar";

interface ChangesViewProps {
  worktreeId: string;
  repoPath: string;
}

function ChangesView({ worktreeId, repoPath }: ChangesViewProps) {
  const [mode, setMode] = useState<DiffMode>("all");
  const [files, setFiles] = useState<DiffFile[]>([]);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [currentCommitIndex, setCurrentCommitIndex] = useState(0);
  const [activeAnnotationLine, setActiveAnnotationLine] = useState<
    number | null
  >(null);

  // New state for redesigned layout
  const [fileTreeOpen, setFileTreeOpen] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());
  const [visibleFilePath, setVisibleFilePath] = useState<string | null>(null);
  const [scrollToFile, setScrollToFile] = useState<string | null>(null);

  const annotations =
    useWorkspaceStore((s) => s.annotations[worktreeId]) ?? [];
  const addAnnotation = useWorkspaceStore((s) => s.addAnnotation);
  const removeAnnotation = useWorkspaceStore((s) => s.removeAnnotation);
  const clearAnnotations = useWorkspaceStore((s) => s.clearAnnotations);

  // Expand all files by default when files change
  useEffect(() => {
    setExpandedFiles(new Set(files.map((f) => f.path)));
  }, [files]);

  // Load diff data based on mode
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (mode === "all") {
          const diffFiles = await getDiff(repoPath);
          if (!cancelled) {
            setFiles(diffFiles);
          }
        } else {
          const commitList = await getCommits(repoPath);
          if (cancelled) return;
          setCommits(commitList);

          if (commitList.length > 0) {
            const idx = Math.min(currentCommitIndex, commitList.length - 1);
            setCurrentCommitIndex(idx);
            const diffFiles = await getDiffForCommit(
              repoPath,
              commitList[idx].hash,
            );
            if (!cancelled) {
              setFiles(diffFiles);
            }
          } else {
            setFiles([]);
          }
        }
      } catch (err) {
        console.error("Failed to load diff data:", err);
        if (!cancelled) {
          setFiles([]);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, repoPath]);

  // Load diff when stepping through commits
  useEffect(() => {
    if (mode !== "commit" || commits.length === 0) return;

    let cancelled = false;
    async function loadCommitDiff() {
      try {
        const diffFiles = await getDiffForCommit(
          repoPath,
          commits[currentCommitIndex].hash,
        );
        if (!cancelled) {
          setFiles(diffFiles);
        }
      } catch (err) {
        console.error("Failed to load commit diff:", err);
      }
    }

    loadCommitDiff();
    return () => {
      cancelled = true;
    };
  }, [mode, commits, currentCommitIndex, repoPath]);

  const handleModeChange = useCallback((newMode: DiffMode) => {
    setMode(newMode);
    setCurrentCommitIndex(0);
    setActiveAnnotationLine(null);
  }, []);

  const handleCommitStep = useCallback((index: number) => {
    setCurrentCommitIndex(index);
    setActiveAnnotationLine(null);
  }, []);

  const handleToggleExpanded = useCallback((path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleFileTreeSelect = useCallback((path: string) => {
    setScrollToFile(path);
  }, []);

  const handleScrollComplete = useCallback(() => {
    setScrollToFile(null);
  }, []);

  const handleVisibleFileChange = useCallback((path: string) => {
    setVisibleFilePath(path);
  }, []);

  const handleAddAnnotation = useCallback((lineNumber: number) => {
    setActiveAnnotationLine((prev) =>
      prev === lineNumber ? null : lineNumber,
    );
  }, []);

  const handleSubmitAnnotation = useCallback(
    (lineNumber: number, text: string) => {
      const commitHash =
        mode === "commit" && commits.length > 0
          ? commits[currentCommitIndex].hash
          : null;
      addAnnotation({
        id: crypto.randomUUID(),
        worktreeId,
        filePath: visibleFilePath ?? files[0]?.path ?? "",
        lineNumber,
        commitHash,
        text,
        createdAt: Date.now(),
      });
      setActiveAnnotationLine(null);
    },
    [
      worktreeId,
      visibleFilePath,
      files,
      mode,
      commits,
      currentCommitIndex,
      addAnnotation,
    ],
  );

  const handleDeleteAnnotation = useCallback(
    (annotationId: string) => {
      removeAnnotation(worktreeId, annotationId);
    },
    [worktreeId, removeAnnotation],
  );

  const handleSendToClaude = useCallback(async () => {
    if (annotations.length === 0) return;

    const tabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];
    const claudeTab = tabs.find((t) => t.type === "claude");
    const targetKey = claudeTab?.id ?? worktreeId;

    const session = sessionManager.getSession(targetKey);
    if (!session) return;

    const lines = annotations.map(
      (a) => `Feedback on ${a.filePath}:${a.lineNumber} — ${a.text}`,
    );
    const message = "\n" + lines.join("\n") + "\n";
    const bytes = Array.from(new TextEncoder().encode(message));
    await writePty(session.sessionId, bytes);
    clearAnnotations(worktreeId);
  }, [worktreeId, annotations, clearAnnotations]);

  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  // Filter annotations to current commit when in commit-by-commit mode
  const filteredAnnotations = useMemo(
    () =>
      mode === "commit" && commits.length > 0
        ? annotations.filter(
            (a) => a.commitHash === commits[currentCommitIndex].hash,
          )
        : annotations,
    [mode, commits, currentCommitIndex, annotations],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Annotation status bar */}
      {annotations.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-accent-primary/8 border-b border-accent-primary/20 flex-shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-accent-primary font-medium">
            <MessageSquare size={14} />
            <span>
              {annotations.length}{" "}
              {annotations.length === 1 ? "annotation" : "annotations"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <Button size="sm" variant="primary" onClick={handleSendToClaude}>
              <Send size={12} />
              Send to Claude
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => clearAnnotations(worktreeId)}
            >
              <Trash2 size={12} />
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <DiffToolbar
        mode={mode}
        onModeChange={handleModeChange}
        totalAdditions={totalAdditions}
        totalDeletions={totalDeletions}
        fileCount={files.length}
        fileTreeOpen={fileTreeOpen}
        onToggleFileTree={() => setFileTreeOpen((prev) => !prev)}
      />

      {/* Commit detail bar (commit mode only) */}
      {mode === "commit" && commits.length > 0 && (
        <CommitDetailBar commit={commits[currentCommitIndex]} />
      )}

      {/* Main content: stacked diffs + optional file tree */}
      <div className="flex flex-1 min-h-0">
        <StackedDiffView
          files={files}
          expandedFiles={expandedFiles}
          onToggleExpanded={handleToggleExpanded}
          annotations={filteredAnnotations}
          activeAnnotationLine={activeAnnotationLine}
          onAddAnnotation={handleAddAnnotation}
          onSubmitAnnotation={handleSubmitAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          onVisibleFileChange={handleVisibleFileChange}
          scrollToFile={scrollToFile}
          onScrollComplete={handleScrollComplete}
        />

        {/* Right sidebar */}
        {fileTreeOpen && (
          <FileTreeSidebar
            files={files}
            visibleFilePath={visibleFilePath}
            onSelectFile={handleFileTreeSelect}
            commits={mode === "commit" ? commits : undefined}
            selectedCommitIndex={
              mode === "commit" ? currentCommitIndex : undefined
            }
            onSelectCommit={mode === "commit" ? handleCommitStep : undefined}
          />
        )}
      </div>
    </div>
  );
}

export { ChangesView };
export type { ChangesViewProps };
```

- [ ] **Step 2: Delete old components**

```bash
rm src/components/changes/FileList.tsx src/components/changes/DiffViewer.tsx
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors. If there are import errors from other files referencing FileList or DiffViewer, grep for them and remove.

- [ ] **Step 4: Check for stale imports**

Run: `cd /Users/chloe/dev/alfredo && grep -r "FileList\|DiffViewer" src/ --include="*.tsx" --include="*.ts" -l`
Expected: Only FileCard.tsx (which doesn't import them). If any other files reference the deleted components, update their imports.

- [ ] **Step 5: Commit**

```bash
git add -A src/components/changes/
git commit -m "feat(changes): rewire ChangesView to stacked layout with right sidebar

Replace sidebar+diff split with stacked FileCards and toggleable
FileTreeSidebar. Remove old FileList and DiffViewer components."
```

---

### Task 6: Add Sidebar Slide Transition

The sidebar currently appears/disappears instantly. Add a smooth 200ms slide transition.

**Files:**
- Modify: `src/components/changes/ChangesView.tsx`

**Depends on:** Task 5

- [ ] **Step 1: Update the sidebar rendering in ChangesView**

In `src/components/changes/ChangesView.tsx`, replace the right sidebar section:

```tsx
// OLD:
        {/* Right sidebar */}
        {fileTreeOpen && (
          <FileTreeSidebar
```

```tsx
// NEW:
        {/* Right sidebar with slide transition */}
        <div
          className={[
            "transition-all duration-200 ease-in-out overflow-hidden",
            fileTreeOpen ? "w-[220px]" : "w-0",
          ].join(" ")}
        >
          {fileTreeOpen && (
            <FileTreeSidebar
```

And close the wrapping `</div>` after the `FileTreeSidebar` closing tag. The full replacement block becomes:

```tsx
        {/* Right sidebar with slide transition */}
        <div
          className={[
            "transition-all duration-200 ease-in-out overflow-hidden flex-shrink-0",
            fileTreeOpen ? "w-[220px]" : "w-0",
          ].join(" ")}
        >
          {fileTreeOpen && (
            <FileTreeSidebar
              files={files}
              visibleFilePath={visibleFilePath}
              onSelectFile={handleFileTreeSelect}
              commits={mode === "commit" ? commits : undefined}
              selectedCommitIndex={
                mode === "commit" ? currentCommitIndex : undefined
              }
              onSelectCommit={mode === "commit" ? handleCommitStep : undefined}
            />
          )}
        </div>
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/ChangesView.tsx
git commit -m "feat(changes): add smooth slide transition to file tree sidebar"
```

---

### Task 7: Visual Verify

Open the app and verify the redesigned changes view works end-to-end.

**Files:** None (manual verification)

**Depends on:** Task 6

- [ ] **Step 1: Build and launch**

Run: `cd /Users/chloe/dev/alfredo && npm run tauri dev`

- [ ] **Step 2: Verify "All changes" mode**

Navigate to a worktree with changes and open the Changes tab. Verify:
- All changed files render as stacked cards with rounded borders
- Each card has a sticky header with file path, status badge, +/- stats, collapse chevron
- Clicking the chevron collapses/expands the card
- Diff lines show with correct colors (green additions, red deletions, muted context)
- Hunk headers display with accent background
- Hidden lines separators appear between non-adjacent hunks

- [ ] **Step 3: Verify file tree sidebar**

Click the "File tree" button in the toolbar:
- Sidebar slides in from the right with smooth animation
- Files are grouped by directory with disclosure triangles
- Currently visible file is highlighted as you scroll
- Clicking a file scrolls to that card
- Clicking toggle again slides the sidebar away

- [ ] **Step 4: Verify "By commit" mode**

Switch to "By commit" mode:
- Commit detail bar appears above stacked files
- File tree sidebar (if open) shows commit list above file tree
- Switching commits updates the stacked file cards

- [ ] **Step 5: Verify annotations**

Click a diff line to annotate:
- Annotation input appears inline below the line
- Submitting creates an annotation bubble
- Annotation status bar appears at top with count
- "Send to Claude" and "Clear" buttons work

- [ ] **Step 6: Commit any fixes**

If any visual issues are found during verification, fix them and commit:
```bash
git add -A src/components/changes/
git commit -m "fix(changes): visual polish from manual verification"
```
