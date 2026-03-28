# Changes & Review Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the changes review and PR review into a single unified Changes tab with syntax highlighting, a file navigation sidebar, and a collapsible PR detail panel.

**Architecture:** Rebuild the Changes tab with three zones: file sidebar (left), syntax-highlighted diff viewer (center), and collapsible PR panel (right). Remove the PR tab entirely. Add a Rust backend command for uncommitted changes. Use Shiki for frontend syntax highlighting. Activity bar rail provides at-a-glance PR status when panel is collapsed.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Zustand, Shiki (syntax highlighting), Tauri v2 (Rust + libgit2), Lucide icons, Framer Motion

**Mockups:** `.superpowers/brainstorm/16332-1774698080/content/` — `full-window-approaches.html`, `distinct-changes.html`, `right-panel-v2.html`, `panel-close-button.html`

---

## Section 1: Backend — Uncommitted Changes Command

The new design separates uncommitted (working tree) changes from committed branch changes. The existing `get_diff` command only returns committed changes (HEAD vs merge-base). We need a new command for uncommitted files.

### Task 1: Add `get_uncommitted_diff` Rust command

**Files:**
- Modify: `src-tauri/src/commands/diff.rs`
- Modify: `src-tauri/src/lib.rs` (register new command)

- [ ] **Step 1: Add the new command to diff.rs**

Add after the existing `get_diff` command (after line 264 in `src-tauri/src/commands/diff.rs`):

```rust
/// Get the diff of uncommitted changes (working tree + index vs HEAD).
#[tauri::command]
pub async fn get_uncommitted_diff(repo_path: String) -> Result<Vec<DiffFile>> {
    tokio::task::spawn_blocking(move || {
        let repo = open_repo(&repo_path)?;

        let head_tree = repo
            .head()
            .and_then(|h| h.peel_to_tree())
            .map_err(|e| AppError::Git(format!("failed to get HEAD tree: {e}")))?;

        // Staged changes: index vs HEAD
        let mut opts = DiffOptions::new();
        let staged = repo
            .diff_tree_to_index(Some(&head_tree), None, Some(&mut opts))
            .map_err(|e| AppError::Git(format!("staged diff failed: {e}")))?;

        // Unstaged changes: workdir vs index
        let mut opts2 = DiffOptions::new();
        let unstaged = repo
            .diff_index_to_workdir(None, Some(&mut opts2))
            .map_err(|e| AppError::Git(format!("unstaged diff failed: {e}")))?;

        // Merge both diffs
        let mut merged = staged;
        merged
            .merge(&unstaged)
            .map_err(|e| AppError::Git(format!("diff merge failed: {e}")))?;

        diff_to_files(&merged)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}
```

- [ ] **Step 2: Register the command in lib.rs**

Find the `.invoke_handler(tauri::generate_handler![...])` call in `src-tauri/src/lib.rs` and add `commands::diff::get_uncommitted_diff` to the handler list, next to the existing `commands::diff::get_diff`.

- [ ] **Step 3: Add the API function in the frontend**

Add to `src/api.ts` after the existing `getDiff` function:

```typescript
export async function getUncommittedDiff(repoPath: string): Promise<DiffFile[]> {
  return invoke<DiffFile[]>("get_uncommitted_diff", { repoPath });
}
```

- [ ] **Step 4: Verify the command compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles without errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/diff.rs src-tauri/src/lib.rs src/api.ts
git commit -m "feat: add get_uncommitted_diff Rust command"
```

---

## Section 2: Types & Store Updates

Update the type system to remove the PR tab and add new preferences.

### Task 2: Update types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Remove `"pr"` from TabType and add new types**

In `src/types.ts`, change line 204:

```typescript
// Before:
export type TabType = "claude" | "shell" | "server" | "changes" | "pr";

// After:
export type TabType = "claude" | "shell" | "server" | "changes";
```

Add after line 204:

```typescript
export type DiffViewMode = "unified" | "split";
export type PrPanelState = "open" | "collapsed";
```

- [ ] **Step 2: Fix all TypeScript errors from removing `"pr"`**

Run: `npx tsc --noEmit`

This will flag all places that reference `"pr"` as a tab type. The key files to update:

In `src/components/layout/PaneView.tsx`, remove the PR tab rendering block (lines 56-58):
```typescript
// Remove this block:
{activeTab?.type === "pr" && worktree && (
  <PrDetailPanel worktree={worktree} repoPath={worktree.path} />
)}
```

Also remove the `PrDetailPanel` import at the top of the file.

In `src/components/layout/PaneTabBar.tsx`, remove `"pr"` from the add-tab dropdown and from the icon map. Search for `"pr"` in the file and remove all references.

In `src/stores/workspaceStore.ts`, remove the PR tab auto-creation block (lines 277-295 — the `// Auto-create PR tabs for worktrees that gained a PR` section). Also update `addTab` (line 387) to remove the `type === "pr"` label case.

- [ ] **Step 3: Verify TypeScript compiles clean**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/components/layout/PaneView.tsx src/components/layout/PaneTabBar.tsx src/stores/workspaceStore.ts
git commit -m "refactor: remove PR tab type from the system"
```

### Task 3: Add diff view preferences to workspace store

**Files:**
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add state and actions for diff view mode and PR panel state**

Add to the store's state interface (next to the existing `annotations` field):

```typescript
diffViewMode: Record<string, DiffViewMode>;    // per-worktree
prPanelState: Record<string, PrPanelState>;    // per-worktree
```

Add initial values in the store creation:

```typescript
diffViewMode: {},
prPanelState: {},
```

Add actions:

```typescript
setDiffViewMode: (worktreeId: string, mode: DiffViewMode) =>
  set((state) => ({
    diffViewMode: { ...state.diffViewMode, [worktreeId]: mode },
  })),

