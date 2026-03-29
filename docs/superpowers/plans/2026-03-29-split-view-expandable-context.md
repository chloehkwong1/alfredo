# Split Diff View & Expandable Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add side-by-side split diff view and expandable context lines to the Changes view.

**Architecture:** Split view is a frontend-only rendering change — same DiffLine data, different layout. Context expansion uses a new Rust backend command `get_file_lines` that reads specific line ranges from files (working tree or commit). Both features are independent and can be built in either order.

**Tech Stack:** Rust (git2/git CLI), React, Zustand, Tailwind, Shiki

**Design mockup:** `designs/split-view-and-expand-context.html`

**Design spec:** `docs/superpowers/specs/2026-03-29-split-view-expandable-context-design.md`

---

### Task 1: Rust backend — `get_file_lines` command

**Files:**
- Modify: `src-tauri/src/commands/diff.rs` (append new struct + command)
- Modify: `src-tauri/src/lib.rs:117` (register command)

- [ ] **Step 1: Add the `FileLines` response struct and `get_file_lines` command**

Append to `src-tauri/src/commands/diff.rs`:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLine {
    pub line_number: u32,
    pub content: String,
}

/// Read a range of lines from a file, either from the working tree or a specific commit.
///
/// - `start_line` and `end_line` are 1-based, inclusive.
/// - If `commit_hash` is None, reads from the working tree.
/// - If `commit_hash` is Some, reads the file as it existed in that commit.
#[tauri::command]
pub async fn get_file_lines(
    repo_path: String,
    file_path: String,
    start_line: u32,
    end_line: u32,
    commit_hash: Option<String>,
) -> Result<Vec<FileLine>> {
    tokio::task::spawn_blocking(move || {
        let content = if let Some(hash) = commit_hash {
            // Read file from a specific commit via git show
            let output = std::process::Command::new("git")
                .args(["show", &format!("{hash}:{file_path}")])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| AppError::Git(format!("failed to run git show: {e}")))?;

            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::Git(format!("git show failed: {err}")));
            }

            String::from_utf8_lossy(&output.stdout).to_string()
        } else {
            // Read file from working tree
            let full_path = std::path::Path::new(&repo_path).join(&file_path);
            std::fs::read_to_string(&full_path)
                .map_err(|e| AppError::Git(format!("failed to read file: {e}")))?
        };

        let lines: Vec<FileLine> = content
            .lines()
            .enumerate()
            .filter_map(|(i, line)| {
                let line_num = (i as u32) + 1; // 1-based
                if line_num >= start_line && line_num <= end_line {
                    Some(FileLine {
                        line_number: line_num,
                        content: format!(" {}", line), // space prefix = context line
                    })
                } else {
                    None
                }
            })
            .collect();

        Ok(lines)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}
```

- [ ] **Step 2: Register the command in lib.rs**

In `src-tauri/src/lib.rs`, add `diff::get_file_lines` after the existing diff commands (line ~117):

```rust
            diff::get_diff_for_commit,
            diff::get_file_lines,
```

- [ ] **Step 3: Verify it compiles**

Run: `cd src-tauri && cargo clippy`
Expected: No errors or warnings.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/diff.rs src-tauri/src/lib.rs
git commit -m "feat: add get_file_lines Rust command for context expansion"
```

---

### Task 2: Frontend API + types for `get_file_lines`

**Files:**
- Modify: `src/api.ts:182` (add API wrapper)
- Modify: `src/types.ts:196` (add FileLine type)

- [ ] **Step 1: Add `FileLine` type**

In `src/types.ts`, after the `DiffLine` interface (~line 196), add:

```typescript
export interface FileLine {
  lineNumber: number;
  content: string;
}
```

- [ ] **Step 2: Add API wrapper**

In `src/api.ts`, after the `getDiffForCommit` function (~line 182), add:

```typescript
export function getFileLines(
  repoPath: string,
  filePath: string,
  startLine: number,
  endLine: number,
  commitHash?: string,
): Promise<FileLine[]> {
  return invoke("get_file_lines", {
    repoPath,
    filePath,
    startLine,
    endLine,
    commitHash: commitHash ?? null,
  });
}
```

