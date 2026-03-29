# Changes Tab Improvements — Design Spec

**Date:** 2026-03-29
**Scope:** 7 improvements to the PR panel and changes view

---

## 1. PR Description — Full Text with Media Link

**Current:** `formatPrBody` strips `<img>` tags and renders text with a Show more/less toggle. Description can be hidden or truncated.

**Change:**
- Pre-pass counts media items: `<img>`, `<video>`, and markdown images `![...](...)` before stripping them
- Also strip `<video>` tags and markdown image syntax
- `PrDescription` always shows full text (no `line-clamp-3` by default, keep Show more/less for very long descriptions)
- When media count > 0, add a footer below the description text:
  - "View full description on GitHub ↗" link (opens `pr.url` in browser)
  - Muted text: "N images, N videos not shown" (only show counts that are non-zero)

**Files:** `src/components/changes/PrPanel.tsx` — `formatPrBody()` and `PrDescription` component

---

## 2. Fix Jump-to-Comment

**Current:** Clicking a comment card in the PR panel does nothing, even though `onJumpToComment` is wired up.

**Root cause (to verify):** The `jumpToComment` callback is read from Zustand in `PaneView` at render time (line 42). When `ChangesView` is already mounted and the Changes tab is active, `PaneView` calls the captured reference directly (line 76). If `ChangesView` re-registered a new callback due to re-render, the stale closure in PaneView may hold `null`.

**Fix approach:**
- Read `jumpToComment` from `usePrStore.getState()` at call time instead of from the render-time selector, ensuring the latest callback is always used
- If still broken, trace the full chain: `CommentCard.onClick` → `PrPanel.onJumpToComment` → `PaneView.handleJumpToComment` → store lookup → `ChangesView.handleJumpToComment`
- Verify the callback correctly: selects the file, scrolls to it, and highlights the comment line

**Files:** `src/components/layout/PaneView.tsx`, `src/stores/prStore.ts`, `src/components/changes/ChangesView.tsx`

---

## 3. Remove External Link Icon from PR Panel Header

**Current:** PR panel header has a small ↗ `ExternalLink` icon next to the PR number. The "Open PR #NNNNN ↗" button at the top of the Changes tab also exists.

**Change:**
- Remove the `<a>` with `ExternalLink` icon from the expanded PR panel header
- Keep the "Open PR #NNNNN ↗" button at the top of the Changes tab (always visible regardless of panel state)

**Files:** `src/components/changes/PrPanel.tsx` — the header section of the expanded panel

---

## 4. Fix Uncommitted Changes Over-Reporting

**Current:** The uncommitted changes section shows far too many files (e.g., 1857 files including `.envrc`, `.husky/pre-commit`, etc.). Happens across all repos.

**Expected behavior:** Show only:
- Files committed to this branch on remote (i.e., what shows as a diff on the PR — branch vs base)
- Any uncommitted local changes (staged + unstaged working tree changes)

**Investigation points:**
- The Rust `get_uncommitted_diff` command diffs working tree + index vs HEAD — this is correct
- Check whether `getDiff` (branch vs base) is returning files that overlap with uncommitted, causing duplication
- Check whether the base branch resolution is wrong (comparing against something other than origin/main)
- Check how `useChangesData` merges `uncommittedFiles` and `committedFiles` — possible labeling or deduplication issue
- Check if the repo path passed to the Rust command resolves correctly for worktrees

**Files:** `src/hooks/useChangesData.ts`, `src-tauri/src/commands/diff.rs` (`get_uncommitted_diff`, `get_diff`), `src/api.ts`

---

## 5. Commit View Header

**Current:** When selecting a commit in the Commits tab, the diff cards render immediately with no header. The commit subject/hash/time only appear in the sidebar list.

**Change:**
- When a commit is selected, render a header above the diff cards
- Split `CommitInfo.message` on first `\n` to separate subject from body (git already returns the full message including body)
- Header layout:
  - **Subject line:** bold, prominent text
  - **Body text:** below the subject in muted/secondary style, preserving line breaks
  - **Metadata row:** short hash (monospace) + relative timestamp, muted