setPrPanelState: (worktreeId: string, panelState: PrPanelState) =>
  set((state) => ({
    prPanelState: { ...state.prPanelState, [worktreeId]: panelState },
  })),
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/stores/workspaceStore.ts
git commit -m "feat: add diffViewMode and prPanelState to workspace store"
```

---

## Section 3: Shiki Syntax Highlighting Service

Install Shiki and create a reusable highlighting service.

### Task 4: Install Shiki and create highlighter service

**Files:**
- Create: `src/services/syntaxHighlighter.ts`

- [ ] **Step 1: Install Shiki**

Run: `npm install shiki`

- [ ] **Step 2: Create the highlighter service**

Create `src/services/syntaxHighlighter.ts`:

```typescript
import { createHighlighter, type Highlighter, type ThemedToken } from "shiki";

let highlighterInstance: Highlighter | null = null;
let highlighterPromise: Promise<Highlighter> | null = null;

const SUPPORTED_LANGS = [
  "typescript", "tsx", "javascript", "jsx",
  "rust", "json", "css", "html",
  "markdown", "yaml", "toml", "bash",
  "python", "go", "sql",
] as const;

/**
 * Get or create the singleton Shiki highlighter.
 * Lazy-loads on first call; subsequent calls return the cached instance.
 */
export async function getHighlighter(): Promise<Highlighter> {
  if (highlighterInstance) return highlighterInstance;
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = createHighlighter({
    themes: ["github-dark-default"],
    langs: [...SUPPORTED_LANGS],
  });

  highlighterInstance = await highlighterPromise;
  highlighterPromise = null;
  return highlighterInstance;
}

/**
 * Map a file path to a Shiki language identifier.
 * Returns undefined for unsupported extensions (rendered as plain text).
 */
export function getLangFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    rs: "rust",
    json: "json",
    css: "css",
    html: "html",
    md: "markdown",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    py: "python",
    go: "go",
    sql: "sql",
  };
  return map[ext ?? ""];
}

/**
 * Tokenize a single line of code for syntax highlighting.
 * Returns an array of themed tokens with color info.
 * Falls back to plain text if language is unsupported.
 */
export async function tokenizeLine(
  code: string,
  lang?: string,
): Promise<ThemedToken[]> {
  if (!lang) {
    return [{ content: code, color: undefined }];
  }

  const highlighter = await getHighlighter();
  const tokens = highlighter.codeToTokensBase(code, {
    lang,
    theme: "github-dark-default",
  });

  // codeToTokensBase returns Token[][] (lines), we only pass one line
  return tokens[0] ?? [{ content: code, color: undefined }];
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/syntaxHighlighter.ts package.json package-lock.json
git commit -m "feat: add Shiki syntax highlighting service"
```

---

## Section 4: File Sidebar Component

The left panel with file navigation, All/Commits toggle, and uncommitted/committed sections.

### Task 5: Build the new file sidebar

**Files:**
- Create: `src/components/changes/FileSidebar.tsx`

- [ ] **Step 1: Create the FileSidebar component**

Create `src/components/changes/FileSidebar.tsx`:

```tsx
import { useCallback } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
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
          {/* Uncommitted files */}
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

          {/* Committed files */}
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
          {/* Commit list */}
          {commits.map((commit, index) => (
            <button
              key={commit.hash}
              onClick={() => onSelectCommit(index)}
              className={[
                "flex items-center gap-1.5 w-full px-2.5 py-1.5 text-left text-xs",
                "hover:bg-bg-hover transition-colors",
                selectedCommitIndex === index
                  ? "bg-bg-hover text-text-primary"
                  : "text-text-secondary",
              ].join(" ")}
            >
              <span className="text-[10px] font-mono text-text-tertiary flex-shrink-0">
                {commit.shortHash}
              </span>
              <span className="truncate">{commit.message.split("\n")[0]}</span>
            </button>
          ))}

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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/FileSidebar.tsx
git commit -m "feat: add FileSidebar component with All/Commits toggle"
```

---

## Section 5: Syntax-Highlighted Diff Viewer

Rebuild the diff viewer with Shiki syntax highlighting, unified/split modes, collapsible files, and sticky headers.

### Task 6: Create the syntax-highlighted DiffLine component

**Files:**
- Create: `src/components/changes/SyntaxDiffLine.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/changes/SyntaxDiffLine.tsx`:

```tsx
import { useEffect, useState } from "react";
import { tokenizeLine, getLangFromPath } from "../../services/syntaxHighlighter";
import type { ThemedToken } from "shiki";

interface SyntaxDiffLineProps {
  content: string;
  lineType: "context" | "addition" | "deletion";
  oldLineNumber: number | null;
  newLineNumber: number | null;
  filePath: string;
  onClickLine?: () => void;
  children?: React.ReactNode; // annotation/comment slot below the line
}

const LINE_BG: Record<string, string> = {
  addition: "bg-diff-added/6",
  deletion: "bg-diff-removed/6",
  context: "",
};

const GUTTER_BG: Record<string, string> = {
  addition: "bg-diff-added/10",
  deletion: "bg-diff-removed/10",
  context: "",
};

function SyntaxDiffLine({
  content,
  lineType,
  oldLineNumber,
  newLineNumber,
  filePath,
  onClickLine,
  children,
}: SyntaxDiffLineProps) {
  const [tokens, setTokens] = useState<ThemedToken[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const lang = getLangFromPath(filePath);
    // Strip the leading +/- character for highlighting
    const code = content.length > 0 && (content[0] === "+" || content[0] === "-" || content[0] === " ")
      ? content.slice(1)
      : content;

    tokenizeLine(code, lang).then((result) => {
      if (!cancelled) setTokens(result);
    });

    return () => { cancelled = true; };
  }, [content, filePath]);

  const prefix = lineType === "addition" ? "+" : lineType === "deletion" ? "-" : " ";

  return (
    <>
      <div
        className={["flex font-mono text-[11px] leading-[20px] group", LINE_BG[lineType]].join(" ")}
        onClick={onClickLine}
      >
        {/* Gutter: old line number */}
        <span
          className={[
            "w-[44px] text-right pr-1.5 text-text-tertiary select-none flex-shrink-0 text-[10px]",
            GUTTER_BG[lineType],
          ].join(" ")}
        >
          {oldLineNumber ?? ""}
        </span>
        {/* Gutter: new line number */}
        <span
          className={[
            "w-[44px] text-right pr-3 text-text-tertiary select-none flex-shrink-0 text-[10px]",
            GUTTER_BG[lineType],
          ].join(" ")}
        >
          {newLineNumber ?? ""}
        </span>
        {/* Prefix (+/-/space) */}
        <span className="w-4 text-center text-text-tertiary select-none flex-shrink-0">
          {prefix}
        </span>
        {/* Code content */}
        <span className="flex-1 px-2 whitespace-pre overflow-x-auto">
          {tokens
            ? tokens.map((token, i) => (
                <span key={i} style={token.color ? { color: token.color } : undefined}>
                  {token.content}
                </span>
              ))
            : <span className="text-text-secondary">{content.slice(1)}</span>
          }
        </span>
      </div>
      {children}
    </>
  );
}