Add `FileLine` to the imports from `../types` at the top of `api.ts` (wherever `DiffFile` is imported).

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/api.ts src/types.ts
git commit -m "feat: add getFileLines API wrapper and FileLine type"
```

---

### Task 3: Global unified/split toggle in ChangesView

**Files:**
- Modify: `src/components/changes/ChangesView.tsx:311-329` (add toggle to toolbar)

- [ ] **Step 1: Wire up `setDiffViewMode` from the store**

In `ChangesView.tsx`, the component already reads `diffViewMode` from the store (line 63). Add the setter:

```typescript
const setDiffViewMode = useWorkspaceStore((s) => s.setDiffViewMode);
```

Add this after the existing `diffViewMode` line (line 63).

- [ ] **Step 2: Add the toggle buttons to the toolbar**

Replace the toolbar `<div>` (lines 311-329) with:

```tsx
<div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-b border-border-default flex-shrink-0">
  <span className="text-[10px] text-text-tertiary">
    {viewMode === "changes"
      ? `${reviewedCount}/${displayFiles.length} files`
      : selectedCommitIndex !== null
        ? `${displayFiles.length} file${displayFiles.length !== 1 ? "s" : ""} in commit`
        : "Select a commit"}
  </span>
  {displayFiles.length > 0 && (
    <div className="flex items-center gap-1.5 ml-auto">
      <button className="text-[10px] text-text-tertiary hover:text-text-primary" onClick={expandAll}>
        Expand all
      </button>
      <span className="text-text-tertiary/50">|</span>
      <button className="text-[10px] text-text-tertiary hover:text-text-primary" onClick={collapseAll}>
        Collapse all
      </button>
      <span className="text-text-tertiary/50 mx-1">|</span>
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
    </div>
  )}
</div>
```

- [ ] **Step 3: Verify it compiles and renders**

Run: `npx tsc --noEmit`
Expected: No errors.

Visual verify: Open the app, navigate to the Changes view. The Unified/Split toggle should appear in the toolbar. Clicking "Split" should highlight it (though rendering won't change yet). Refreshing should persist the selection.

- [ ] **Step 4: Commit**

```bash
git add src/components/changes/ChangesView.tsx
git commit -m "feat: add global unified/split toggle to changes toolbar"
```

---

### Task 4: SplitDiffLine component

**Files:**
- Create: `src/components/changes/SplitDiffLine.tsx`

- [ ] **Step 1: Create the SplitDiffLine component**

This component renders a single row of the split view — one line on the left (old), one on the right (new). Either side can be empty.

Create `src/components/changes/SplitDiffLine.tsx`:

```tsx
import { memo, useEffect, useRef, useState } from "react";
import { tokenizeLine, getLangFromPath } from "../../services/syntaxHighlighter";
import type { ThemedToken } from "shiki";

interface SplitSide {
  lineNumber: number | null;
  content: string; // includes prefix (+/-/space)
  lineType: "context" | "addition" | "deletion";
}

interface SplitDiffLineProps {
  left: SplitSide | null;
  right: SplitSide | null;
  filePath: string;
  onClickLine?: (lineNumber: number) => void;
  children?: React.ReactNode;
}

const SIDE_BG: Record<string, string> = {
  addition: "bg-diff-added/15",
  deletion: "bg-diff-removed/15",
  context: "",
  empty: "bg-bg-primary/50",
};

const GUTTER_BG: Record<string, string> = {
  addition: "bg-diff-added/25",
  deletion: "bg-diff-removed/25",
  context: "",
  empty: "",
};

function SplitSideContent({
  side,
  filePath,
  onClickLine,
  align,
}: {
  side: SplitSide | null;
  filePath: string;
  onClickLine?: (lineNumber: number) => void;
  align: "left" | "right";
}) {
  const [tokens, setTokens] = useState<ThemedToken[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !side) return;
    let cancelled = false;
    const lang = getLangFromPath(filePath);
    const code =
      side.content.length > 0 &&
      (side.content[0] === "+" || side.content[0] === "-" || side.content[0] === " ")
        ? side.content.slice(1)
        : side.content;

    tokenizeLine(code, lang).then((result) => {
      if (!cancelled) setTokens(result);
    });
    return () => { cancelled = true; };
  }, [visible, side, filePath]);

  if (!side) {
    return (
      <div ref={ref} className={`flex-1 flex font-mono text-xs leading-5 ${SIDE_BG.empty}`}>
        <span className="w-[36px] flex-shrink-0">&nbsp;</span>
        <span className="flex-1">&nbsp;</span>
      </div>
    );
  }

  const bgClass = SIDE_BG[side.lineType];
  const gutterBgClass = GUTTER_BG[side.lineType];
  const canClick = onClickLine && side.lineNumber !== null && align === "right";

  return (
    <div
      ref={ref}
      className={[
        "flex-1 flex font-mono text-xs leading-5 group/split min-w-0",
        bgClass,
        canClick ? "cursor-pointer hover:bg-bg-hover/50" : "",
      ].join(" ")}
    >
      <span
        className={[
          "w-[36px] text-right pr-1.5 text-text-tertiary select-none flex-shrink-0 text-[10px]",
          gutterBgClass,
        ].join(" ")}
        onClick={canClick ? () => onClickLine!(side.lineNumber!) : undefined}
      >
        {side.lineNumber ?? ""}
      </span>
      <span className="flex-1 px-2 whitespace-pre overflow-x-auto">
        {tokens ? (
          tokens.map((token, i) => (
            <span key={i} style={token.color ? { color: token.color } : undefined}>
              {token.content}
            </span>
          ))
        ) : (
          <span className="text-text-primary">
            {side.content.length > 0 ? side.content.slice(1) : ""}
          </span>
        )}
      </span>
    </div>
  );
}

