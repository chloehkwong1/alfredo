# Terminal Tab Revamp — Design Spec

## Overview

Revamp terminal tabs with two features: drag-and-drop tab reordering, and split view for side-by-side panes. Enables workflows like watching Claude work while reviewing Changes.

## Data Model

### Layout Tree

Recursive binary tree stored per worktree. Each node is either a leaf (a pane) or a split (two children).

```typescript
type LayoutNode =
  | { type: "leaf"; paneId: string }
  | { type: "split"; direction: "horizontal" | "vertical"; ratio: number; children: [LayoutNode, LayoutNode] };
```

Depth capped at 1 for now (max 2 panes). Single constant to change later.

### Pane State

New `panes` record in the Zustand store, alongside existing `tabs`:

```typescript
// Keyed by worktreeId, then paneId
panes: Record<string, Record<string, Pane>>

interface Pane {
  tabIds: string[];      // Ordered list — drag reorder mutates this
  activeTabId: string;   // Active tab within this pane
}
```

### Store Additions

New state fields on `workspaceStore`:

- `layout: Record<string, LayoutNode>` — layout tree per worktree
- `panes: Record<string, Record<string, Pane>>` — pane state per worktree
- `activePaneId: Record<string, string>` — focused pane per worktree

The existing `tabs: Record<string, WorkspaceTab[]>` remains as the canonical list of all tab objects. Panes reference tabs by ID only.

### Store Actions

- `splitPane(worktreeId, paneId, tabId, direction)` — move tab to new pane, create split node
- `closePane(worktreeId, paneId)` — prune leaf from tree, promote sibling
- `reorderTabs(worktreeId, paneId, fromIndex, toIndex)` — reorder `tabIds` array
- `moveTabToPane(worktreeId, tabId, fromPaneId, toPaneId)` — for future cross-pane moves
- `setActivePaneId(worktreeId, paneId)` — update focused pane
- `updateSplitRatio(worktreeId, splitNodePath, ratio)` — persist resize

Existing actions (`addTab`, `removeTab`, `setActiveTabId`) updated to operate pane-aware: new tabs go to the active pane, removing the last tab in a pane triggers `closePane`.

### Migration

Sessions without a `layout` field get a single-leaf layout auto-generated on load, with one pane containing all existing tab IDs. Zero breaking changes.

## Tab Drag Reordering

### Library

`@dnd-kit/core` + `@dnd-kit/sortable` (already installed, used for sidebar worktree drag).

### Implementation

- Each pane's tab bar wrapped in `SortableContext` with `horizontalListSortingStrategy`
- Each tab button uses `useSortable` hook
- `PointerSensor` with 5px activation distance (matches sidebar pattern)
- `onDragEnd` calls `reorderTabs()` to mutate the pane's `tabIds` array
- Drag overlay: ghost tab with slight rotation and drop shadow
- Drop indicator: vertical purple line between tabs at the drop position

### Scope

- Drag reorder within a single pane's tab bar only
- No cross-pane drag (use context menu "Split Right/Down" instead)
- All tab types participate in reordering, including Changes
- Changes tab can be reordered but still cannot be closed

## Split View

### Creating a Split

- Right-click any tab → context menu with **"Split Right"** and **"Split Down"**
- The clicked tab moves from its current pane to a new pane
- A split node replaces the current leaf in the layout tree
- Split options disabled if the pane has only 1 tab (can't leave a pane empty)

### Closing a Split

- When the last tab in a pane is closed or moved away, the pane auto-collapses
- The layout tree prunes the empty leaf and replaces the parent split node with the remaining child leaf
- No explicit "close pane" UI needed

### Resizing

- `react-resizable-panels` renders the split layout with a draggable divider
- Resize updates `ratio` in the layout tree
- xterm `fit()` fires automatically via existing `ResizeObserver` in `usePty`

### Focus

- Clicking anywhere in a pane sets it as `activePaneId`
- Keyboard shortcuts (`Cmd+T`, `Cmd+Shift+C`, etc.) operate on the active pane
- Active pane gets a subtle visual indicator — thin highlight on its tab bar border

### Tab Types in Splits

All tab types (claude, shell, server, changes, pr) can appear in any pane. No restrictions. Changes tab remains non-closeable regardless of which pane it's in.

## Rendering

### Layout Renderer

Recursive component that walks the layout tree:

- `leaf` node → renders a `PaneView` (tab bar + content area)
- `split` node → renders `PanelGroup` from `react-resizable-panels` with two children

```
<LayoutRenderer node={layout} />
  → <PanelGroup direction="horizontal">
      <Panel><PaneView paneId="pane-1" /></Panel>
      <PanelResizeHandle />
      <Panel><PaneView paneId="pane-2" /></Panel>
    </PanelGroup>
```

### PaneView Component

Extracted from current `AppShell.tsx` tab bar + main content area. Each pane is self-contained:

- Own tab bar with drag-reorder support
- Own content area rendering the active tab's component
- Own right-click context menu on tabs
- Add-tab dropdown scoped to the pane

### Terminal Lifecycle

No change to `SessionManager` or `usePty`. Terminals are keyed by `tabId`, not pane. Splitting doesn't create/destroy PTY sessions — it just changes which `PaneView` renders the tab's `TerminalView`.

The existing detach/reattach DOM pattern (move xterm element between containers) works naturally when a tab moves between panes.

## Session Persistence

### Schema Changes

`SessionData` gains two new fields:

```typescript
interface SessionData {
  tabs: WorkspaceTab[];
  activeTabId: string;           // Keep for migration compat
  layout?: LayoutNode;           // New
  panes?: Record<string, Pane>;  // New
  terminals: Record<string, { scrollback: string }>;
  savedAt: string;
}
```

### Save/Restore

- Auto-save (every 30s) serializes `layout` + `panes` alongside existing data
- Restore rebuilds split tree and pane assignments
- `react-resizable-panels` receives `ratio` from the tree for initial sizing
- Pre-split sessions (no `layout` field) auto-migrate to single-leaf layout

## New Dependency

- `react-resizable-panels` — for split divider resize behavior. Lightweight, well-maintained, supports horizontal/vertical panels with persistence.

## Out of Scope

- Cross-pane tab drag (drag a tab from one pane to another) — future enhancement
- Nested splits beyond depth 1 — data model supports it, UI caps it for now
- Keyboard-based tab reordering (`Cmd+Shift+←/→`)
- Tab pinning or locking
