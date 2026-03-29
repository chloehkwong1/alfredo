# Changes Tab Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix bugs and add features to the PR panel and changes view — 7 improvements covering description rendering, comment navigation, uncommitted changes, commit headers, agent review comments, and UI cleanup.

**Architecture:** Mostly frontend changes to existing React components in `src/components/changes/`. One investigation into the Rust diff command. The agent review comments feature repurposes the existing annotation system with restyled components and a new send mechanism.

**Tech Stack:** React, TypeScript, Zustand, Tauri (Rust backend), Lucide icons

**Spec:** `docs/superpowers/specs/2026-03-29-changes-tab-improvements-design.md`
**Mockups:** `designs/agent-review-comments.html`, `designs/agent-message-format.html`

---

### Task 1: Remove External Link Icon from PR Panel Header

**Files:**
- Modify: `src/components/changes/PrPanel.tsx:97-117`

- [ ] **Step 1: Remove the external link anchor from the header**

In `PrPanel.tsx`, the expanded panel header (around line 97-117) contains an `<a>` tag wrapping an `ExternalLink` icon. Remove the entire anchor element:

```tsx
// REMOVE this block (lines 101-110):
<a
  href={pr.url}
  target="_blank"
  rel="noreferrer"
  onClick={(e) => e.stopPropagation()}
  className="text-text-tertiary leading-none"
  title="Open on GitHub"
>
  <ExternalLink size={13} />
</a>
```

The "Open PR #NNNNN ↗" button at the top of the Changes tab (in `PaneView.tsx`) remains unchanged.

- [ ] **Step 2: Clean up unused import if ExternalLink is no longer used elsewhere**

Check if `ExternalLink` is still used in `PrPanel.tsx` (it is — in `CheckRunRow` and `CommentCard` and `DiffCommentThread`). If so, keep the import. If not, remove it.

- [ ] **Step 3: Verify visually**

Run the app and confirm the PR panel header shows only "PR #NNNNN" and the collapse chevron, with no external link icon.

- [ ] **Step 4: Commit**

```bash
git add src/components/changes/PrPanel.tsx
git commit -m "fix: remove redundant external link icon from PR panel header"
```

---

### Task 2: Remove Redundant Status Banner States

**Files:**
- Modify: `src/components/changes/PrPanel.tsx:496-556`

- [ ] **Step 1: Modify MergeStatusBanner to return null for Open and Draft**

In `MergeStatusBanner`, the last two return statements handle Draft (line 545-551) and Open (line 553-556). Change the Open fallback to return `null` and the Draft block to return `null`:

```tsx
function MergeStatusBanner({
  pr,
  mergeable,
  reviewDecision,
}: {
  pr: PrStatus;
  mergeable: boolean | null;
  reviewDecision: string | null;
}) {
  if (pr.merged) {
    return (
      <div className="px-2.5 py-1.5 bg-accent-primary/10 border-t border-accent-primary/20 text-xs text-accent-primary font-semibold shrink-0">
        Merged{pr.mergedAt ? ` · ${formatTimeAgo(pr.mergedAt)}` : ""}
      </div>
    );
  }

  if (pr.state === "closed") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        Closed
      </div>
    );
  }

  if (mergeable === true && reviewDecision === "APPROVED") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-added/10 border-t border-diff-added/20 text-xs text-diff-added font-semibold shrink-0">
        Ready to merge
      </div>
    );
  }

  if (mergeable === false) {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        Merge conflict
      </div>
    );
  }

  if (reviewDecision === "CHANGES_REQUESTED") {
    return (
      <div className="px-2.5 py-1.5 bg-diff-removed/10 border-t border-diff-removed/20 text-xs text-diff-removed font-semibold shrink-0">
        Changes requested
      </div>
    );
  }

  // Draft and Open states — not shown (redundant)
  return null;
}
```

- [ ] **Step 2: Verify visually**

