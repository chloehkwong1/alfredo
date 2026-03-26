# Changes View Redesign

## Overview

Redesign the changes view from a sidebar+diff split layout to a GitHub PR-style stacked file card layout with a toggleable right-side file tree for navigation.

## Goals

- Clean, spacious GitHub PR review feel
- All files visible in a single scrollable view
- Quick file navigation via toggleable file tree (right side)
- Keep existing annotation system intact
- Maintain both "All changes" and "By commit" modes

## Layout Architecture

### Primary View: Stacked File Cards

All changed files render vertically in a scrollable container. No permanent sidebar — the diff area gets the full width by default.

Each file is a **collapsible card** containing:
- **Sticky header**: file path (monospace), +/- stats, collapse/expand chevron
- **Hunk headers**: accent-tinted bar with `@@ -n,n +n,n @@` and function context
- **Diff lines**: old line number | new line number | +/- marker | content
  - Additions: `bg-diff-added/6` background
  - Deletions: `bg-diff-removed/6` background
  - Context: muted text, no background
  - Hover: row highlight
- **Hidden lines separator**: "⋯ N unchanged lines hidden" between hunks
- **Inline annotations**: click a line to open input, bubbles render below annotated lines (existing behavior preserved)

Card styling:
- `border border-border-subtle` with `radius-md` corners
- `bg-bg-secondary` header, `bg-bg-primary` content
- 12px margin between cards
- Collapsed state shows header only

### Toolbar

Sticky at top of the changes view. Contains:
- **Left**: All changes / By commit mode toggle (segmented control)
- **Right**: Aggregate stats ("5 files · +234 −89"), File tree toggle button (folder icon)

The annotation status bar renders conditionally above the toolbar when annotations exist (same as current).

### Toggleable File Tree Sidebar (Right Side)

A ~220px sidebar that slides in from the **right** to avoid doubling up with the main worktree sidebar on the left.

**Toggle**: "File tree" button on the right side of the toolbar. Pushes content left (not overlay). Smooth 200ms transition.

**Contents**:
- Files grouped by directory with collapsible folder headers
- Directory names with disclosure triangle (e.g., `▼ src/components/`)
- Files indented, showing: status badge (A/M/D/R), filename, +/- count
- Deleted files: strikethrough + reduced opacity
- Currently visible file: accent left border highlight

**Scroll tracking**:
- Intersection observer on each file card header
- File tree highlights the currently visible file as user scrolls
- Clicking a file in the tree smooth-scrolls to that card

**State**: open/closed state persisted per session.

### Commit Mode Adaptation

When "By commit" is active:
- Commit detail bar appears above the stacked file cards (reuse existing `CommitDetailBar`)
- The right sidebar shows a commit list at the top (collapsible) with the file tree below
- Selecting a commit loads that commit's diff into the stacked cards

## Components

### New Components

- **StackedDiffView** — renders all files as stacked collapsible cards, manages scroll tracking
- **FileCard** — single file's diff in a card (header + hunks + lines + annotations)
- **FileTreeSidebar** — right-side toggleable sidebar with directory-grouped file list
- **HiddenLinesIndicator** — "⋯ N unchanged lines hidden" separator between hunks

### Modified Components

- **ChangesView** — orchestrator: remove left panel split, render toolbar + stacked view + optional right sidebar
- **DiffToolbar** — add file tree toggle button on right side, remove file count from left (move to right with stats)

### Reused As-Is

- **CommitList** — moves into the right sidebar when in commit mode
- **CommitDetailBar** — renders above stacked cards in commit mode
- **AnnotationBubble** — inline below diff lines (unchanged)
- **AnnotationInput** — inline input on click (unchanged)

### Removed

- **FileList** — replaced by FileTreeSidebar (different layout: directory-grouped, right-side)
- **DiffViewer** — replaced by StackedDiffView + FileCard (stacked cards instead of single-file viewer)

## Data Flow

No changes to the backend or data fetching. The same `getDiff`, `getCommits`, and `getDiffForCommit` API calls feed the new components. State management stays in `ChangesView`:

- `files: DiffFile[]` — all files rendered as stacked cards
- `commits: CommitInfo[]` — commit list for commit mode
- `currentCommitIndex: number` — selected commit
- `expandedFiles: Set<string>` — **new**: tracks which file cards are expanded (default: all)
- `fileTreeOpen: boolean` — **new**: sidebar toggle state
- `activeAnnotationLine` / annotations — unchanged

Scroll tracking is handled by `StackedDiffView` using intersection observer, reporting the currently visible file path up to `ChangesView` (or directly to `FileTreeSidebar` via ref/callback).

## Styling

Uses existing design tokens throughout. No new tokens needed.

- Cards: `border-border-subtle`, `radius-md`, `bg-bg-secondary` headers, `bg-bg-primary` content
- Diff colors: `bg-diff-added/6`, `bg-diff-removed/6`, existing line number opacity styles
- Hunk headers: `bg-accent-primary/8`, `text-accent-primary`
- File tree: `bg-bg-secondary`, `border-border-subtle` left border
- Sidebar transition: `transition-normal` (200ms ease)
- Typography: `font-mono text-xs leading-5` for diff content

## Out of Scope

- Syntax highlighting (future enhancement)
- Side-by-side diff mode (future enhancement)
- Expand hidden lines on click (can add later, just visual separator for now)
- File tree filter/search input (can add later)