**Files:** `src/components/changes/ChangesView.tsx`, `src/components/changes/FileSidebar.tsx` (for reference on existing commit rendering)

---

## 6. Agent Review Comments

Repurpose the existing annotation system to send batched code review comments to the active AI agent.

### 6.1 Comment UX Flow

1. **Click a diff line** (addition, deletion, or context) → GitHub-style comment input appears below the line
2. **Type comment, click "Comment"** (or press Cmd+Enter) → comment saved to store, rendered as a GitHub-style card inline on the diff
3. **Repeat** for multiple lines across multiple files
4. **Floating action bar** appears at the bottom of the Changes view when comments exist
5. **Click "Send to agent"** → all comments formatted and sent to the active Claude session
6. **Comments cleared** from store after sending

### 6.2 Comment Card Design (GitHub-style)

Submitted comments render as:
- Left border accent in gold (`#c8ab37` / `accent-primary`)
- Dark background (`#161b22`)
- Header bar: avatar (gold circle with "C") · "You" · relative timestamp ("just now") · "pending" status · ✕ delete button
- Body: comment text in secondary color

Input card renders as:
- Same left border and background
- Header bar: avatar · "You"
- Textarea with placeholder "Leave a comment for the agent..."
- Footer: Cancel + Comment buttons

### 6.3 Floating Action Bar

Positioned fixed at the bottom of the Changes view (above any scroll). Only visible when annotation count > 0.

Layout: `[count badge] "review comments"` on the left, `[Clear all] [Send to agent ⏎]` on the right.

- Count badge: gold background, dark text
- "Clear all": ghost button (border, no fill)
- "Send to agent ⏎": gold filled button

### 6.4 Message Format (Markdown, Grouped by File)

When sent, comments are formatted as:

```
Code review comments:

## app/models/user_company_pay_rate.rb

Line 4: Is it safe to remove this column? Are there any background jobs still writing to it?

Line 7: This pluralization looks wrong — should it be company_pay_rate (singular)?

## app/controllers/client/v2/user_company_pay_rates_controller.rb

Line 18: This change drops the pay_rate param — will existing API clients break?
```

### 6.5 Sending Mechanism

- Find the active Claude session for the current worktree via `sessionManager`
- Write the formatted message as bytes to the PTY via `writePty(sessionId, bytes)`
- Append a newline to submit the message
- After sending, call `clearAnnotations(worktreeId)` to remove all comments

### 6.6 Scope

Works on all diff views:
- Changes tab with PR
- Changes tab without PR (just branch changes)
- Commits tab (viewing a specific commit's diff)

The annotation system is already worktree-scoped and file/line-scoped, so no changes needed for scope.

### 6.7 Changes to Existing Components

- **`AnnotationBubble`**: Restyle from minimal bubble to GitHub-style comment card. Add timestamp display. Remove "annotations attach to your next terminal message" text.
- **`AnnotationInput`**: Replace single-line `<input>` with textarea + Cancel/Comment buttons in a GitHub-style card wrapper.
- **`Annotation` type**: Add optional `createdAt` timestamp field (or use existing `createdAt` which is already a `number`).
- **`ChangesView`**: Add `ReviewCommentBar` floating component.
- **New: `ReviewCommentBar`**: Floating bar component with count, clear, and send actions.
- **New: `formatAnnotationsForAgent()`**: Utility to group annotations by file and format as markdown.

---

## 7. Remove Redundant Status Banner States

**Current:** `MergeStatusBanner` shows a colored footer for all PR states: Merged, Closed, Ready to merge, Merge conflict, Changes requested, Draft, Open.

**Change:**
- Remove the "Open" state — redundant since you already know the PR is open
- Remove the "Draft" state — also apparent from the PR context
- Keep: Merged, Closed, Ready to merge, Merge conflict, Changes requested — these are actionable/informative states worth highlighting

**Files:** `src/components/changes/PrPanel.tsx` — `MergeStatusBanner` component