Run the app with an open PR and confirm no status banner appears at the bottom. Check with a merged PR to confirm "Merged" still shows.

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/PrPanel.tsx
git commit -m "fix: remove redundant Open and Draft states from PR status banner"
```

---

### Task 3: PR Description — Full Text with Media Link

**Files:**
- Modify: `src/components/changes/PrPanel.tsx:185-241`

- [ ] **Step 1: Update formatPrBody to count and strip all media**

Replace the `formatPrBody` function and `PrDescription` component:

```tsx
/** Count media items in a PR body string. */
function countMedia(body: string): { images: number; videos: number } {
  const imgTags = (body.match(/<img[^>]*\/?>/gi) ?? []).length;
  const videoTags = (body.match(/<video[^>]*>[\s\S]*?<\/video>/gi) ?? []).length +
    (body.match(/<video[^>]*\/?>/gi) ?? []).length;
  const mdImages = (body.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length;
  return { images: imgTags + mdImages, videos: videoTags };
}

/** Lightly format a PR body for display: strip media, render headers as bold, preserve line breaks. */
function formatPrBody(body: string): React.ReactNode[] {
  // Strip HTML img tags, video tags, and markdown images
  const cleaned = body
    .replace(/<img[^>]*\/?>/gi, "")
    .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, "")
    .replace(/<video[^>]*\/?>/gi, "")
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
    .replace(/\|[-|]+\|/g, "");

  return cleaned.split("\n").map((line, i) => {
    // ## Headers → bold
    const headerMatch = line.match(/^#{1,3}\s+(.+)/);
    if (headerMatch) {
      return (
        <span key={i} className="block text-text-primary font-semibold mt-1 first:mt-0">
          {headerMatch[1]}
        </span>
      );
    }
    // Blank lines → small spacer
    if (line.trim() === "") {
      return <span key={i} className="block h-1" />;
    }
    // **bold** → <strong>
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={i} className="block">
        {parts.map((part, j) => {
          const boldMatch = part.match(/^\*\*(.+)\*\*$/);
          if (boldMatch) {
            return <strong key={j} className="text-text-primary">{boldMatch[1]}</strong>;
          }
          return part;
        })}
      </span>
    );
  });
}
```

- [ ] **Step 2: Update PrDescription to show media link**

Replace the `PrDescription` component. It needs `prUrl` as a new prop:

```tsx
function PrDescription({
  body,
  prUrl,
  expanded,
  onToggle,
}: {
  body: string;
  prUrl: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { images, videos } = countMedia(body);
  const hasMedia = images + videos > 0;

  const mediaSummary = [
    images > 0 ? `${images} image${images !== 1 ? "s" : ""}` : null,
    videos > 0 ? `${videos} video${videos !== 1 ? "s" : ""}` : null,
  ].filter(Boolean).join(", ");

  return (
    <div className="px-2.5 py-2 border-b border-border-subtle text-xs text-text-secondary leading-[1.5] overflow-hidden">
      <div className={expanded ? "" : "line-clamp-3"}>
        {formatPrBody(body)}
      </div>
      <button
        onClick={onToggle}
        className="text-accent-primary text-[10px] mt-1 bg-transparent border-none cursor-pointer p-0 font-[inherit]"
      >
        {expanded ? "Show less" : "Show more"}
      </button>
      {hasMedia && (
        <div className="mt-1.5 pt-1.5 border-t border-border-subtle">
          <a
            href={prUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent-primary text-[10px] hover:underline"
          >
            View full description on GitHub ↗
          </a>
          <div className="text-[10px] text-text-tertiary mt-0.5">
            {mediaSummary} not shown
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Update the PrDescription call site to pass prUrl**

In the expanded panel render (around line 123-124), update:

```tsx
{pr.body && (
  <PrDescription body={pr.body} prUrl={pr.url} expanded={descExpanded} onToggle={() => setDescExpanded(!descExpanded)} />
)}
```

- [ ] **Step 4: Verify visually**

Run the app with a PR that has images in the description. Confirm:
- Images are stripped from the text
- "View full description on GitHub ↗" link appears with media count
- For PRs without images, the link does not appear

- [ ] **Step 5: Commit**

```bash
git add src/components/changes/PrPanel.tsx
git commit -m "feat: show full PR description text with media link to GitHub"
```

---

### Task 4: Fix Jump-to-Comment

**Files:**
- Modify: `src/components/layout/PaneView.tsx:42-80`

- [ ] **Step 1: Fix stale callback reference in PaneView**

The issue is that `PaneView` reads `jumpToComment` from the Zustand selector at render time (line 42), then uses it inside `handleJumpToComment` (line 75-76). If `ChangesView` re-registered a new callback, the closure still holds the old one.

Fix by reading from the store at call time instead:

```tsx
// Remove this line (around line 42):
// const jumpToComment = usePrStore((s) => s.jumpToComment[worktreeId]);

// Update handleJumpToComment to read from store at call time:
const handleJumpToComment = useCallback(
  (filePath: string, line: number) => {
    // If Changes tab isn't active, switch to it first
    const changesTab = tabs.find((t) => t.type === "changes");
    if (changesTab && activeTab?.type !== "changes") {
      setPaneActiveTab(worktreeId, paneId, changesTab.id);
      // Poll for the jumpToComment callback to appear (registered by ChangesView on mount)
      let attempts = 0;
      const poll = setInterval(() => {
        attempts++;
        const fn = usePrStore.getState().jumpToComment[worktreeId];
        if (fn) {
          clearInterval(poll);
          fn(filePath, line);
        } else if (attempts >= 20) {
          clearInterval(poll);
          console.warn("[PaneView] jumpToComment callback not registered after 2s");
        }
      }, 100);
    } else {
      // Read fresh from store — not from the stale closure
      const fn = usePrStore.getState().jumpToComment[worktreeId];
      if (fn) {
        fn(filePath, line);
      }
    }
  },
  [tabs, activeTab, worktreeId, paneId, setPaneActiveTab],
);
```

Note: remove `jumpToComment` from the dependency array since we no longer use the selector value.

- [ ] **Step 2: Verify the fix**

Run the app with an open PR that has comments with file paths and line numbers. Click a comment card in the PR panel. Verify:
- The diff scrolls to the correct file
- The correct line is highlighted
- Works both when Changes tab is already active and when switching from another tab

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/PaneView.tsx
git commit -m "fix: resolve stale callback in jump-to-comment causing clicks to do nothing"
```

---

### Task 5: Investigate and Fix Uncommitted Changes Over-Reporting

**Files:**
- Investigate: `src/hooks/useChangesData.ts`, `src-tauri/src/commands/diff.rs`
- Possibly modify: `src/hooks/useChangesData.ts` and/or `src-tauri/src/commands/diff.rs`

- [ ] **Step 1: Add debug logging to diagnose the issue**

In `useChangesData.ts`, add temporary console logs to see what each API call returns:

```tsx
// In the uncommitted files effect (around line 28):
getUncommittedDiff(repoPath)
  .then((files) => {
    console.log(`[useChangesData] uncommitted files: ${files.length}`, files.slice(0, 5).map(f => f.path));
    if (!cancelled) setUncommittedFiles(files);
  })

// In the committed files effect (around line 36):
getDiff(repoPath, baseBranch)
  .then((files) => {
    console.log(`[useChangesData] committed files (base=${baseBranch}): ${files.length}`, files.slice(0, 5).map(f => f.path));
    if (!cancelled) setCommittedFiles(files);
  })
```

- [ ] **Step 2: Check the output and identify the root cause**

Run the app and open the dev console. Look at the counts:
- If `uncommittedFiles` has the huge count → the Rust `get_uncommitted_diff` is returning too much
- If `committedFiles` has the huge count → the base branch resolution is wrong or `get_diff` is comparing against the wrong ref
- If both are reasonable but combined they're huge → deduplication issue

Common root causes to check:
1. `baseBranch` is `undefined` — check that `pr?.baseBranch` is populated. If not, `getDiff` falls back to the default branch detection which may fail
2. The Rust `get_diff` command's `resolve_default_branch` returns the wrong branch
3. For worktrees, the repo path may resolve to the main repo instead of the worktree

- [ ] **Step 3: Implement the fix based on findings**

The fix depends on the root cause found in Step 2. Likely candidates:

**If baseBranch is undefined (no PR):** `getDiff` should compare against `origin/main` or `origin/master`. Check that `resolve_default_branch` in `diff.rs` correctly finds the default branch.

**If the diff includes files not on this branch:** The Rust `get_diff` uses a merge-base approach. Verify it's using `merge_base` between HEAD and the default branch, not a direct tree comparison.

**If deduplication:** Filter `committedFiles` to exclude any file paths already in `uncommittedFiles`:

```tsx
const displayFiles = useMemo(() => {
  switch (viewMode) {
    case "changes": {
      const uncommittedPaths = new Set(uncommittedFiles.map(f => f.path));
      const uniqueCommitted = committedFiles.filter(f => !uncommittedPaths.has(f.path));
      return [...uncommittedFiles, ...uniqueCommitted];
    }
    case "commits": return selectedCommitIndex !== null ? commitFiles : [];
  }
}, [viewMode, uncommittedFiles, committedFiles, commitFiles, selectedCommitIndex]);
```

- [ ] **Step 4: Remove debug logging**

Remove the `console.log` statements added in Step 1.

- [ ] **Step 5: Verify visually**

Run the app on multiple repos. Confirm the uncommitted section only shows files with actual local changes, and the committed section shows the PR diff.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useChangesData.ts
# Also add Rust files if modified:
# git add src-tauri/src/commands/diff.rs
git commit -m "fix: resolve uncommitted changes showing incorrect files across repos"
```

---

### Task 6: Commit View Header

**Files:**
- Modify: `src/components/changes/ChangesView.tsx:282-336`

- [ ] **Step 1: Add CommitHeader component**

Add a new component in `ChangesView.tsx` (above the `ChangesView` function):

```tsx
function CommitHeader({ commit }: { commit: CommitInfo }) {
  const firstNewline = commit.message.indexOf("\n");
  const subject = firstNewline === -1 ? commit.message : commit.message.slice(0, firstNewline);
  const body = firstNewline === -1 ? "" : commit.message.slice(firstNewline + 1).trim();

  return (
    <div className="px-4 py-3 border-b border-border-default bg-bg-secondary">
      <div className="text-sm font-semibold text-text-primary leading-snug">
        {subject}
      </div>
      {body && (
        <div className="text-xs text-text-secondary mt-1.5 whitespace-pre-wrap leading-relaxed">
          {body}
        </div>
      )}
      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-text-tertiary">
        <span className="font-mono">{commit.shortHash}</span>
        <span>·</span>
        <span>{formatRelativeTime(commit.timestamp)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add imports**

Add `CommitInfo` to the type imports and `formatRelativeTime` to the imports at the top of `ChangesView.tsx`:

```tsx
import type { CommitInfo } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";
```

Also ensure `commits` is available — it's already returned by `useChangesData`.

- [ ] **Step 3: Render CommitHeader when a commit is selected**

In the center diff area (around line 303), add the header above the file cards. Find the `<div className="flex-1 overflow-y-auto min-w-0">` and add the header inside it, before the file map:

```tsx
<div className="flex-1 overflow-y-auto min-w-0">
  {viewMode === "commits" && selectedCommitIndex !== null && commits[selectedCommitIndex] && (
    <CommitHeader commit={commits[selectedCommitIndex]} />
  )}
  {displayFiles.map((file) => (
```

- [ ] **Step 4: Verify visually**

Run the app, switch to Commits tab, select a commit. Confirm:
- Subject line appears bold above the diff cards
- Body text (if present) appears below in muted style
- Short hash and relative time appear below that
- Commits with no body (single-line messages) don't show extra whitespace

- [ ] **Step 5: Commit**

```bash
git add src/components/changes/ChangesView.tsx
git commit -m "feat: show full commit message header in commits view"
```

---

### Task 7: Restyle AnnotationBubble to GitHub-Style Comment Card

**Files:**
- Modify: `src/components/changes/AnnotationBubble.tsx`

- [ ] **Step 1: Restyle the component**

Replace the contents of `AnnotationBubble.tsx` with a GitHub-style comment card:

```tsx
import { X } from "lucide-react";
import type { Annotation } from "../../types";
import { formatRelativeTime } from "./formatRelativeTime";

interface AnnotationBubbleProps {
  annotation: Annotation;
  onDelete: (id: string) => void;
}

function AnnotationBubble({ annotation, onDelete }: AnnotationBubbleProps) {
  return (
    <div className="my-1 border-l-2 border-accent-primary bg-[#161b22] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-primary/5 border-b border-border-subtle">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-primary text-text-on-accent text-2xs font-semibold flex items-center justify-center">
          C
        </span>
        <span className="text-xs font-semibold text-text-primary">You</span>
        <span className="text-[10px] text-text-tertiary">
          {formatRelativeTime(annotation.createdAt / 1000)}
        </span>
        <span className="text-[10px] text-text-tertiary">· pending</span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(annotation.id);
          }}
          className="ml-auto flex-shrink-0 p-0.5 rounded hover:bg-bg-hover text-text-tertiary hover:text-text-primary transition-colors cursor-pointer bg-transparent border-none"
          aria-label="Delete comment"
        >
          <X size={12} />
        </button>
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        <p className="text-xs text-text-secondary leading-relaxed m-0">{annotation.text}</p>
      </div>
    </div>
  );
}

export { AnnotationBubble };
export type { AnnotationBubbleProps };
```

- [ ] **Step 2: Verify visually**

Run the app, click a diff line, add an annotation. Confirm:
- Card has left gold border, dark background
- Header shows avatar, "You", timestamp, "pending"
- Delete button works
- No "annotations attach to your next terminal message" text

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/AnnotationBubble.tsx
git commit -m "feat: restyle annotation bubble as GitHub-style comment card"
```

---

### Task 8: Restyle AnnotationInput to GitHub-Style Comment Input

**Files:**
- Modify: `src/components/changes/AnnotationInput.tsx`

- [ ] **Step 1: Replace with textarea-based GitHub-style input**

Replace the contents of `AnnotationInput.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";

interface AnnotationInputProps {
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

function AnnotationInput({ onSubmit, onCancel }: AnnotationInputProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim()) {
      e.preventDefault();
      onSubmit(text.trim());
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="my-1 border-l-2 border-accent-primary bg-[#161b22] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-accent-primary/5 border-b border-border-subtle">
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent-primary text-text-on-accent text-2xs font-semibold flex items-center justify-center">
          C
        </span>
        <span className="text-xs font-semibold text-text-primary">You</span>
      </div>

      {/* Input area */}
      <div className="px-3 py-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Leave a comment for the agent..."
          rows={3}
          className="w-full px-2.5 py-2 rounded-md text-xs bg-bg-primary border border-border-default text-text-primary placeholder:text-text-tertiary outline-none focus:border-accent-primary/40 focus:ring-1 focus:ring-accent-primary/20 resize-y leading-relaxed"
        />
        <div className="flex justify-end gap-1.5 mt-1.5">
          <button
            onClick={onCancel}
            className="px-2.5 py-1 rounded-md text-[11px] text-text-secondary bg-transparent border border-border-default hover:bg-bg-hover cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => text.trim() && onSubmit(text.trim())}
            disabled={!text.trim()}
            className="px-2.5 py-1 rounded-md text-[11px] font-semibold text-text-on-accent bg-accent-primary hover:bg-accent-hover cursor-pointer border-none disabled:opacity-40 disabled:cursor-default"
          >
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}

export { AnnotationInput };
export type { AnnotationInputProps };
```

Note: Submit is now Cmd+Enter (not just Enter) since it's a textarea. The Comment button also submits.

- [ ] **Step 2: Verify visually**

Run the app, click a diff line. Confirm:
- Card has left gold border, dark background matching the AnnotationBubble
- Textarea is resizable with placeholder text
- Cancel closes it, Comment saves it (disabled when empty)
- Cmd+Enter submits, Escape cancels

- [ ] **Step 3: Commit**

```bash
git add src/components/changes/AnnotationInput.tsx
git commit -m "feat: restyle annotation input as GitHub-style comment card with textarea"
```

---

### Task 9: Update Send-to-Agent Bar and Message Format

**Files:**
- Modify: `src/components/changes/ChangesView.tsx:214-259`

- [ ] **Step 1: Update handleSendToClaude to use markdown grouped format**

Replace the `handleSendToClaude` function (around line 214-231):

```tsx
const handleSendToClaude = useCallback(async () => {
  if (annotations.length === 0) return;

  const tabs = useTabStore.getState().tabs[worktreeId] ?? [];
  const claudeTab = tabs.find((t) => t.type === "claude");
  const targetKey = claudeTab?.id ?? worktreeId;

  const session = sessionManager.getSession(targetKey);
  if (!session) return;

  // Group annotations by file
  const byFile = new Map<string, typeof annotations>();
  for (const a of annotations) {
    const list = byFile.get(a.filePath) ?? [];
    list.push(a);
    byFile.set(a.filePath, list);
  }

  // Format as markdown grouped by file
  let message = "\nCode review comments:\n";
  for (const [filePath, fileAnnotations] of byFile) {
    message += `\n## ${filePath}\n\n`;
    // Sort by line number within each file
    const sorted = [...fileAnnotations].sort((a, b) => a.lineNumber - b.lineNumber);
    for (const a of sorted) {
      message += `Line ${a.lineNumber}: ${a.text}\n\n`;
    }
  }

  const bytes = Array.from(new TextEncoder().encode(message));
  await writePty(session.sessionId, bytes);
  clearAnnotations(worktreeId);
}, [worktreeId, annotations, clearAnnotations]);
```

- [ ] **Step 2: Update the annotation status bar styling**

Replace the annotation status bar (around lines 236-259) with a floating bar at the bottom:

```tsx
{/* Floating review comment bar */}
{annotations.length > 0 && (
  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 bg-bg-primary border border-accent-primary/30 rounded-lg shadow-lg">
    <div className="flex items-center gap-2">
      <span className="bg-accent-primary text-text-on-accent text-[11px] font-bold px-2 py-0.5 rounded-full">
        {annotations.length}
      </span>
      <span className="text-xs text-text-secondary">
        review comment{annotations.length !== 1 ? "s" : ""}
      </span>
    </div>
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="ghost" onClick={() => clearAnnotations(worktreeId)}>
        Clear all
      </Button>
      <Button size="sm" variant="primary" onClick={handleSendToClaude}>
        Send to agent ⏎
      </Button>
    </div>
  </div>
)}
```

- [ ] **Step 3: Move the bar to be positioned relative to the diff area**

The floating bar needs a positioned parent. Update the outer container of `ChangesView` to use `relative` positioning. Change (around line 234):

```tsx
return (
  <div className="flex flex-col h-full relative">
```

And move the floating bar to be just before the closing `</div>` of the component (after the three-zone layout div), so it floats over the entire view:

```tsx
      </div> {/* end three-zone layout */}

      {/* Floating review comment bar */}
      {annotations.length > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-3 px-4 py-2 bg-bg-primary border border-accent-primary/30 rounded-lg shadow-lg">
          <div className="flex items-center gap-2">
            <span className="bg-accent-primary text-text-on-accent text-[11px] font-bold px-2 py-0.5 rounded-full">
              {annotations.length}
            </span>
            <span className="text-xs text-text-secondary">
              review comment{annotations.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => clearAnnotations(worktreeId)}>
              Clear all
            </Button>
            <Button size="sm" variant="primary" onClick={handleSendToClaude}>
              Send to agent ⏎
            </Button>
          </div>
        </div>
      )}
    </div>
  );
```

- [ ] **Step 4: Remove the old status bar**

Remove the old annotation status bar block (the `{annotations.length > 0 && ( ... )}` that was above the three-zone layout, around lines 236-259). This has been replaced by the floating bar.

- [ ] **Step 5: Clean up unused imports**

Remove `Send`, `Trash2`, `MessageSquare` from the lucide-react import at the top of `ChangesView.tsx` if they're no longer used:

```tsx
// Before:
import { Send, Trash2, MessageSquare } from "lucide-react";
// After (remove entirely if no longer used):
```

- [ ] **Step 6: Verify visually**

Run the app, add multiple annotations across different files. Confirm:
- Floating bar appears centered at the bottom with count, "Clear all", "Send to agent ⏎"
- "Send to agent" writes the markdown-formatted message to the Claude terminal
- Comments are cleared after sending
- Message groups comments by file with `##` headers and `Line N:` prefixes

- [ ] **Step 7: Commit**

```bash
git add src/components/changes/ChangesView.tsx
git commit -m "feat: floating review comment bar with markdown-grouped send to agent"
```

---

### Task 10: Remove AnnotationBubble/Input Left Margin (Align with Diff)

**Files:**
- Modify: `src/components/changes/DiffFileCard.tsx`

- [ ] **Step 1: Check current rendering of AnnotationBubble and AnnotationInput in DiffFileCard**

Read `DiffFileCard.tsx` to find where `AnnotationBubble` and `AnnotationInput` are rendered. They're passed as children to `SyntaxDiffLine`. The old components had `ml-24 mr-4` margins — the new GitHub-style cards should span the full width of the diff area instead.

Check that the new `AnnotationBubble` and `AnnotationInput` (from Tasks 7-8) don't have left margins (`ml-24`). If they do, remove them. The new components use `my-1` without horizontal margins, which is correct — they'll fill the width of the parent `SyntaxDiffLine` children area.

- [ ] **Step 2: Verify the alignment**

Run the app, add a comment on a diff line. Confirm:
- The comment card spans from the left edge of the diff content area to the right edge
- The gold left border aligns with the line gutter area
- It looks like a GitHub PR review comment inline in the diff

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add src/components/changes/DiffFileCard.tsx
git commit -m "fix: align annotation cards with diff content width"
```

---

### Task 11: Final Visual Verification

- [ ] **Step 1: Full walkthrough**

Run the app and test all 7 improvements end-to-end:

1. **PR description**: Open a PR with images in the body → text visible, media link shows count
2. **Jump-to-comment**: Click a comment in the PR panel → diff scrolls to file and highlights line
3. **External link**: PR panel header has no ↗ icon, only PR # and collapse chevron
4. **Uncommitted changes**: Check that the file count is reasonable (not 1857)
5. **Commit header**: Switch to Commits tab, select a commit → subject + body + hash shown above diffs
6. **Agent comments**: Click diff line → GitHub-style textarea → Comment → floating bar → Send to agent → check terminal
7. **Status banner**: Open PR shows no footer banner; merged/closed PR shows the appropriate banner

- [ ] **Step 2: Fix any issues found**

Address any visual or functional issues discovered during the walkthrough.

- [ ] **Step 3: Final commit if needed**

```bash
git add -A
git commit -m "fix: address visual issues from changes tab improvements walkthrough"
```
