# Split Diff View & Expandable Context — Design Spec

## Summary

Add two features to the Changes view:
1. **Split (side-by-side) diff view** — global toggle between unified and split rendering
2. **Expandable context lines** — load more surrounding lines between diff hunks on demand

## Feature 1: Split Diff View

### Global Toggle
- Unified/split button pair in the ChangesView toolbar (near expand/collapse controls)
- Persisted per-worktree using the existing `diffViewMode` field in workspace store
- Switches ALL file cards simultaneously

### Rendering
- **Unified** (current behavior): single column, deletions and additions interleaved, both line number gutters shown
- **Split**: two columns side-by-side
  - Left column: old file — deletions (red) + context lines, with old line number gutter
  - Right column: new file — additions (green) + context lines, with new line number gutter

### Line Pairing Logic
Within each hunk, lines are paired into rows:
- **Context lines** → appear on both sides at the same row
- **Deletion followed by addition** → modification, shown on the same row (left=old, right=new)
- **Consecutive deletions without matching additions** → left side only, right side blank
- **Consecutive additions without matching deletions** → right side only, left side blank

### Syntax Highlighting
- Reuses existing Shiki `tokenizeLine` for both columns
- Same lazy visibility detection + concurrency limiting (max 6)

### Annotations & PR Comments
- Attach to the right (new file) column in split view
- Same behavior as addition/context lines in unified view

## Feature 2: Expandable Context Lines

### Backend Command
New Rust command: `get_file_lines`

**Parameters:**
- `repo_path: String` — repository path
- `file_path: String` — relative file path within repo
- `start_line: u32` — first line to return (1-based)
- `end_line: u32` — last line to return (inclusive)
- `commit_hash: Option<String>` — if provided, reads from that commit; if null, reads working tree

**Returns:**
```typescript
{ lines: Array<{ lineNumber: number, content: string }> }
```

### Expand Buttons
Clickable rows appear at:
- **Between hunks** — when there's a gap between the end of one hunk and the start of the next
- **Above first hunk** — expand upward from the start of the file
- **Below last hunk** — expand downward to the end of the file

### Expand Behavior
- **"Show 20 more lines"** — fetches ~20 context lines from the backend, splices into hunk data as context lines
- **"Show all N lines"** — fetches the entire gap between hunks (shown when gap > 20 lines)
- Expanded lines are context lines (no +/- prefix, shown on both sides in split view)
- Expansion state is ephemeral — resets on diff refresh or file switch

### Visual Treatment
- Styled as a subtle clickable row spanning full width
- Chevron icon + line count label (e.g., "⋯ Show 20 more lines" / "⋯ Show all 45 lines")
- Same style in both unified and split view

## Data Flow & Integration

### Store Changes
- Wire up existing `diffViewMode` in workspace store to the global toggle
- No new persistent store fields; expanded context is ephemeral component state

### DiffFileCard State
- New local state: `expandedHunks` — tracks which gaps have been expanded and the fetched lines
- Merges fetched context lines into hunk data for rendering
- Both unified and split renderers consume the same merged hunk data

### New Components
- **`SplitDiffView`** — renders two-column layout for a single hunk, handles line pairing
- **`ExpandContextButton`** — clickable row between hunks / at file edges

### Modified Components
- **`ChangesView`** — add global unified/split toggle button
- **`DiffFileCard`** — switch between unified/split rendering based on `diffViewMode`, render expand buttons in gaps, manage expanded context state
- **`SyntaxDiffLine`** — support narrower column width for split view

### Keyboard Shortcuts
No new shortcuts. Existing `]`/`[` navigation and `x` collapse work regardless of view mode.

### Performance
- Split view: roughly same visible line count (two half-width columns vs one full-width)
- Context expansion: on-demand, no upfront cost
- Fetched context lines go through same lazy Shiki highlighting pipeline

## Approach
- **Split view**: frontend-only rendering change
- **Context expansion**: backend-assisted — new Rust command `get_file_lines` for precise line fetching without transferring whole files