const SplitDiffLine = memo(function SplitDiffLine({
  left,
  right,
  filePath,
  onClickLine,
  children,
}: SplitDiffLineProps) {
  return (
    <>
      <div className="flex">
        <SplitSideContent side={left} filePath={filePath} onClickLine={onClickLine} align="left" />
        <div className="w-px bg-border-default flex-shrink-0" />
        <SplitSideContent side={right} filePath={filePath} onClickLine={onClickLine} align="right" />
      </div>
      {children}
    </>
  );
});

export { SplitDiffLine };
export type { SplitSide, SplitDiffLineProps };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/SplitDiffLine.tsx
git commit -m "feat: add SplitDiffLine component for side-by-side diff rendering"
```

---

### Task 5: Line pairing utility for split view

**Files:**
- Create: `src/components/changes/splitPairing.ts`

- [ ] **Step 1: Create the line pairing utility**

This function takes a flat array of DiffLines (from a hunk) and pairs them into rows for split view rendering.

Create `src/components/changes/splitPairing.ts`:

```typescript
import type { DiffLine } from "../../types";
import type { SplitSide } from "./SplitDiffLine";

export interface SplitRow {
  left: SplitSide | null;
  right: SplitSide | null;
}

/**
 * Pair diff lines into split-view rows.
 *
 * Rules:
 * - Context lines appear on both sides
 * - Consecutive deletions followed by consecutive additions are paired as modifications (1:1)
 * - Extra deletions or additions beyond the paired count get blank on the opposite side
 * - Standalone deletions → left only, right blank
 * - Standalone additions → right only, left blank
 */
export function pairLinesForSplit(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.lineType === "context") {
      rows.push({
        left: { lineNumber: line.oldLineNumber, content: line.content, lineType: "context" },
        right: { lineNumber: line.newLineNumber, content: line.content, lineType: "context" },
      });
      i++;
      continue;
    }

    if (line.lineType === "deletion") {
      // Collect consecutive deletions
      const deletions: DiffLine[] = [];
      while (i < lines.length && lines[i].lineType === "deletion") {
        deletions.push(lines[i]);
        i++;
      }

      // Collect consecutive additions immediately after
      const additions: DiffLine[] = [];
      while (i < lines.length && lines[i].lineType === "addition") {
        additions.push(lines[i]);
        i++;
      }

      // Pair them 1:1
      const maxLen = Math.max(deletions.length, additions.length);
      for (let j = 0; j < maxLen; j++) {
        const del = deletions[j] ?? null;
        const add = additions[j] ?? null;
        rows.push({
          left: del
            ? { lineNumber: del.oldLineNumber, content: del.content, lineType: "deletion" }
            : null,
          right: add
            ? { lineNumber: add.newLineNumber, content: add.content, lineType: "addition" }
            : null,
        });
      }
      continue;
    }

    if (line.lineType === "addition") {
      // Standalone addition (not preceded by deletions)
      rows.push({
        left: null,
        right: { lineNumber: line.newLineNumber, content: line.content, lineType: "addition" },
      });
      i++;
      continue;
    }

    i++;
  }

  return rows;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/splitPairing.ts
git commit -m "feat: add line pairing utility for split diff view"
```

---

### Task 6: Integrate split view into DiffFileCard

**Files:**
- Modify: `src/components/changes/DiffFileCard.tsx`

- [ ] **Step 1: Add imports**

At the top of `DiffFileCard.tsx`, add:

```typescript
import { SplitDiffLine } from "./SplitDiffLine";
import { pairLinesForSplit } from "./splitPairing";
```

- [ ] **Step 2: Use the viewMode prop instead of ignoring it**

On line 59, change:

```typescript
      viewMode: _viewMode,
```

to:

```typescript
      viewMode,
