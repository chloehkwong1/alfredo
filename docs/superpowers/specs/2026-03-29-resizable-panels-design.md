# Resizable Panels Design

## Overview

Make the three main panel boundaries in Alfredo resizable by the user, with widths persisted across sessions.

## Boundaries

### 1. Left Sidebar ↔ Main Content (`AppShell.tsx`)

- **Current:** `motion.div` with hardcoded `width: 320` + `div.flex-1`
- **Change:** Wrap both in `<PanelGroup direction="horizontal">` with `autoSaveId="sidebar"`. Remove `w-[320px]` from `Sidebar.tsx`. Keep Framer Motion entry animation on the wrapper.
- **Constraints:** default ~20%, min 10%, max 30%

### 2. File Sidebar ↔ Diff Area (`ChangesView.tsx`)

- **Current:** `FileSidebar` has `w-[200px]`, diff area is `flex-1`
- **Change:** Wrap `FileSidebar` + diff center in `<PanelGroup>` with `autoSaveId="changes-file-sidebar"`. Remove `w-[200px]` from `FileSidebar`.
- **Constraints:** default ~15%, min 8%, max 35%

### 3. Pane Content ↔ PR Panel (`PaneView.tsx`)

- **Current:** Content is `flex-1`, PrPanel is `w-[260px] shrink-0` (or `w-9` when collapsed)
- **Change:** When expanded, wrap content + PrPanel in `<PanelGroup>` with `autoSaveId="pr-panel"`. When collapsed, keep the current 36px rail with no resize.
- **Constraints:** default content ~82%/PR ~18%, min content 50%, min PR panel 12%

## Resize Handle Styling

Reuse the pattern from `LayoutRenderer.tsx`: 1px line with `bg-border-subtle hover:bg-accent-primary transition-colors data-[resize-handle-active]:bg-accent-primary`. Cursor changes to `col-resize` on hover.

## Persistence

Use `react-resizable-panels`' built-in `autoSaveId` prop which persists to `localStorage` automatically. No custom persistence code needed.

## Constraints Summary

| Boundary | Default | Min | Max |
|----------|---------|-----|-----|
| Sidebar | 20% | 10% | 30% |
| File sidebar | 15% | 8% | 35% |
| PR panel | 18% | 12% | 35% |

## Files to Modify

1. `src/components/layout/AppShell.tsx` — sidebar resize boundary
2. `src/components/sidebar/Sidebar.tsx` — remove `w-[320px]`
3. `src/components/changes/ChangesView.tsx` — file sidebar resize boundary
4. `src/components/changes/FileSidebar.tsx` — remove `w-[200px]`
5. `src/components/layout/PaneView.tsx` — PR panel resize boundary
6. `src/components/changes/PrPanel.tsx` — remove `w-[260px]` from expanded state

## What Doesn't Change

- Sidebar show/hide animation (Framer Motion)
- PR panel collapse/expand toggle (rail ↔ expanded)
- `LayoutRenderer.tsx` split panes (already resizable)
- No new dependencies