export { SyntaxDiffLine };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/SyntaxDiffLine.tsx
git commit -m "feat: add SyntaxDiffLine component with Shiki highlighting"
```

### Task 7: Create the new DiffFileCard component

**Files:**
- Create: `src/components/changes/DiffFileCard.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/changes/DiffFileCard.tsx`:

```tsx
import { forwardRef, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { SyntaxDiffLine } from "./SyntaxDiffLine";
import { AnnotationBubble } from "./AnnotationBubble";
import { AnnotationInput } from "./AnnotationInput";
import { DiffCommentIndicator } from "./DiffCommentIndicator";
import { DiffCommentThread } from "./DiffCommentThread";
import type { DiffFile, DiffViewMode, Annotation, PrComment } from "../../types";

interface DiffFileCardProps {
  file: DiffFile;
  expanded: boolean;
  onToggleExpanded: () => void;
  viewMode: DiffViewMode;
  annotations: Annotation[];
  activeAnnotationLine: number | null;
  onAddAnnotation: (filePath: string, lineNumber: number) => void;
  onSubmitAnnotation: (filePath: string, lineNumber: number, text: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  prComments: PrComment[];
}

const STATUS_BADGE: Record<string, { label: string; classes: string }> = {
  added: { label: "A", classes: "bg-[rgba(74,222,128,0.15)] text-[#4ade80]" },
  modified: { label: "M", classes: "bg-[rgba(251,191,36,0.15)] text-[#fbbf24]" },
  deleted: { label: "D", classes: "bg-[rgba(248,113,113,0.15)] text-[#f87171]" },
  renamed: { label: "R", classes: "bg-[rgba(96,165,250,0.15)] text-[#60a5fa]" },
};

const DiffFileCard = forwardRef<HTMLDivElement, DiffFileCardProps>(
  function DiffFileCard(
    {
      file,
      expanded,
      onToggleExpanded,
      viewMode,
      annotations,
      activeAnnotationLine,
      onAddAnnotation,
      onSubmitAnnotation,
      onDeleteAnnotation,
      prComments,
    },
    ref,
  ) {
    const badge = STATUS_BADGE[file.status] ?? STATUS_BADGE.modified;

    const commentsByLine = useMemo(() => {
      const map = new Map<number, PrComment[]>();
      for (const c of prComments) {
        if (c.path === file.path && c.line != null) {
          const existing = map.get(c.line) ?? [];
          existing.push(c);
          map.set(c.line, existing);
        }
      }
      return map;
    }, [prComments, file.path]);

    const annotationsByLine = useMemo(() => {
      const map = new Map<number, Annotation[]>();
      for (const a of annotations) {
        if (a.filePath === file.path) {
          const existing = map.get(a.lineNumber) ?? [];
          existing.push(a);
          map.set(a.lineNumber, existing);
        }
      }
      return map;
    }, [annotations, file.path]);

    return (
      <div ref={ref} className="border-b border-border-default">
        {/* Sticky file header */}
        <div className="sticky top-0 z-10 bg-bg-secondary flex items-center justify-between px-3 py-1.5 border-b border-border-default">
          <div className="flex items-center gap-2">
            <button onClick={onToggleExpanded} className="text-text-tertiary hover:text-text-secondary">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
            <span className={["text-[9px] font-semibold px-1 py-px rounded-sm", badge.classes].join(" ")}>
              {badge.label}
            </span>
            <span className="text-xs font-semibold text-text-primary truncate">{file.path}</span>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
            {file.additions > 0 && <span className="text-[#4ade80]">+{file.additions}</span>}
            {file.deletions > 0 && <span className="text-[#f87171]">-{file.deletions}</span>}
          </div>
        </div>

        {/* Diff content */}
        {expanded && (
          <div className="overflow-x-auto">
            {file.hunks.map((hunk, hunkIdx) => (
              <div key={hunkIdx}>
                {/* Hunk separator */}
                {hunkIdx > 0 && (
                  <div className="px-3 py-1 text-[10px] text-text-tertiary bg-bg-secondary/50 font-mono">
                    {hunk.header}
                  </div>
                )}
                {hunk.lines.map((line, lineIdx) => {
                  const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0;
                  const lineAnnotations = annotationsByLine.get(lineNum) ?? [];
                  const lineComments = commentsByLine.get(lineNum) ?? [];

                  return (
                    <SyntaxDiffLine
                      key={`${hunkIdx}-${lineIdx}`}
                      content={line.content}
                      lineType={line.lineType}
                      oldLineNumber={line.oldLineNumber}
                      newLineNumber={line.newLineNumber}
                      filePath={file.path}
                      onClickLine={() => onAddAnnotation(file.path, lineNum)}
                    >
                      {/* PR comments inline */}
                      {lineComments.length > 0 && (
                        <div className="ml-[108px]">
                          <DiffCommentThread comments={lineComments} />
                        </div>
                      )}
                      {/* Annotations */}
                      {lineAnnotations.map((a) => (
                        <div key={a.id} className="ml-[108px]">
                          <AnnotationBubble
                            annotation={a}
                            onDelete={() => onDeleteAnnotation(a.id)}
                          />
                        </div>
                      ))}
                      {/* Annotation input */}
                      {activeAnnotationLine === lineNum && (
                        <div className="ml-[108px]">
                          <AnnotationInput
                            onSubmit={(text) => onSubmitAnnotation(file.path, lineNum, text)}
                            onCancel={() => onAddAnnotation(file.path, lineNum)}
                          />
                        </div>
                      )}
                    </SyntaxDiffLine>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
);

export { DiffFileCard };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/DiffFileCard.tsx
git commit -m "feat: add DiffFileCard with syntax highlighting and collapsible files"
```

---

## Section 6: PR Panel + Activity Bar Rail

The right-side panel showing checks, reviews, comments, and merge status, with a collapsed rail state.

### Task 8: Create the PR panel component

**Files:**
- Create: `src/components/changes/PrPanel.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/changes/PrPanel.tsx`:

```tsx
import { useEffect, useMemo } from "react";
import {
  CircleCheck, CircleX, Eye, MessageCircle,
  ChevronRight, ExternalLink, Clock, RotateCcw,
} from "lucide-react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { getCheckRuns, getPrDetail, rerunFailedChecks } from "../../api";
import type {
  PrStatus, CheckRun, PrReview, PrComment, PrPanelState,
} from "../../types";

interface PrPanelProps {
  worktreeId: string;
  repoPath: string;
  pr: PrStatus;
  panelState: PrPanelState;
  onTogglePanel: () => void;
  onJumpToComment: (filePath: string, line: number) => void;
}

function PrPanel({
  worktreeId,
  repoPath,
  pr,
  panelState,
  onTogglePanel,
  onJumpToComment,
}: PrPanelProps) {
  const prDetail = useWorkspaceStore((s) => s.prDetail[worktreeId]);
  const checkRuns = useWorkspaceStore((s) => s.checkRuns[worktreeId]) ?? [];
  const setPrDetail = useWorkspaceStore((s) => s.setPrDetail);
  const setCheckRuns = useWorkspaceStore((s) => s.setCheckRuns);

  // Poll PR data every 30 seconds
  useEffect(() => {
    let cancelled = false;

    async function fetchPrData() {
      try {
        const [detail, checks] = await Promise.all([
          getPrDetail(repoPath, pr.number),
          getCheckRuns(repoPath, pr.branch),
        ]);
        if (cancelled) return;
        setPrDetail(worktreeId, detail);
        setCheckRuns(worktreeId, checks);
      } catch (err) {
        console.error("Failed to fetch PR data:", err);
      }
    }

    fetchPrData();
    const interval = setInterval(fetchPrData, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [worktreeId, repoPath, pr.number, pr.branch, setPrDetail, setCheckRuns]);

  const reviews = prDetail?.reviews ?? [];
  const comments = prDetail?.comments ?? [];
  const mergeable = prDetail?.mergeable;

  const failingChecks = checkRuns.filter(
    (c) => c.status === "completed" && c.conclusion === "failure",
  );
  const passingChecks = checkRuns.filter(
    (c) => c.status === "completed" && c.conclusion === "success",
  );

  // Collapsed rail
  if (panelState === "collapsed") {
    return (
      <div className="w-[36px] bg-bg-primary border-l border-border-default flex-shrink-0 flex flex-col items-center py-2 gap-1">
        <button
          onClick={onTogglePanel}
          className="w-7 h-7 rounded-md flex items-center justify-center text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
          title="Expand PR panel"
        >
          <ChevronRight size={14} style={{ transform: "scaleX(-1)" }} />
        </button>
        <RailIcon
          icon={<CircleCheck size={14} />}
          count={checkRuns.length}
          hasError={failingChecks.length > 0}
          onClick={onTogglePanel}
          title="Checks"
        />
        <RailIcon
          icon={<Eye size={14} />}
          count={reviews.length}
          hasError={reviews.some((r) => r.state === "changes_requested")}
          onClick={onTogglePanel}
          title="Reviews"
        />
        <RailIcon
          icon={<MessageCircle size={14} />}
          count={comments.length}
          hasError={false}
          onClick={onTogglePanel}
          title="Comments"
        />
      </div>
    );
  }

  // Expanded panel
  return (
    <div className="flex">
      <div className="w-[260px] bg-bg-primary border-l border-border-default flex-shrink-0 flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border-default">
          <span className="text-sm font-semibold">PR</span>
          <span className="text-xs text-text-tertiary">#{pr.number}</span>
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-tertiary hover:text-text-secondary text-[10px] ml-1"
          >
            <ExternalLink size={12} />
          </a>
          <button
            onClick={onTogglePanel}
            className="ml-auto w-6 h-6 rounded-md flex items-center justify-center text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
            title="Collapse panel"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Checks */}
        <PanelSection title="Checks">
          {checkRuns.map((check) => (
            <CheckRow key={check.id} check={check} repoPath={repoPath} />
          ))}
          {checkRuns.length === 0 && <EmptyText>No checks</EmptyText>}
        </PanelSection>

        {/* Reviews */}
        <PanelSection title="Reviews">
          {reviews.map((review, i) => (
            <ReviewRow key={i} review={review} />
          ))}
          {reviews.length === 0 && <EmptyText>No reviews</EmptyText>}
        </PanelSection>

        {/* Comments */}
        <PanelSection title="Comments">
          {comments.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              onJump={
                comment.path && comment.line
                  ? () => onJumpToComment(comment.path!, comment.line!)
                  : undefined
              }
            />
          ))}
          {comments.length === 0 && <EmptyText>No comments</EmptyText>}
        </PanelSection>

        {/* Merge status */}
        {mergeable !== undefined && mergeable !== null && (
          <div className="px-3.5 py-2.5">
            <div
              className={[
                "px-2.5 py-2 rounded-md text-xs flex items-center gap-1.5",
                failingChecks.length > 0
                  ? "bg-[rgba(248,113,113,0.08)] text-[#f87171]"
                  : mergeable
                    ? "bg-[rgba(74,222,128,0.08)] text-[#4ade80]"
                    : "bg-[rgba(248,113,113,0.08)] text-[#f87171]",
              ].join(" ")}
            >
              {failingChecks.length > 0
                ? `⚠ Blocked: ${failingChecks.length} failing check${failingChecks.length > 1 ? "s" : ""}`
                : mergeable
                  ? "✓ Ready to merge"
                  : "⚠ Has merge conflicts"}
            </div>
          </div>
        )}
      </div>

      {/* Activity bar rail */}
      <div className="w-[36px] bg-bg-primary border-l border-border-default flex-shrink-0 flex flex-col items-center py-2 gap-1">
        <RailIcon
          icon={<CircleCheck size={14} />}
          count={checkRuns.length}
          hasError={failingChecks.length > 0}
          onClick={onTogglePanel}
          title="Checks"
          active
        />
        <RailIcon
          icon={<Eye size={14} />}
          count={reviews.length}
          hasError={reviews.some((r) => r.state === "changes_requested")}
          onClick={onTogglePanel}
          title="Reviews"
          active
        />
        <RailIcon
          icon={<MessageCircle size={14} />}
          count={comments.length}
          hasError={false}
          onClick={onTogglePanel}
          title="Comments"
          active
        />
      </div>
    </div>
  );
}

// ── Sub-components ──

function RailIcon({
  icon, count, hasError, onClick, title, active,
}: {
  icon: React.ReactNode;
  count: number;
  hasError: boolean;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        "w-7 h-7 rounded-md flex items-center justify-center relative",
        active
          ? "bg-accent-muted text-accent-primary"
          : "text-text-tertiary hover:bg-bg-hover",
      ].join(" ")}
    >
      {icon}
      {count > 0 && (
        <span
          className={[
            "absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full text-[7px] font-bold flex items-center justify-center px-0.5",
            hasError
              ? "bg-[#f87171] text-white"
              : "bg-[#4ade80] text-[#1a1918]",
          ].join(" ")}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3.5 py-2.5 border-b border-border-subtle">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary font-semibold mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}

function CheckRow({ check, repoPath }: { check: CheckRun; repoPath: string }) {
  const isFailing = check.status === "completed" && check.conclusion === "failure";
  const isPassing = check.status === "completed" && check.conclusion === "success";
  const duration = check.completedAt && check.startedAt
    ? formatDuration(new Date(check.completedAt).getTime() - new Date(check.startedAt).getTime())
    : null;

  return (
    <div className="flex items-center gap-2 py-1 text-xs text-text-secondary">
      <span
        className={[
          "w-[7px] h-[7px] rounded-full flex-shrink-0",
          isFailing ? "bg-[#f87171]" : isPassing ? "bg-[#4ade80]" : "bg-[#fbbf24]",
        ].join(" ")}
      />
      <span className={["flex-1", isFailing ? "text-[#f87171]" : ""].join(" ")}>
        {check.name}
      </span>
      {duration && <span className="text-[10px] text-text-tertiary">{duration}</span>}
      {isFailing && check.htmlUrl && (
        <a href={check.htmlUrl} target="_blank" rel="noopener noreferrer" className="text-accent-primary text-[10px]">
          logs
        </a>
      )}
    </div>
  );
}

function ReviewRow({ review }: { review: PrReview }) {
  const stateLabel: Record<string, { icon: string; color: string; text: string }> = {
    approved: { icon: "✅", color: "text-[#4ade80]", text: "Approved" },
    changes_requested: { icon: "🔄", color: "text-[#fbbf24]", text: "Changes requested" },
    pending: { icon: "⏳", color: "text-text-tertiary", text: "Pending" },
    dismissed: { icon: "—", color: "text-text-tertiary", text: "Dismissed" },
  };
  const state = stateLabel[review.state] ?? stateLabel.pending;

  return (
    <div className="flex items-center gap-2 py-1 text-xs text-text-secondary">
      <span className="w-5 h-5 rounded-full bg-bg-hover flex items-center justify-center text-[9px] font-semibold flex-shrink-0">
        {review.reviewer[0]?.toUpperCase() ?? "?"}
      </span>
      <span className="font-medium text-text-primary">{review.reviewer}</span>
      <span className={["text-[10px]", state.color].join(" ")}>{state.text}</span>
    </div>
  );
}

function CommentCard({
  comment,
  onJump,
}: {
  comment: PrComment;
  onJump?: () => void;
}) {
  const timeAgo = formatTimeAgo(new Date(comment.createdAt).getTime());

  return (
    <div
      className="px-2.5 py-2 mb-1.5 bg-bg-secondary rounded-md hover:bg-bg-hover cursor-default"
      onClick={onJump}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-[10px] font-semibold text-text-primary">{comment.author}</span>
        {comment.path && comment.line && (
          <span className="text-[9px] text-accent-primary cursor-pointer">
            {comment.path.split("/").pop()}:{comment.line}
          </span>
        )}
        <span className="ml-auto text-[9px] text-text-tertiary">{timeAgo}</span>
      </div>
      <div className="text-xs text-text-secondary leading-relaxed line-clamp-3">
        {comment.body}
      </div>
    </div>
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-text-tertiary py-1">{children}</div>;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export { PrPanel };
export type { PrPanelProps };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors. You may need to check that `setPrDetail` and `setCheckRuns` exist in the workspace store. They should already exist from the current PR feature — verify and add if missing.

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/PrPanel.tsx
git commit -m "feat: add PrPanel with activity bar rail and collapsible state"
```

---

## Section 7: New ChangesView Orchestration

Wire all the new components together into the rebuilt ChangesView.

### Task 9: Rebuild ChangesView

**Files:**
- Modify: `src/components/changes/ChangesView.tsx`

- [ ] **Step 1: Rewrite ChangesView**

Replace the entire contents of `src/components/changes/ChangesView.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Trash2, MessageSquare } from "lucide-react";
import { FileSidebar, type ViewMode } from "./FileSidebar";
import { DiffFileCard } from "./DiffFileCard";
import { PrPanel } from "./PrPanel";
import {
  getDiff, getUncommittedDiff, getCommits, getDiffForCommit, writePty,
} from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { sessionManager } from "../../services/sessionManager";
import { Button } from "../ui/Button";
import type { DiffFile, CommitInfo, PrPanelState, DiffViewMode } from "../../types";

interface ChangesViewProps {
  worktreeId: string;
  repoPath: string;
}

function ChangesView({ worktreeId, repoPath }: ChangesViewProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [uncommittedFiles, setUncommittedFiles] = useState<DiffFile[]>([]);
  const [committedFiles, setCommittedFiles] = useState<DiffFile[]>([]);
  const [commits, setCommits] = useState<CommitInfo[]>([]);
  const [selectedCommitIndex, setSelectedCommitIndex] = useState<number | null>(null);
  const [commitFiles, setCommitFiles] = useState<DiffFile[]>([]);
  const [activeAnnotationLine, setActiveAnnotationLine] = useState<number | null>(null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);

  const fileRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Store state
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === worktreeId),
  );
  const pr = worktree?.prStatus ?? null;
  const annotations = useWorkspaceStore((s) => s.annotations[worktreeId]) ?? [];
  const addAnnotation = useWorkspaceStore((s) => s.addAnnotation);
  const removeAnnotation = useWorkspaceStore((s) => s.removeAnnotation);
  const clearAnnotations = useWorkspaceStore((s) => s.clearAnnotations);
  const prComments = useWorkspaceStore((s) => s.prDetail[worktreeId]?.comments) ?? [];

  const diffViewMode = useWorkspaceStore((s) => s.diffViewMode[worktreeId]) ?? "unified";
  const prPanelState = useWorkspaceStore((s) => s.prPanelState[worktreeId]) ?? (pr ? "open" : "collapsed");
  const setDiffViewMode = useWorkspaceStore((s) => s.setDiffViewMode);
  const setPrPanelState = useWorkspaceStore((s) => s.setPrPanelState);

  // Load data
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [uncommitted, committed, commitList] = await Promise.all([
          getUncommittedDiff(repoPath),
          getDiff(repoPath),
          getCommits(repoPath),
        ]);
        if (cancelled) return;
        setUncommittedFiles(uncommitted);
        setCommittedFiles(committed);
        setCommits(commitList);
      } catch (err) {
        console.error("Failed to load diff data:", err);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [repoPath]);

  // Load commit-specific diff when selecting a commit
  useEffect(() => {
    if (viewMode !== "commits" || selectedCommitIndex === null || commits.length === 0) {
      setCommitFiles([]);
      return;
    }

    let cancelled = false;
    async function loadCommitDiff() {
      try {
        const files = await getDiffForCommit(repoPath, commits[selectedCommitIndex!].hash);
        if (!cancelled) setCommitFiles(files);
      } catch (err) {
        console.error("Failed to load commit diff:", err);
      }
    }

    loadCommitDiff();
    return () => { cancelled = true; };
  }, [viewMode, selectedCommitIndex, commits, repoPath]);

  // The files currently shown in the diff viewer
  const displayFiles = viewMode === "commits" && selectedCommitIndex !== null
    ? commitFiles
    : [...uncommittedFiles, ...committedFiles];

  // Keyboard shortcut: Cmd+I to toggle PR panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "i" && pr) {
        e.preventDefault();
        setPrPanelState(worktreeId, prPanelState === "open" ? "collapsed" : "open");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [worktreeId, pr, prPanelState, setPrPanelState]);

  const handleTogglePanel = useCallback(() => {
    setPrPanelState(worktreeId, prPanelState === "open" ? "collapsed" : "open");
  }, [worktreeId, prPanelState, setPrPanelState]);

  const handleSelectFile = useCallback((path: string) => {
    setActiveFilePath(path);
    // Expand if collapsed
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    // Scroll to file
    const el = fileRefs.current.get(path);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const handleToggleFileCollapse = useCallback((path: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleAddAnnotation = useCallback((_filePath: string, lineNumber: number) => {
    setActiveAnnotationLine((prev) => (prev === lineNumber ? null : lineNumber));
  }, []);

  const handleSubmitAnnotation = useCallback(
    (filePath: string, lineNumber: number, text: string) => {
      const commitHash =
        viewMode === "commits" && selectedCommitIndex !== null && commits.length > 0
          ? commits[selectedCommitIndex].hash
          : null;
      addAnnotation({
        id: crypto.randomUUID(),
        worktreeId,
        filePath,
        lineNumber,
        commitHash,
        text,
        createdAt: Date.now(),
      });
      setActiveAnnotationLine(null);
    },
    [worktreeId, viewMode, selectedCommitIndex, commits, addAnnotation],
  );

  const handleDeleteAnnotation = useCallback(
    (id: string) => removeAnnotation(worktreeId, id),
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

  const handleJumpToComment = useCallback((filePath: string, line: number) => {
    handleSelectFile(filePath);
    // After scroll, highlight the line (via annotation line)
    setTimeout(() => setActiveAnnotationLine(line), 300);
  }, [handleSelectFile]);

  return (
    <div className="flex flex-col h-full">
      {/* Annotation status bar */}
      {annotations.length > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 bg-accent-primary/8 border-b border-accent-primary/20 flex-shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-accent-primary font-medium">
            <MessageSquare size={14} />
            <span>
              {annotations.length} {annotations.length === 1 ? "annotation" : "annotations"}
            </span>
          </div>
          <div className="flex items-center gap-1.5 ml-auto">
            <Button size="sm" variant="primary" onClick={handleSendToClaude}>
              <Send size={12} />
              Send to Claude
            </Button>
            <Button size="sm" variant="ghost" onClick={() => clearAnnotations(worktreeId)}>
              <Trash2 size={12} />
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Three-zone layout */}
      <div className="flex flex-1 min-h-0">
        {/* Left: File sidebar */}
        <FileSidebar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          uncommittedFiles={uncommittedFiles}
          committedFiles={committedFiles}
          commits={commits}
          selectedCommitIndex={selectedCommitIndex}
          onSelectCommit={(index) => setSelectedCommitIndex(index)}
          activeFilePath={activeFilePath}
          collapsedFiles={collapsedFiles}
          onSelectFile={handleSelectFile}
        />

        {/* Center: Diff viewer */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {displayFiles.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-text-tertiary">
              No changes to display
            </div>
          ) : (
            displayFiles.map((file) => (
              <DiffFileCard
                key={file.path}
                ref={(el) => {
                  if (el) fileRefs.current.set(file.path, el);
                  else fileRefs.current.delete(file.path);
                }}
                file={file}
                expanded={!collapsedFiles.has(file.path)}
                onToggleExpanded={() => handleToggleFileCollapse(file.path)}
                viewMode={diffViewMode}
                annotations={annotations}
                activeAnnotationLine={activeAnnotationLine}
                onAddAnnotation={handleAddAnnotation}
                onSubmitAnnotation={handleSubmitAnnotation}
                onDeleteAnnotation={handleDeleteAnnotation}
                prComments={prComments}
              />
            ))
          )}
        </div>

        {/* Right: PR panel (only when PR exists) */}
        {pr && (
          <PrPanel
            worktreeId={worktreeId}
            repoPath={repoPath}
            pr={pr}
            panelState={prPanelState}
            onTogglePanel={handleTogglePanel}
            onJumpToComment={handleJumpToComment}
          />
        )}
      </div>
    </div>
  );
}

export { ChangesView };
export type { ChangesViewProps };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors. Fix any type mismatches (e.g., ensure `setPrDetail`, `setCheckRuns` exist on the store).

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/ChangesView.tsx
git commit -m "feat: rebuild ChangesView with three-zone layout"
```

---

## Section 8: Tab System Updates

Right-align the Changes tab and remove the PR tab from the UI.

### Task 10: Update PaneTabBar to right-align Changes tab

**Files:**
- Modify: `src/components/layout/PaneTabBar.tsx`

- [ ] **Step 1: Split tabs into terminal tabs and the changes tab**

In `PaneTabBar.tsx`, find where `paneTabs` are rendered in the JSX. Split the rendering into two groups: terminal tabs (left) and the changes tab (right-aligned with accent glow).

In the JSX rendering section, replace the single tab list with:

```tsx
{/* Terminal tabs (left-aligned) */}
<div className="flex">
  {paneTabs.filter((t) => t.type !== "changes").map((tab) => (
    <SortableTab
      key={tab.id}
      tab={tab}
      isActive={tab.id === activeTabId}
      canClose={canClose(tab)}
      onClose={(e) => handleCloseTab(e, tab.id)}
      onSelect={() => handleSelectTab(tab.id)}
      onSplit={handleSplit}
    />
  ))}
</div>

{/* Changes tab (right-aligned with accent glow) */}
{paneTabs.filter((t) => t.type === "changes").map((tab) => (
  <button
    key={tab.id}
    onClick={() => handleSelectTab(tab.id)}
    className={[
      "ml-auto flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium border-b-2",
      tab.id === activeTabId
        ? "text-text-primary border-accent-primary bg-gradient-to-t from-accent-primary/6 to-transparent"
        : "text-text-tertiary border-transparent hover:text-text-secondary",
    ].join(" ")}
  >
    <GitCompareArrows size={14} className={tab.id === activeTabId ? "text-accent-primary" : ""} />
    Changes
  </button>
))}
```

Make sure to import `GitCompareArrows` from `lucide-react` at the top of the file.

- [ ] **Step 2: Remove PR from the "Add tab" dropdown**

Find the add-tab dropdown menu and remove the PR option. Only `claude` and `shell` should remain as addable tab types.

- [ ] **Step 3: Verify it compiles and renders**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/PaneTabBar.tsx
git commit -m "feat: right-align Changes tab and remove PR from add-tab menu"
```

---

## Section 9: Cleanup

Remove old components that have been replaced.

### Task 11: Remove old PR components

**Files:**
- Delete: `src/components/pr/PrDetailPanel.tsx`
- Delete: `src/components/pr/PrHeader.tsx`
- Delete: `src/components/pr/PrChecksSection.tsx`
- Delete: `src/components/pr/PrReviewsSection.tsx`
- Delete: `src/components/pr/PrCommentsSection.tsx`
- Delete: `src/components/pr/PrConflictsSection.tsx`
- Delete: `src/components/pr/CheckRunItem.tsx`
- Delete: `src/components/pr/CollapsibleSection.tsx`

- [ ] **Step 1: Delete all PR component files**

```bash
rm -rf src/components/pr/
```

- [ ] **Step 2: Remove any remaining imports to deleted files**

Run: `npx tsc --noEmit`

Fix any import errors that reference deleted files. The main one was already handled in Task 2 (PaneView.tsx). Check for any other references.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove old PR components replaced by PrPanel"
```

### Task 12: Remove old Changes components that were replaced

**Files:**
- Delete: `src/components/changes/StackedDiffView.tsx`
- Delete: `src/components/changes/FileCard.tsx`
- Delete: `src/components/changes/FileTreeSidebar.tsx`
- Delete: `src/components/changes/DiffToolbar.tsx`
- Delete: `src/components/changes/CommitList.tsx`
- Delete: `src/components/changes/CommitDetailBar.tsx`

- [ ] **Step 1: Delete replaced component files**

```bash
rm src/components/changes/StackedDiffView.tsx
rm src/components/changes/FileCard.tsx
rm src/components/changes/FileTreeSidebar.tsx
rm src/components/changes/DiffToolbar.tsx
rm src/components/changes/CommitList.tsx
rm src/components/changes/CommitDetailBar.tsx
```

- [ ] **Step 2: Verify no remaining imports**

Run: `npx tsc --noEmit`
Expected: No errors. All references should now point to new components.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove old Changes components replaced by redesign"
```

---

## Section 10: Visual Verification

### Task 13: End-to-end visual check

- [ ] **Step 1: Build and launch the app**

Run: `npm run tauri dev`

- [ ] **Step 2: Verify the Changes tab**

Check each of these:
1. Changes tab appears right-aligned in the tab bar with accent glow when active
2. File sidebar shows All/Commits toggle
3. Uncommitted and Committed sections appear correctly in the file sidebar
4. Clicking a file scrolls the diff viewer to that file
5. Diff lines have syntax highlighting (colored keywords, strings, types)
6. File cards have sticky headers with collapse chevron
7. Collapsing a file card works and the file shows as dimmed in the sidebar

- [ ] **Step 3: Verify the PR panel (if a worktree has a PR)**

Check each of these:
1. PR panel appears on the right with activity bar rail
2. Checks, reviews, and comments sections render correctly
3. Clicking the `▸` chevron collapses the panel to just the rail
4. Rail icons show badge counts
5. Clicking the `◂` arrow or any rail icon expands the panel
6. `Cmd+I` toggles the panel
7. Clicking a comment with a file reference jumps to that file in the diff

- [ ] **Step 4: Verify no-PR state**

Select a worktree without a PR and check:
1. No activity bar rail or PR panel appears
2. File sidebar + diff viewer have full width
3. All/Commits toggle works correctly

- [ ] **Step 5: Commit any visual fixes**

If any styling or layout issues were found and fixed, commit them:

```bash
git add -A
git commit -m "fix: visual polish for changes redesign"
```