```

- [ ] **Step 3: Replace the lines rendering block with a conditional**

Replace the lines rendering section inside the hunk loop (lines 197-265, the `{hunk.lines.map((line, lineIndex) => { ... })}` block) with:

```tsx
{/* Lines */}
{viewMode === "split" ? (
  // Split view: pair lines into left/right rows
  pairLinesForSplit(hunk.lines).map((row, rowIndex) => {
    // Use right side line number for annotations (matches new file)
    const lineNumber = row.right?.lineNumber ?? row.left?.lineNumber ?? null;
    const lineAnnotations = lineNumber !== null
      ? (annotationsByLine.get(lineNumber) ?? [])
      : [];
    const lineComments = lineNumber !== null
      ? (prCommentsByLine.get(lineNumber) ?? [])
      : [];
    const isActiveAnnotationLine =
      lineNumber !== null && activeAnnotationLine === lineNumber;
    const hasComments = lineComments.length > 0;
    const commentsExpanded =
      lineNumber !== null && expandedCommentLines.has(lineNumber);

    return (
      <SplitDiffLine
        key={rowIndex}
        left={row.left}
        right={row.right}
        filePath={file.path}
        onClickLine={
          lineNumber !== null
            ? (ln) => onAddAnnotation(file.path, ln)
            : undefined
        }
      >
        {/* PR comment indicator */}
        {hasComments && lineNumber !== null && (
          <div className="flex justify-end pr-2">
            <DiffCommentIndicator
              count={lineComments.length}
              onClick={() => toggleCommentLine(lineNumber)}
            />
          </div>
        )}

        {/* PR comment thread */}
        {hasComments && commentsExpanded && (
          <DiffCommentThread comments={lineComments} />
        )}

        {/* Existing annotations */}
        {lineAnnotations.map((ann) => (
          <AnnotationBubble
            key={ann.id}
            annotation={ann}
            onDelete={onDeleteAnnotation}
          />
        ))}

        {/* Active annotation input */}
        {isActiveAnnotationLine && lineNumber !== null && (
          <AnnotationInput
            onSubmit={(text) =>
              onSubmitAnnotation(file.path, lineNumber, text)
            }
            onCancel={() => onAddAnnotation(file.path, lineNumber)}
          />
        )}
      </SplitDiffLine>
    );
  })
) : (
  // Unified view: existing rendering
  hunk.lines.map((line, lineIndex) => {
    const lineNumber =
      line.newLineNumber ?? line.oldLineNumber ?? null;

    const lineAnnotations = lineNumber !== null
      ? (annotationsByLine.get(lineNumber) ?? [])
      : [];
    const lineComments = lineNumber !== null
      ? (prCommentsByLine.get(lineNumber) ?? [])
      : [];
    const isActiveAnnotationLine =
      lineNumber !== null &&
      activeAnnotationLine === lineNumber;
    const hasComments = lineComments.length > 0;
    const commentsExpanded =
      lineNumber !== null &&
      expandedCommentLines.has(lineNumber);

    return (
      <SyntaxDiffLine
        key={lineIndex}
        content={line.content}
        lineType={line.lineType}
        oldLineNumber={line.oldLineNumber}
        newLineNumber={line.newLineNumber}
        filePath={file.path}
        onClickLine={
          lineNumber !== null
            ? () => onAddAnnotation(file.path, lineNumber)
            : undefined
        }
      >
        {/* PR comment indicator */}
        {hasComments && lineNumber !== null && (
          <div className="flex justify-end pr-2">
            <DiffCommentIndicator
              count={lineComments.length}
              onClick={() => toggleCommentLine(lineNumber)}
            />
          </div>
        )}

        {/* PR comment thread */}
        {hasComments && commentsExpanded && (
          <DiffCommentThread comments={lineComments} />
        )}

        {/* Existing annotations */}
        {lineAnnotations.map((ann) => (
          <AnnotationBubble
            key={ann.id}
            annotation={ann}
            onDelete={onDeleteAnnotation}
          />
        ))}

        {/* Active annotation input (only on additions/context, not deletions) */}
        {isActiveAnnotationLine && lineNumber !== null && line.lineType !== "deletion" && (
          <AnnotationInput
            onSubmit={(text) =>
              onSubmitAnnotation(file.path, lineNumber, text)
            }
            onCancel={() => onAddAnnotation(file.path, lineNumber)}
          />
        )}
      </SyntaxDiffLine>
    );
  })
)}
```

- [ ] **Step 4: Update the memo equality check**

In the memo equality check at the bottom of the file (lines 273-280), add `viewMode` comparison. Change:

```typescript
  prev.file.path === next.file.path &&
  prev.expanded === next.expanded &&
