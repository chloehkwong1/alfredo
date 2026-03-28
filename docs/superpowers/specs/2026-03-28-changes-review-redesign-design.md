# Changes & Review Redesign

## Overview

Redesign the changes review and PR review experience into a single unified "Changes" tab that replaces both the current Changes and PR tabs. The goal: make reviewing diffs in Alfredo good enough that you don't want to switch to GitHub.

## Core Problems

1. **Readability** — no syntax highlighting, text mushes together, diffs feel imposing
2. **Navigation** — hard to jump between files and click through commits
3. **Context clarity** — can't tell uncommitted changes from committed branch changes
4. **PR info discoverability** — PR status (checks, reviews, comments) hidden in a separate tab

## Design Decisions

### Tab Structure

- **Single "Changes" tab** replaces both the current Changes and PR tabs
- The tab is **right-aligned** in the tab bar, visually separated from terminal tabs (Claude, Shell, Server)
- Subtle accent glow when active to reinforce it's a different kind of view
- Tab type `"pr"` is removed from the system entirely

### Layout: Three-Zone Design

```
┌──────────┬─────────────────────────────┬──────────┐
│ File     │ Diff Viewer                 │ PR Panel │
│ Sidebar  │ (syntax highlighted,        │ (checks, │
│          │  unified or split,          │ reviews, │
│ 170-200px│  collapsible files)         │ comments)│
│          │                             │ 260px    │
└──────────┴─────────────────────────────┴──────────┘
```

### File Sidebar (Left Panel, ~180px)

The sidebar is the navigation hub for all changes:

- **All / Commits toggle** at the top — switch between viewing all branch changes as one diff, or browsing commit-by-commit
- **Uncommitted section** — files with working tree changes (staged + unstaged), with M/A/D status badges
- **Committed section** (in "All" mode) — all files changed on the branch vs main
- **Commit list** (in "Commits" mode) — list of commits with short hash + message; click to view that commit's diff

File interactions:
- Click a file → scroll diff pane to that file
- Collapse chevron → minimize a file you've already read
- Active file is highlighted

### Diff Viewer (Center)

- **Syntax highlighting** using Shiki (same engine as VS Code)
  - Tokens colored by language: keywords, strings, functions, types
  - Tied into the existing Alfredo theme system
  - Runs in the frontend (browser), not Rust backend
  - Can revisit with `syntect` if performance becomes an issue on large diffs
- **Unified / Split toggle** — button in each file header to switch between unified diff and side-by-side view
- **Collapsible files** — chevron on each file header to collapse; clicking a file in the sidebar expands and scrolls to it
- **Sticky file headers** — current file header sticks to the top while scrolling so you always know which file you're in
- **Line-level add/delete coloring** — green/red backgrounds on added/deleted lines (no word-level diff highlighting)
- **Inline annotations** — keep existing annotation system (user can add notes to diff lines)
- **PR comments inline** — when a PR comment references a specific line, render it inline in the diff at that line (like GitHub). Clicking a comment in the PR panel jumps to it in the diff.

### PR Panel (Right, 260px) + Activity Bar Rail (36px)

When a PR exists, a right-side panel shows PR details with a thin activity bar rail on the far right:

**Panel open (default when PR exists):**
- Header: PR number + GitHub link + `▸` collapse chevron
- **Checks section** — list of CI checks with status dots, durations, "view logs" link for failures
- **Reviews section** — reviewer avatars, name, approval/changes-requested state
- **Comments section** — cards with author, file:line reference (clickable to jump to diff), timestamp, comment body
- **Merge status** — summary banner (e.g., "Blocked: 1 failing check")

**Activity bar rail (always visible when PR exists):**
- Thin 36px icon strip on the right edge
- Lucide icons: CircleCheck (checks), Eye (reviews), MessageCircle (comments)
- Each icon has a badge count; checks badge is red when failing
- Icons are highlighted when panel is open

**Toggle interaction:**
- `▸` chevron in panel header → collapse to rail only
- `◂` arrow at top of collapsed rail → expand panel
- Clicking any rail icon → expand panel (also works as toggle when panel is open)
- `Cmd+I` keyboard shortcut → toggle panel

**No-PR state:**
- Activity bar rail does not appear at all
- File sidebar + diff viewer get full width
- Diff shows branch changes vs main

### What Gets Removed

**PR components replaced by the new panel** (8 files, ~759 lines):
- `PrDetailPanel.tsx`
- `PrHeader.tsx`
- `PrChecksSection.tsx`
- `PrReviewsSection.tsx`
- `PrCommentsSection.tsx`
- `PrConflictsSection.tsx`
- `CheckRunItem.tsx`
- `CollapsibleSection.tsx`

**Changes components rebuilt** (7 files):
- `ChangesView.tsx` — rebuilt as new unified view
- `StackedDiffView.tsx` — rebuilt with syntax highlighting + split view support
- `FileCard.tsx` — rebuilt as new diff file component
- `FileTreeSidebar.tsx` — rebuilt with uncommitted/committed sections + All/Commits toggle
- `DiffToolbar.tsx` — replaced by file header controls
- `CommitList.tsx` — replaced by commit list in file sidebar
- `CommitDetailBar.tsx` — replaced by commit info in sidebar

**Components carried forward:**
- `AnnotationBubble.tsx` — inline annotations
- `AnnotationInput.tsx` — annotation input form
- `DiffCommentIndicator.tsx` — PR comment count badge on diff lines
- `DiffCommentThread.tsx` — PR comment thread below diff lines

**Tab type `"pr"` removed** — only `"changes"` remains, moved to right-aligned position.

### New Dependencies

- `shiki` — syntax highlighting engine (npm package)

### Types Changes

- Remove `PrStatus.headSha` follow-up (no longer needed — PR panel fetches by PR number)
- `TabType` loses `"pr"` option
- Add `DiffViewMode: "unified" | "split"` preference (persisted in workspace store)
- Add `PrPanelState: "open" | "collapsed"` preference (persisted in workspace store)

## Out of Scope

- Create PR flow (future feature)
- Word-level diff highlighting
- Progress tracking / "viewed" checkboxes
- Performance audit (separate roadmap item)