```

to:

```typescript
  prev.file.path === next.file.path &&
  prev.expanded === next.expanded &&
  prev.viewMode === next.viewMode &&
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Visual verify**

Open the app, navigate to Changes view with a file that has modifications. Toggle to Split view. Verify:
- Context lines appear on both sides
- Deletions appear on the left, additions on the right
- Modifications (del→add) align on the same row
- Pure additions have empty left side, pure deletions have empty right side
- Annotations and PR comments still work

- [ ] **Step 7: Commit**

```bash
git add src/components/changes/DiffFileCard.tsx
git commit -m "feat: integrate split view rendering in DiffFileCard"
```

---

### Task 7: ExpandContextButton component

**Files:**
- Create: `src/components/changes/ExpandContextButton.tsx`

- [ ] **Step 1: Create the ExpandContextButton component**

Create `src/components/changes/ExpandContextButton.tsx`:

```tsx
import { memo } from "react";
import { ChevronsUp, ChevronsDown, Ellipsis } from "lucide-react";

interface ExpandContextButtonProps {
  /** Where this button sits relative to the hunks */
  position: "top" | "between" | "bottom";
  /** Number of hidden lines in the gap */
  hiddenLineCount: number;
  /** Called when user clicks to expand by ~20 lines */
  onExpandIncremental: (direction: "up" | "down") => void;
  /** Called when user clicks "Show all" */
  onExpandAll: () => void;
}

const EXPAND_INCREMENT = 20;

const ExpandContextButton = memo(function ExpandContextButton({
  position,
  hiddenLineCount,
  onExpandIncremental,
  onExpandAll,
}: ExpandContextButtonProps) {
  if (hiddenLineCount <= 0) return null;

  const showDualActions = position === "between" && hiddenLineCount > EXPAND_INCREMENT;

  return (
    <div className="flex items-center justify-center gap-2 px-3 py-1 bg-bg-secondary border-y border-border-subtle cursor-pointer select-none hover:bg-bg-hover transition-colors group">
      {position === "top" && (
        <button
          className="flex items-center gap-1.5 text-[11px] text-text-tertiary group-hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
          onClick={() => onExpandIncremental("up")}
        >
          <ChevronsUp size={14} />
          <span>Show {Math.min(hiddenLineCount, EXPAND_INCREMENT)} more lines</span>
        </button>
      )}

      {position === "bottom" && (
        <button
          className="flex items-center gap-1.5 text-[11px] text-text-tertiary group-hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
          onClick={() => onExpandIncremental("down")}
        >
          <ChevronsDown size={14} />
          <span>Show {Math.min(hiddenLineCount, EXPAND_INCREMENT)} more lines</span>
        </button>
      )}

      {position === "between" && !showDualActions && (
        <button
          className="flex items-center gap-1.5 text-[11px] text-text-tertiary group-hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
          onClick={onExpandAll}
        >
          <Ellipsis size={14} />
          <span>Show all {hiddenLineCount} lines</span>
        </button>
      )}

      {position === "between" && showDualActions && (
        <div className="flex items-center gap-3">
          <button
            className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
            onClick={() => onExpandIncremental("down")}
          >
            <ChevronsDown size={12} />
            Show {EXPAND_INCREMENT} lines
          </button>
          <span className="text-border-default text-[11px]">·</span>
          <button
            className="text-[11px] text-text-tertiary hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
            onClick={onExpandAll}
          >
            Show all {hiddenLineCount} lines
          </button>
          <span className="text-border-default text-[11px]">·</span>
          <button
            className="flex items-center gap-1 text-[11px] text-text-tertiary hover:text-accent-primary transition-colors bg-transparent border-none cursor-pointer font-[inherit]"
            onClick={() => onExpandIncremental("up")}
          >
            <ChevronsUp size={12} />
            Show {EXPAND_INCREMENT} lines
          </button>
        </div>
      )}
    </div>
  );
});

export { ExpandContextButton, EXPAND_INCREMENT };
export type { ExpandContextButtonProps };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/ExpandContextButton.tsx
git commit -m "feat: add ExpandContextButton component for context expansion"
```

---

### Task 8: Context expansion logic in DiffFileCard

**Files:**
- Modify: `src/components/changes/DiffFileCard.tsx`

This is the most complex task. DiffFileCard needs to:
1. Track which gaps have been expanded and what lines were fetched
2. Compute where gaps exist (top of file, between hunks, bottom of file)
3. Merge expanded lines into the hunk data for rendering
4. Call `getFileLines` to fetch context

- [ ] **Step 1: Add imports and props**

Add to the imports at the top of `DiffFileCard.tsx`:

```typescript
import { useCallback, useMemo, useState as useLocalState } from "react";
import { ExpandContextButton, EXPAND_INCREMENT } from "./ExpandContextButton";
import { getFileLines } from "../../api";
import type { DiffLine } from "../../types";
```

Note: `useState` is already imported. We need `useCallback` and `useMemo` — check if they're already imported and add if missing.

Add two new props to `DiffFileCardProps`:

```typescript
interface DiffFileCardProps {
  file: DiffFile;
  expanded: boolean;
  onToggleExpanded: (path: string) => void;
  viewMode: DiffViewMode;
  annotations: Annotation[];
  activeAnnotationLine: number | null;
  onAddAnnotation: (filePath: string, lineNumber: number) => void;
  onSubmitAnnotation: (filePath: string, lineNumber: number, text: string) => void;
  onDeleteAnnotation: (annotationId: string) => void;
  prComments: PrComment[];
  repoPath: string;        // NEW
  commitHash?: string;      // NEW — for committed diffs
}
```

- [ ] **Step 2: Add context expansion state and logic inside the component**

Inside the `DiffFileCard` component function, after the existing state declarations, add:

```typescript
// ── Context expansion state ──────────────────────────────
// Maps "gap key" → fetched context DiffLines.
// Gap keys: "top", "between-0-1", "between-1-2", ..., "bottom"
const [expandedGaps, setExpandedGaps] = useState<Map<string, DiffLine[]>>(new Map());

// Compute gap info: how many hidden lines between each hunk
const gapInfo = useMemo(() => {
  const gaps: Array<{ key: string; position: "top" | "between" | "bottom"; hiddenLines: number; startLine: number; endLine: number }> = [];
  const hunks = file.hunks;
  if (hunks.length === 0) return gaps;

  // Gap above first hunk
  const firstHunk = hunks[0];
  const firstOldStart = firstHunk.oldStart;
  if (firstOldStart > 1) {
    const alreadyExpanded = expandedGaps.get("top")?.length ?? 0;
    const hidden = firstOldStart - 1 - alreadyExpanded;
    if (hidden > 0) {
      gaps.push({
        key: "top",
        position: "top",
        hiddenLines: hidden,
        startLine: 1 + alreadyExpanded,
        endLine: firstOldStart - 1,
      });
    }
  }

  // Gaps between hunks
  for (let i = 0; i < hunks.length - 1; i++) {
    const currentHunk = hunks[i];
    const nextHunk = hunks[i + 1];
    // End of current hunk (last line number)
    const currentLastLine = currentHunk.lines.reduce((max, l) => {
      const n = l.oldLineNumber ?? l.newLineNumber ?? 0;
      return Math.max(max, n);
    }, 0);
    const nextStart = nextHunk.oldStart;
    const gapKey = `between-${i}-${i + 1}`;
    const alreadyExpanded = expandedGaps.get(gapKey)?.length ?? 0;
    const totalGap = nextStart - currentLastLine - 1;
    const hidden = totalGap - alreadyExpanded;
    if (hidden > 0) {
      gaps.push({
        key: gapKey,
        position: "between",
        hiddenLines: hidden,
        startLine: currentLastLine + 1 + alreadyExpanded,
        endLine: nextStart - 1,
      });
    }
  }

  // Gap below last hunk — we don't know total file length, so show expand-down
  // with a generic "20 more lines" (it'll stop when the file ends)
  gaps.push({
    key: "bottom",
    position: "bottom",
    hiddenLines: EXPAND_INCREMENT, // Approximate — backend will return fewer if at EOF
    startLine: 0, // Computed at expand time
    endLine: 0,
  });

  return gaps;
}, [file.hunks, expandedGaps]);

const handleExpandContext = useCallback(
  async (gapKey: string, direction: "up" | "down" | "all") => {
    const gap = gapInfo.find((g) => g.key === gapKey);
    if (!gap) return;

    let startLine: number;
    let endLine: number;

    if (direction === "all") {
      startLine = gap.startLine;
      endLine = gap.endLine;
    } else if (direction === "down") {
      // Expand down from the top of the gap
      startLine = gap.startLine;
      endLine = Math.min(gap.startLine + EXPAND_INCREMENT - 1, gap.endLine);
    } else {
      // Expand up from the bottom of the gap
      endLine = gap.endLine;
      startLine = Math.max(gap.endLine - EXPAND_INCREMENT + 1, gap.startLine);
    }

    // For bottom gap, compute from last hunk
    if (gapKey === "bottom") {
      const lastHunk = file.hunks[file.hunks.length - 1];
      const lastLineNum = lastHunk.lines.reduce((max, l) => {
        const n = l.newLineNumber ?? l.oldLineNumber ?? 0;
        return Math.max(max, n);
      }, 0);
      const alreadyExpanded = expandedGaps.get("bottom")?.length ?? 0;
      startLine = lastLineNum + 1 + alreadyExpanded;
      endLine = startLine + EXPAND_INCREMENT - 1;
    }

    try {
      const lines = await getFileLines(repoPath, file.path, startLine, endLine, commitHash);
      const contextLines: DiffLine[] = lines.map((l) => ({
        lineType: "context" as const,
        content: l.content,
        oldLineNumber: l.lineNumber,
        newLineNumber: l.lineNumber,
      }));

      setExpandedGaps((prev) => {
        const next = new Map(prev);
        const existing = next.get(gapKey) ?? [];
        // Merge: for "up" direction, prepend; for "down"/"all", append
        if (direction === "up") {
          next.set(gapKey, [...contextLines, ...existing]);
        } else {
          next.set(gapKey, [...existing, ...contextLines]);
        }
        return next;
      });
    } catch (err) {
      console.error("Failed to expand context:", err);
    }
  },
  [gapInfo, file.hunks, file.path, repoPath, commitHash, expandedGaps],
);
```

- [ ] **Step 3: Render expand buttons and expanded lines in the diff body**

Replace the diff body rendering (the section inside `{expanded && hasBeenVisible && ( ... )}`) with a version that includes expand buttons. The structure should be:

```tsx
{expanded && hasBeenVisible && (
  <div className="bg-bg-primary overflow-x-auto">
    {file.hunks.map((hunk, hunkIndex) => {
      // Find gap info for above this hunk
      const topGap = hunkIndex === 0
        ? gapInfo.find((g) => g.key === "top")
        : gapInfo.find((g) => g.key === `between-${hunkIndex - 1}-${hunkIndex}`);

      const topGapKey = hunkIndex === 0 ? "top" : `between-${hunkIndex - 1}-${hunkIndex}`;
      const topExpandedLines = expandedGaps.get(topGapKey) ?? [];

      return (
        <div key={hunkIndex}>
          {/* Expand button above this hunk */}
          {topGap && (
            <ExpandContextButton
              position={topGap.position}
              hiddenLineCount={topGap.hiddenLines}
              onExpandIncremental={(dir) => handleExpandContext(topGapKey, dir)}
              onExpandAll={() => handleExpandContext(topGapKey, "all")}
            />
          )}

          {/* Expanded lines above this hunk */}
          {topExpandedLines.length > 0 && viewMode === "split" ? (
            topExpandedLines.map((line, li) => {
              const row = { left: { lineNumber: line.oldLineNumber, content: line.content, lineType: line.lineType as "context" }, right: { lineNumber: line.newLineNumber, content: line.content, lineType: line.lineType as "context" } };
              return <SplitDiffLine key={`exp-${topGapKey}-${li}`} left={row.left} right={row.right} filePath={file.path} />;
            })
          ) : (
            topExpandedLines.map((line, li) => (
              <SyntaxDiffLine
                key={`exp-${topGapKey}-${li}`}
                content={line.content}
                lineType={line.lineType}
                oldLineNumber={line.oldLineNumber}
                newLineNumber={line.newLineNumber}
                filePath={file.path}
              />
            ))
          )}

          {/* Hunk separator */}
          <div className="flex items-center gap-2 px-3 py-1 bg-bg-secondary border-y border-border-default font-mono text-[10px] text-text-tertiary select-none">
            <span>{hunk.header}</span>
          </div>

          {/* Lines — unified or split (from Task 6) */}
          {viewMode === "split" ? (
            /* ... split rendering from Task 6 ... */
          ) : (
            /* ... unified rendering from Task 6 ... */
          )}
        </div>
      );
    })}

    {/* Expand button below last hunk */}
    {(() => {
      const bottomGap = gapInfo.find((g) => g.key === "bottom");
      const bottomExpandedLines = expandedGaps.get("bottom") ?? [];
      return (
        <>
          {bottomExpandedLines.length > 0 && viewMode === "split" ? (
            bottomExpandedLines.map((line, li) => {
              const row = { left: { lineNumber: line.oldLineNumber, content: line.content, lineType: line.lineType as "context" }, right: { lineNumber: line.newLineNumber, content: line.content, lineType: line.lineType as "context" } };
              return <SplitDiffLine key={`exp-bottom-${li}`} left={row.left} right={row.right} filePath={file.path} />;
            })
          ) : (
            bottomExpandedLines.map((line, li) => (
              <SyntaxDiffLine
                key={`exp-bottom-${li}`}
                content={line.content}
                lineType={line.lineType}
                oldLineNumber={line.oldLineNumber}
                newLineNumber={line.newLineNumber}
                filePath={file.path}
              />
            ))
          )}
          {bottomGap && (
            <ExpandContextButton
              position="bottom"
              hiddenLineCount={bottomGap.hiddenLines}
              onExpandIncremental={(dir) => handleExpandContext("bottom", dir)}
              onExpandAll={() => handleExpandContext("bottom", "all")}
            />
          )}
        </>
      );
    })()}
  </div>
)}
```

Note: The `/* ... split/unified rendering from Task 6 ... */` comments refer to the rendering code already added in Task 6. Keep that code in place — just wrap it in this new structure that adds expand buttons before/after hunks.

- [ ] **Step 4: Update memo equality to include new props**

Add to the memo equality check:

```typescript
  prev.repoPath === next.repoPath &&
  prev.commitHash === next.commitHash &&
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/changes/DiffFileCard.tsx
git commit -m "feat: add context expansion logic and rendering to DiffFileCard"
```

---

### Task 9: Pass repoPath and commitHash from ChangesView to DiffFileCard

**Files:**
- Modify: `src/components/changes/ChangesView.tsx`

- [ ] **Step 1: Compute the commitHash for the current view**

In `ChangesView`, before the return statement, add:

```typescript
const activeCommitHash =
  viewMode === "commits" && selectedCommitIndex !== null && commits[selectedCommitIndex]
    ? commits[selectedCommitIndex].hash
    : undefined;
```

- [ ] **Step 2: Pass the new props to DiffFileCard**

In the `DiffFileCard` JSX, add the two new props:

```tsx
<DiffFileCard
  key={file.path}
  ref={...}
  file={file}
  expanded={!collapsedFiles.has(file.path)}
  onToggleExpanded={handleToggleExpanded}
  viewMode={diffViewMode}
  annotations={annotations}
  activeAnnotationLine={activeAnnotationLine}
  onAddAnnotation={handleAddAnnotation}
  onSubmitAnnotation={handleSubmitAnnotation}
  onDeleteAnnotation={handleDeleteAnnotation}
  prComments={prComments}
  repoPath={repoPath}
  commitHash={activeCommitHash}
/>
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Visual verify**

Open the app, navigate to a file with multiple hunks. Verify:
- Expand buttons appear between hunks showing line counts
- Clicking "Show 20 lines" loads context lines from the backend
- Clicking "Show all N lines" loads the full gap
- Expanded lines appear as context (no +/- prefix)
- Both unified and split views render expanded lines correctly
- The expand button at the top of the file loads lines above the first hunk
- The expand button at the bottom loads lines below the last hunk

- [ ] **Step 5: Commit**

```bash
git add src/components/changes/ChangesView.tsx
git commit -m "feat: wire repoPath and commitHash through to DiffFileCard for context expansion"
```

---

### Task 10: Final polish and edge cases

**Files:**
- Modify: `src/components/changes/DiffFileCard.tsx` (minor fixes)

- [ ] **Step 1: Reset expanded gaps when file data changes**

In `DiffFileCard`, add an effect to reset the expanded gaps when the file prop changes (e.g., switching commits):

```typescript
useEffect(() => {
  setExpandedGaps(new Map());
}, [file]);
```

Add this after the `expandedGaps` state declaration.

- [ ] **Step 2: Handle added/deleted files gracefully**

For newly added files (`status === "added"`), there's no old file to expand from — the top expand button should be hidden. For deleted files, the bottom expand button should be hidden. Adjust the `gapInfo` calculation:

After the `gapInfo` memo, or within it, add conditions:

```typescript
// Don't show top expand for added files (no old file to reference)
// Don't show bottom expand for deleted files
```

In the `gapInfo` memo, wrap the top gap logic:
```typescript
if (firstOldStart > 1 && file.status !== "added") {
```

And for the bottom gap:
```typescript
if (file.status !== "deleted") {
  gaps.push({ ... bottom gap ... });
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Final visual verification**

Test these scenarios:
1. Unified view with expand buttons — loads context correctly
2. Split view with expand buttons — loads context on both sides
3. Toggle between unified/split — display updates, expand state preserved
4. Switch between commits — expanded gaps reset
5. Added file — no top expand button
6. Deleted file — no bottom expand button
7. Large file with many hunks — expand between any pair of hunks
8. Keyboard navigation (`]`/`[`) still works in split view

- [ ] **Step 5: Commit**

```bash
git add src/components/changes/DiffFileCard.tsx
git commit -m "fix: reset expanded context on file change, hide expand for added/deleted files"
```
