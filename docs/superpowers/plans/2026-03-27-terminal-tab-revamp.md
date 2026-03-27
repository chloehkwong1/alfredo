# Terminal Tab Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-and-drop tab reordering and split-pane view to the terminal workspace.

**Architecture:** Recursive binary layout tree (capped at depth 1) stored in Zustand, with per-pane tab lists. Tab reorder via `@dnd-kit/sortable`. Split resize via `react-resizable-panels`. Existing `SessionManager` and `usePty` unchanged — terminals are keyed by tabId, not pane.

**Tech Stack:** React, Zustand, @dnd-kit/core + @dnd-kit/sortable (existing), react-resizable-panels (new), Radix ContextMenu (existing), Framer Motion (existing)

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `LayoutNode`, `Pane` types |
| `src/stores/layoutStore.ts` | Create | Layout tree + pane state + all split/reorder actions |
| `src/components/layout/LayoutRenderer.tsx` | Create | Recursive component that renders layout tree → PanelGroup or PaneView |
| `src/components/layout/PaneView.tsx` | Create | Self-contained pane: tab bar + content area (extracted from AppShell) |
| `src/components/layout/PaneTabBar.tsx` | Create | Draggable tab bar for a single pane (extracted from TabBar in AppShell) |
| `src/components/layout/AppShell.tsx` | Modify | Replace inline TabBar + main with LayoutRenderer |
| `src/services/SessionPersistence.ts` | Modify | Add layout + panes to SessionData, migration for old sessions |

---

### Task 1: Add Layout Types

**Files:**
- Modify: `src/types.ts:199-258`

- [ ] **Step 1: Add LayoutNode and Pane types to types.ts**

Add after the `TabType` definition (line 201) and before `WorkspaceTab`:

```typescript
// ── Layout (split panes) ────────────────────────────────────────

export type LayoutNode =
  | { type: "leaf"; paneId: string }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      ratio: number;
      children: [LayoutNode, LayoutNode];
    };

export interface Pane {
  tabIds: string[];
  activeTabId: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add LayoutNode and Pane types for split view"
```

---

### Task 2: Install react-resizable-panels

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

Run: `npm install react-resizable-panels`

- [ ] **Step 2: Verify installation**

Run: `grep react-resizable-panels package.json`
Expected: `"react-resizable-panels": "^X.X.X"`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add react-resizable-panels dependency"
```

---

### Task 3: Create Layout Store

**Files:**
- Create: `src/stores/layoutStore.ts`

This store manages layout trees and pane assignments per worktree. It's separate from `workspaceStore` to keep concerns isolated — `workspaceStore` owns the canonical tab list, `layoutStore` owns where tabs are placed.

- [ ] **Step 1: Create the layout store**

Create `src/stores/layoutStore.ts`:

```typescript
import { create } from "zustand";
import type { LayoutNode, Pane } from "../types";

const MAX_SPLIT_DEPTH = 1;

interface LayoutState {
  /** Layout tree per worktree. */
  layout: Record<string, LayoutNode>;
  /** Pane state per worktree, keyed by paneId. */
  panes: Record<string, Record<string, Pane>>;
  /** Currently focused pane per worktree. */
  activePaneId: Record<string, string>;

  // ── Initialization ──
  /** Initialize layout for a worktree (single leaf with all tabs). */
  initLayout: (worktreeId: string, tabIds: string[], activeTabId: string) => void;
  /** Restore a persisted layout. */
  restoreLayout: (
    worktreeId: string,
    layout: LayoutNode,
    panes: Record<string, Pane>,
    activePaneId: string,
  ) => void;
  /** Clean up layout state when a worktree is removed. */
  removeLayout: (worktreeId: string) => void;

  // ── Split actions ──
  /** Split a pane by moving a tab to a new pane. Returns false if split rejected. */
  splitPane: (
    worktreeId: string,
    paneId: string,
    tabId: string,
    direction: "horizontal" | "vertical",
  ) => boolean;
  /** Close a pane, promoting its sibling to replace the parent split. */
  closePane: (worktreeId: string, paneId: string) => void;
  /** Update the split ratio after a resize. */
  updateSplitRatio: (worktreeId: string, ratio: number) => void;

  // ── Pane actions ──
  /** Set the active pane for a worktree. */
  setActivePaneId: (worktreeId: string, paneId: string) => void;
  /** Set the active tab within a pane. */
  setPaneActiveTab: (worktreeId: string, paneId: string, tabId: string) => void;
  /** Add a tab to a pane's tab list. */
  addTabToPane: (worktreeId: string, paneId: string, tabId: string) => void;
  /** Remove a tab from its pane. Auto-closes pane if empty. */
  removeTabFromPane: (worktreeId: string, tabId: string) => void;
  /** Reorder tabs within a pane. */
  reorderTabs: (worktreeId: string, paneId: string, fromIndex: number, toIndex: number) => void;

  // ── Queries ──
  /** Find which pane contains a given tab. */
  findPaneForTab: (worktreeId: string, tabId: string) => string | null;
  /** Get pane state. */
  getPane: (worktreeId: string, paneId: string) => Pane | undefined;
}

function generatePaneId(): string {
  return `pane-${crypto.randomUUID().slice(0, 8)}`;
}

/** Get the depth of a layout tree. */
function treeDepth(node: LayoutNode): number {
  if (node.type === "leaf") return 0;
  return 1 + Math.max(treeDepth(node.children[0]), treeDepth(node.children[1]));
}

/** Replace a leaf node in the tree by paneId. Returns new tree or null if not found. */
function replaceLeaf(
  node: LayoutNode,
  targetPaneId: string,
  replacement: LayoutNode,
): LayoutNode | null {
  if (node.type === "leaf") {
    return node.paneId === targetPaneId ? replacement : null;
  }
  const leftResult = replaceLeaf(node.children[0], targetPaneId, replacement);
  if (leftResult) {
    return { ...node, children: [leftResult, node.children[1]] };
  }
  const rightResult = replaceLeaf(node.children[1], targetPaneId, replacement);
  if (rightResult) {
    return { ...node, children: [node.children[0], rightResult] };
  }
  return null;
}

/** Remove a leaf and promote its sibling. Returns new tree or null. */
function removeLeaf(node: LayoutNode, targetPaneId: string): LayoutNode | null {
  if (node.type === "leaf") return null; // Can't remove from a leaf
  // Check if either child is the target
  if (node.children[0].type === "leaf" && node.children[0].paneId === targetPaneId) {
    return node.children[1]; // Promote sibling
  }
  if (node.children[1].type === "leaf" && node.children[1].paneId === targetPaneId) {
    return node.children[0]; // Promote sibling
  }
  // Recurse into children
  const leftResult = removeLeaf(node.children[0], targetPaneId);
  if (leftResult) {
    return { ...node, children: [leftResult, node.children[1]] };
  }
  const rightResult = removeLeaf(node.children[1], targetPaneId);
  if (rightResult) {
    return { ...node, children: [node.children[0], rightResult] };
  }
  return null;
}

export const useLayoutStore = create<LayoutState>((set, get) => ({
  layout: {},
  panes: {},
  activePaneId: {},

  initLayout: (worktreeId, tabIds, activeTabId) => {
    const paneId = generatePaneId();
    set((s) => ({
      layout: { ...s.layout, [worktreeId]: { type: "leaf", paneId } },
      panes: {
        ...s.panes,
        [worktreeId]: { [paneId]: { tabIds, activeTabId } },
      },
      activePaneId: { ...s.activePaneId, [worktreeId]: paneId },
    }));
  },

  restoreLayout: (worktreeId, layout, panes, activePaneId) => {
    set((s) => ({
      layout: { ...s.layout, [worktreeId]: layout },
      panes: { ...s.panes, [worktreeId]: panes },
      activePaneId: { ...s.activePaneId, [worktreeId]: activePaneId },
    }));
  },

  removeLayout: (worktreeId) => {
    set((s) => {
      const { [worktreeId]: _l, ...restLayout } = s.layout;
      const { [worktreeId]: _p, ...restPanes } = s.panes;
      const { [worktreeId]: _a, ...restActive } = s.activePaneId;
      return { layout: restLayout, panes: restPanes, activePaneId: restActive };
    });
  },

  splitPane: (worktreeId, paneId, tabId, direction) => {
    const state = get();
    const tree = state.layout[worktreeId];
    const worktreePanes = state.panes[worktreeId];
    if (!tree || !worktreePanes) return false;

    const sourcePane = worktreePanes[paneId];
    if (!sourcePane) return false;

    // Can't split if source pane has only 1 tab
    if (sourcePane.tabIds.length <= 1) return false;

    // Check depth cap
    if (treeDepth(tree) >= MAX_SPLIT_DEPTH) return false;

    // Create new pane with the moved tab
    const newPaneId = generatePaneId();
    const newSourceTabIds = sourcePane.tabIds.filter((id) => id !== tabId);
    const newSourceActiveTab =
      sourcePane.activeTabId === tabId
        ? newSourceTabIds[0]
        : sourcePane.activeTabId;

    // Build the split node replacing the source leaf
    const splitNode: LayoutNode = {
      type: "split",
      direction,
      ratio: 0.5,
      children: [
        { type: "leaf", paneId },
        { type: "leaf", paneId: newPaneId },
      ],
    };

    const newTree = replaceLeaf(tree, paneId, splitNode);
    if (!newTree) return false;

    set((s) => ({
      layout: { ...s.layout, [worktreeId]: newTree },
      panes: {
        ...s.panes,
        [worktreeId]: {
          ...worktreePanes,
          [paneId]: { tabIds: newSourceTabIds, activeTabId: newSourceActiveTab },
          [newPaneId]: { tabIds: [tabId], activeTabId: tabId },
        },
      },
      activePaneId: { ...s.activePaneId, [worktreeId]: newPaneId },
    }));
    return true;
  },

  closePane: (worktreeId, paneId) => {
    const state = get();
    const tree = state.layout[worktreeId];
    const worktreePanes = state.panes[worktreeId];
    if (!tree || !worktreePanes) return;

    // If the tree is just a single leaf, don't close it
    if (tree.type === "leaf") return;

    const newTree = removeLeaf(tree, paneId);
    if (!newTree) return;

    const { [paneId]: _removed, ...remainingPanes } = worktreePanes;

    // If active pane was closed, switch to first remaining pane
    const newActivePaneId =
      state.activePaneId[worktreeId] === paneId
        ? Object.keys(remainingPanes)[0]
        : state.activePaneId[worktreeId];

    set((s) => ({
      layout: { ...s.layout, [worktreeId]: newTree },
      panes: { ...s.panes, [worktreeId]: remainingPanes },
      activePaneId: { ...s.activePaneId, [worktreeId]: newActivePaneId },
    }));
  },

  updateSplitRatio: (worktreeId, ratio) => {
    set((s) => {
      const tree = s.layout[worktreeId];
      if (!tree || tree.type !== "split") return s;
      return {
        layout: { ...s.layout, [worktreeId]: { ...tree, ratio } },
      };
    });
  },

  setActivePaneId: (worktreeId, paneId) => {
    set((s) => ({
      activePaneId: { ...s.activePaneId, [worktreeId]: paneId },
    }));
  },

  setPaneActiveTab: (worktreeId, paneId, tabId) => {
    set((s) => {
      const worktreePanes = s.panes[worktreeId];
      if (!worktreePanes?.[paneId]) return s;
      return {
        panes: {
          ...s.panes,
          [worktreeId]: {
            ...worktreePanes,
            [paneId]: { ...worktreePanes[paneId], activeTabId: tabId },
          },
        },
      };
    });
  },

  addTabToPane: (worktreeId, paneId, tabId) => {
    set((s) => {
      const worktreePanes = s.panes[worktreeId];
      if (!worktreePanes) return s;
      // If no paneId specified or pane doesn't exist, use active pane
      const targetPaneId = worktreePanes[paneId] ? paneId : s.activePaneId[worktreeId];
      const pane = worktreePanes[targetPaneId];
      if (!pane) return s;
      return {
        panes: {
          ...s.panes,
          [worktreeId]: {
            ...worktreePanes,
            [targetPaneId]: {
              tabIds: [...pane.tabIds, tabId],
              activeTabId: tabId,
            },
          },
        },
      };
    });
  },

  removeTabFromPane: (worktreeId, tabId) => {
    const state = get();
    const worktreePanes = state.panes[worktreeId];
    if (!worktreePanes) return;

    // Find which pane contains this tab
    const paneEntry = Object.entries(worktreePanes).find(([, pane]) =>
      pane.tabIds.includes(tabId),
    );
    if (!paneEntry) return;

    const [paneId, pane] = paneEntry;
    const newTabIds = pane.tabIds.filter((id) => id !== tabId);

    if (newTabIds.length === 0) {
      // Pane is empty — close it (only if it's not the only pane)
      get().closePane(worktreeId, paneId);
      return;
    }

    const newActiveTabId =
      pane.activeTabId === tabId ? newTabIds[0] : pane.activeTabId;

    set((s) => ({
      panes: {
        ...s.panes,
        [worktreeId]: {
          ...worktreePanes,
          [paneId]: { tabIds: newTabIds, activeTabId: newActiveTabId },
        },
      },
    }));
  },

  reorderTabs: (worktreeId, paneId, fromIndex, toIndex) => {
    set((s) => {
      const worktreePanes = s.panes[worktreeId];
      const pane = worktreePanes?.[paneId];
      if (!pane) return s;

      const tabIds = [...pane.tabIds];
      const [moved] = tabIds.splice(fromIndex, 1);
      tabIds.splice(toIndex, 0, moved);

      return {
        panes: {
          ...s.panes,
          [worktreeId]: {
            ...worktreePanes,
            [paneId]: { ...pane, tabIds },
          },
        },
      };
    });
  },

  findPaneForTab: (worktreeId, tabId) => {
    const worktreePanes = get().panes[worktreeId];
    if (!worktreePanes) return null;
    const entry = Object.entries(worktreePanes).find(([, pane]) =>
      pane.tabIds.includes(tabId),
    );
    return entry ? entry[0] : null;
  },

  getPane: (worktreeId, paneId) => {
    return get().panes[worktreeId]?.[paneId];
  },
}));
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/stores/layoutStore.ts
git commit -m "feat(store): add layout store for split pane management"
```

---

### Task 4: Create PaneTabBar Component

**Files:**
- Create: `src/components/layout/PaneTabBar.tsx`

This extracts the tab rendering logic from `TabBar` in `AppShell.tsx` (lines 40-291) into a reusable component that supports drag-and-drop reordering within a single pane.

- [ ] **Step 1: Create PaneTabBar.tsx**

Create `src/components/layout/PaneTabBar.tsx`:

```typescript
import { useCallback } from "react";
import { motion } from "framer-motion";
import {
  Plus,
  X,
  Terminal,
  Sparkles,
  GitCompareArrows,
  GitPullRequest,
  Play,
  Square,
  PanelRight,
  PanelBottom,
} from "lucide-react";
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  DragOverlay,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/DropdownMenu";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "../ui/ContextMenu";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import type { TabType, WorkspaceTab } from "../../types";
import { useState } from "react";

const TAB_ICONS: Record<TabType, typeof Terminal> = {
  claude: Sparkles,
  shell: Terminal,
  server: Play,
  changes: GitCompareArrows,
  pr: GitPullRequest,
};

interface PaneTabBarProps {
  paneId: string;
  worktreeId: string;
  isActivePane: boolean;
  /** Callback to handle server toggle — passed down from AppShell */
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
}

function SortableTab({
  tab,
  isActive,
  canClose,
  worktreeId,
  paneId,
  onClose,
  onSplit,
}: {
  tab: WorkspaceTab;
  isActive: boolean;
  canClose: boolean;
  worktreeId: string;
  paneId: string;
  onClose: (e: React.MouseEvent, tabId: string) => void;
  onSplit: (tabId: string, direction: "horizontal" | "vertical") => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const Icon = TAB_ICONS[tab.type];
  const setPaneActiveTab = useLayoutStore((s) => s.setPaneActiveTab);
  const setActivePaneId = useLayoutStore((s) => s.setActivePaneId);

  // Check if split is possible (pane must have >1 tab, and tree depth must allow it)
  const layout = useLayoutStore((s) => s.layout[worktreeId]);
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const canSplit = (pane?.tabIds.length ?? 0) > 1 && layout?.type === "leaf";

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={setNodeRef}
          style={style}
          {...attributes}
          {...listeners}
          type="button"
          onClick={() => {
            setPaneActiveTab(worktreeId, paneId, tab.id);
            setActivePaneId(worktreeId, paneId);
          }}
          className={[
            "group h-full px-3 text-sm font-medium transition-colors cursor-pointer flex items-center gap-1.5 relative",
            isActive
              ? "text-text-primary"
              : "text-text-tertiary hover:text-text-secondary",
          ].join(" ")}
        >
          <Icon size={14} />
          <span>{tab.label}</span>
          {canClose && (
            <button
              type="button"
              tabIndex={0}
              aria-label={`Close ${tab.label} tab`}
              onClick={(e) => onClose(e, tab.id)}
              className="ml-0.5 opacity-0 group-hover:opacity-100 hover:bg-bg-tertiary rounded p-0.5 transition-opacity cursor-pointer"
            >
              <X size={12} />
            </button>
          )}
          {isActive && (
            <motion.div
              layoutId={`tab-underline-${paneId}`}
              className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent-primary"
              transition={{ type: "spring", stiffness: 500, damping: 35 }}
            />
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!canSplit}
          onSelect={() => onSplit(tab.id, "horizontal")}
        >
          <PanelRight size={14} />
          Split Right
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!canSplit}
          onSelect={() => onSplit(tab.id, "vertical")}
        >
          <PanelBottom size={14} />
          Split Down
        </ContextMenuItem>
        {canClose && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={(e) => onClose(e as unknown as React.MouseEvent, tab.id)}>
              <X size={14} />
              Close Tab
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function PaneTabBar({
  paneId,
  worktreeId,
  isActivePane,
  onToggleServer,
  isServerRunning,
  runScriptName,
}: PaneTabBarProps) {
  const allTabs = useWorkspaceStore((s) => s.tabs);
  const tabs = allTabs[worktreeId] ?? [];
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const reorderTabs = useLayoutStore((s) => s.reorderTabs);
  const splitPane = useLayoutStore((s) => s.splitPane);
  const addTab = useWorkspaceStore((s) => s.addTab);
  const removeTab = useWorkspaceStore((s) => s.removeTab);
  const removeTabFromPane = useLayoutStore((s) => s.removeTabFromPane);
  const setActivePaneId = useLayoutStore((s) => s.setActivePaneId);

  const [dragActiveId, setDragActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Resolve tab objects for this pane's tab IDs
  const paneTabs = (pane?.tabIds ?? [])
    .map((id) => tabs.find((t) => t.id === id))
    .filter((t): t is WorkspaceTab => t != null);

  const activeTabId = pane?.activeTabId;
  const claudeCount = paneTabs.filter((t) => t.type === "claude").length;
  const shellCount = paneTabs.filter((t) => t.type === "shell").length;

  // Check closability against ALL tabs in the worktree, not just this pane
  const allClaudeCount = tabs.filter((t) => t.type === "claude").length;
  const allShellCount = tabs.filter((t) => t.type === "shell").length;

  function canClose(tab: WorkspaceTab) {
    if (tab.type === "changes") return false;
    if (tab.type === "claude" && allClaudeCount <= 1) return false;
    if (tab.type === "shell" && allShellCount <= 1) return false;
    return true;
  }

  function handleCloseTab(e: React.MouseEvent | Event, tabId: string) {
    if ("stopPropagation" in e) e.stopPropagation();
    removeTab(worktreeId, tabId);
    removeTabFromPane(worktreeId, tabId);
  }

  function handleAddTab(type: TabType) {
    // addTab in workspaceStore creates the tab; we then need to add it to this pane
    // We'll get the new tab ID from the store after addTab
    const prevTabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];
    addTab(worktreeId, type);
    const newTabs = useWorkspaceStore.getState().tabs[worktreeId] ?? [];
    const newTab = newTabs.find((t) => !prevTabs.some((p) => p.id === t.id));
    if (newTab) {
      useLayoutStore.getState().addTabToPane(worktreeId, paneId, newTab.id);
    }
  }

  function handleSplit(tabId: string, direction: "horizontal" | "vertical") {
    splitPane(worktreeId, paneId, tabId, direction);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDragActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const tabIds = pane?.tabIds ?? [];
    const fromIndex = tabIds.indexOf(active.id as string);
    const toIndex = tabIds.indexOf(over.id as string);
    if (fromIndex === -1 || toIndex === -1) return;

    reorderTabs(worktreeId, paneId, fromIndex, toIndex);
  }

  const draggedTab = dragActiveId ? paneTabs.find((t) => t.id === dragActiveId) : null;

  // PR comment badge
  const prSummary = useWorkspaceStore((s) => s.prSummary);
  const commentCount = prSummary[worktreeId]?.unresolvedCommentCount ?? 0;

  return (
    <div
      className={[
        "flex items-center w-full h-10 bg-bg-bar border-b flex-shrink-0",
        isActivePane ? "border-accent-primary/30" : "border-border-subtle",
      ].join(" ")}
      onClick={() => setActivePaneId(worktreeId, paneId)}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => setDragActiveId(active.id as string)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragActiveId(null)}
      >
        <SortableContext
          items={pane?.tabIds ?? []}
          strategy={horizontalListSortingStrategy}
        >
          {paneTabs.map((tab) => {
            const isActive = tab.id === activeTabId;
            return (
              <SortableTab
                key={tab.id}
                tab={tab}
                isActive={isActive}
                canClose={canClose(tab)}
                worktreeId={worktreeId}
                paneId={paneId}
                onClose={handleCloseTab}
                onSplit={handleSplit}
              />
            );
          })}
        </SortableContext>

        <DragOverlay>
          {draggedTab ? (
            <div className="px-3 py-1.5 bg-bg-elevated text-text-primary text-sm font-medium rounded-md shadow-lg flex items-center gap-1.5 rotate-2">
              {(() => { const Icon = TAB_ICONS[draggedTab.type]; return <Icon size={14} />; })()}
              <span>{draggedTab.label}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Add tab button */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="h-10 px-2 text-text-tertiary hover:text-text-secondary transition-colors cursor-pointer flex items-center"
          >
            <Plus size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => handleAddTab("claude")}>
            <Sparkles size={14} /> New Claude tab
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleAddTab("shell")}>
            <Terminal size={14} /> New terminal tab
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => handleAddTab("pr")}>
            <GitPullRequest size={14} /> PR & Checks
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Server play/stop button (only in first pane) */}
      {onToggleServer && runScriptName && (
        <button
          type="button"
          onClick={onToggleServer}
          title={isServerRunning ? `Stop ${runScriptName}` : `Start ${runScriptName}`}
          className={[
            "h-10 px-2 transition-colors cursor-pointer flex items-center",
            isServerRunning
              ? "text-green-400 hover:text-red-400"
              : "text-text-tertiary hover:text-text-secondary",
          ].join(" ")}
        >
          {isServerRunning ? <Square size={14} /> : <Play size={14} />}
        </button>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Comment count badge (right-aligned, if this pane has Changes tab active) */}
      {commentCount > 0 && paneTabs.some((t) => t.type === "changes") && (
        <span className="mr-2 text-2xs bg-accent-primary/20 text-accent-primary px-1 rounded-full leading-none py-0.5">
          {commentCount}
        </span>
      )}
    </div>
  );
}

export { PaneTabBar };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (may have warnings about unused imports — that's fine, they'll be used when integrated)

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/PaneTabBar.tsx
git commit -m "feat(ui): add PaneTabBar with drag-reorder and split context menu"
```

---

### Task 5: Create PaneView Component

**Files:**
- Create: `src/components/layout/PaneView.tsx`

A self-contained pane that renders its own tab bar and content area. Extracted from the main content rendering in `AppShell.tsx` (lines 662-684).

- [ ] **Step 1: Create PaneView.tsx**

Create `src/components/layout/PaneView.tsx`:

```typescript
import { PaneTabBar } from "./PaneTabBar";
import { TerminalView } from "../terminal";
import { ChangesView } from "../changes/ChangesView";
import { PrDetailPanel } from "../pr/PrDetailPanel";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useLayoutStore } from "../../stores/layoutStore";
import type { WorkspaceTab } from "../../types";

interface PaneViewProps {
  paneId: string;
  worktreeId: string;
  /** Server toggle handler — only passed to the primary pane */
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
}

function PaneView({
  paneId,
  worktreeId,
  onToggleServer,
  isServerRunning,
  runScriptName,
}: PaneViewProps) {
  const worktree = useWorkspaceStore((s) =>
    s.worktrees.find((wt) => wt.id === worktreeId),
  );
  const allTabs = useWorkspaceStore((s) => s.tabs);
  const tabs = allTabs[worktreeId] ?? [];
  const pane = useLayoutStore((s) => s.panes[worktreeId]?.[paneId]);
  const activePaneId = useLayoutStore((s) => s.activePaneId[worktreeId]);
  const isActivePane = activePaneId === paneId;

  const activeTabId = pane?.activeTabId;
  const activeTab: WorkspaceTab | undefined = tabs.find((t) => t.id === activeTabId);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PaneTabBar
        paneId={paneId}
        worktreeId={worktreeId}
        isActivePane={isActivePane}
        onToggleServer={onToggleServer}
        isServerRunning={isServerRunning}
        runScriptName={runScriptName}
      />
      <div className="flex-1 min-h-0 relative">
        {(activeTab?.type === "claude" || activeTab?.type === "shell" || activeTab?.type === "server") && (
          <TerminalView
            key={activeTab.id}
            tabId={activeTab.id}
            tabType={activeTab.type}
          />
        )}
        {activeTab?.type === "pr" && worktree && (
          <PrDetailPanel worktree={worktree} repoPath={worktree.path} />
        )}
        {activeTab?.type === "changes" && (
          <ChangesView
            worktreeId={worktreeId}
            repoPath={worktree?.path ?? "."}
          />
        )}
      </div>
    </div>
  );
}

export { PaneView };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/PaneView.tsx
git commit -m "feat(ui): add PaneView component for self-contained pane rendering"
```

---

### Task 6: Create LayoutRenderer Component

**Files:**
- Create: `src/components/layout/LayoutRenderer.tsx`

Recursive component that walks the layout tree and renders either a `PaneView` (for leaf nodes) or a `PanelGroup` with resize handle (for split nodes).

- [ ] **Step 1: Create LayoutRenderer.tsx**

Create `src/components/layout/LayoutRenderer.tsx`:

```typescript
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { PaneView } from "./PaneView";
import { useLayoutStore } from "../../stores/layoutStore";
import type { LayoutNode } from "../../types";

interface LayoutRendererProps {
  worktreeId: string;
  /** Server toggle handler — forwarded to the first pane */
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
}

function RenderNode({
  node,
  worktreeId,
  onToggleServer,
  isServerRunning,
  runScriptName,
  isFirstLeaf,
}: {
  node: LayoutNode;
  worktreeId: string;
  onToggleServer?: () => void;
  isServerRunning?: boolean;
  runScriptName?: string;
  isFirstLeaf: boolean;
}) {
  if (node.type === "leaf") {
    return (
      <PaneView
        paneId={node.paneId}
        worktreeId={worktreeId}
        onToggleServer={isFirstLeaf ? onToggleServer : undefined}
        isServerRunning={isFirstLeaf ? isServerRunning : undefined}
        runScriptName={isFirstLeaf ? runScriptName : undefined}
      />
    );
  }

  const updateSplitRatio = useLayoutStore.getState().updateSplitRatio;
  const defaultSize = node.ratio * 100;

  return (
    <PanelGroup
      direction={node.direction}
      onLayout={(sizes) => {
        // sizes is [leftPercent, rightPercent]
        if (sizes.length === 2) {
          updateSplitRatio(worktreeId, sizes[0] / 100);
        }
      }}
    >
      <Panel defaultSize={defaultSize} minSize={20}>
        <RenderNode
          node={node.children[0]}
          worktreeId={worktreeId}
          onToggleServer={onToggleServer}
          isServerRunning={isServerRunning}
          runScriptName={runScriptName}
          isFirstLeaf={true}
        />
      </Panel>
      <PanelResizeHandle className="w-px bg-border-subtle hover:bg-accent-primary transition-colors data-[resize-handle-active]:bg-accent-primary" />
      <Panel defaultSize={100 - defaultSize} minSize={20}>
        <RenderNode
          node={node.children[1]}
          worktreeId={worktreeId}
          isFirstLeaf={false}
        />
      </Panel>
    </PanelGroup>
  );
}

function LayoutRenderer({
  worktreeId,
  onToggleServer,
  isServerRunning,
  runScriptName,
}: LayoutRendererProps) {
  const layout = useLayoutStore((s) => s.layout[worktreeId]);

  if (!layout) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-2">
        <span className="text-sm">Select a worktree to get started</span>
        <span className="text-xs">Each worktree gets its own branch, terminal, and agent</span>
      </div>
    );
  }

  return (
    <RenderNode
      node={layout}
      worktreeId={worktreeId}
      onToggleServer={onToggleServer}
      isServerRunning={isServerRunning}
      runScriptName={runScriptName}
      isFirstLeaf={true}
    />
  );
}

export { LayoutRenderer };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/LayoutRenderer.tsx
git commit -m "feat(ui): add LayoutRenderer for recursive split pane rendering"
```

---

### Task 7: Integrate Layout into AppShell

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

Replace the inline `TabBar` function and the main content conditional rendering with `LayoutRenderer`. Wire up layout initialization and keyboard shortcuts to be pane-aware.

- [ ] **Step 1: Add layout store imports and initialization**

In `AppShell.tsx`, add import for layout store and LayoutRenderer at the top (after existing imports around line 28):

```typescript
import { useLayoutStore } from "../../stores/layoutStore";
import { LayoutRenderer } from "./LayoutRenderer";
```

- [ ] **Step 2: Add layout initialization in the session restore effect**

In the `AppShell` component, after the `restoreTabs` call in the worktree loading effect (around line 408), initialize the layout store for each worktree.

Find the section around line 393-435 where worktrees are loaded and sessions restored. After `restoreTabs(wt.id, session.tabs, session.activeTabId)` (line 408), add layout initialization:

```typescript
// After restoreTabs, initialize layout
const sessionLayout = (session as any).layout;
const sessionPanes = (session as any).panes;
const sessionActivePaneId = (session as any).activePaneId;
if (sessionLayout && sessionPanes) {
  useLayoutStore.getState().restoreLayout(
    wt.id, sessionLayout, sessionPanes, sessionActivePaneId ?? Object.keys(sessionPanes)[0],
  );
} else {
  // Migrate: create single-pane layout from tab list
  const tabIds = session.tabs.map((t) => t.id);
  useLayoutStore.getState().initLayout(wt.id, tabIds, session.activeTabId);
}
```

And after `ensureDefaultTabs` (around line 53 in TabBar, but in AppShell's initial worktree setup), for worktrees that don't have a saved session, add layout init after `ensureDefaultTabs`:

Inside the `else` branch when no session exists (after the for loop at line 419), after the existing loop, add another loop for worktrees without sessions:

```typescript
// After the session restore loop, init layouts for worktrees without sessions
for (const wt of wts) {
  if (!useLayoutStore.getState().layout[wt.id]) {
    const wtTabs = useWorkspaceStore.getState().tabs[wt.id] ?? [];
    const wtActiveTabId = useWorkspaceStore.getState().activeTabId[wt.id] ?? "";
    useLayoutStore.getState().initLayout(wt.id, wtTabs.map((t) => t.id), wtActiveTabId);
  }
}
```

- [ ] **Step 3: Remove the old TabBar function**

Delete the entire `TabBar` function (lines 40-291). It's fully replaced by `PaneTabBar` rendered inside `PaneView` via `LayoutRenderer`.

- [ ] **Step 4: Replace TabBar and main content with LayoutRenderer**

In the render output of `AppShell` (around lines 659-685), replace:

```tsx
<TabBar />
<StatusBar worktree={worktree} annotationCount={annotationCount} />
<main className="flex-1 min-h-0 relative">
  {(activeTab?.type === "claude" || activeTab?.type === "shell" || activeTab?.type === "server") && (
    <TerminalView key={activeTab.id} tabId={activeTab.id} tabType={activeTab.type} />
  )}
  {activeTab?.type === "pr" && activeWorktreeId && worktree && (
    <PrDetailPanel worktree={worktree} repoPath={worktree.path} />
  )}
  {activeTab?.type === "changes" && activeWorktreeId && (
    <ChangesView worktreeId={activeWorktreeId} repoPath={worktree?.path ?? "."} />
  )}
  {!activeWorktreeId && (
    <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-2">
      <span className="text-sm">Select a worktree to get started</span>
      <span className="text-xs">Each worktree gets its own branch, terminal, and agent</span>
    </div>
  )}
</main>
```

With:

```tsx
<StatusBar worktree={worktree} annotationCount={annotationCount} />
<main className="flex-1 min-h-0 relative">
  {activeWorktreeId ? (
    <LayoutRenderer
      worktreeId={activeWorktreeId}
      onToggleServer={handleToggleServer}
      isServerRunning={isServerRunningHere}
      runScriptName={runScript?.name}
    />
  ) : (
    <div className="flex flex-col items-center justify-center h-full text-text-tertiary gap-2">
      <span className="text-sm">Select a worktree to get started</span>
      <span className="text-xs">Each worktree gets its own branch, terminal, and agent</span>
    </div>
  )}
</main>
```

- [ ] **Step 5: Move server toggle logic from TabBar into AppShell**

The `handleToggleServer` callback, `runScript` state, and `isServerRunningHere` logic currently live inside the deleted `TabBar` function. Move them into the `AppShell` component body. They already reference AppShell-level state (`activeWorktreeId`, `repoPath`), so this is a straightforward move.

Move these pieces from the old TabBar into AppShell (before the return statement):
- `runScript` state + its loading effects (lines 60-75)
- `isServerRunningHere` computed value (line 77)
- `handleToggleServer` callback (lines 79-149)

- [ ] **Step 6: Update keyboard shortcuts to be pane-aware**

In the `handleKeyDown` function (around line 445), update shortcuts to use the layout store:

For `Cmd+T` (new tab): add the new tab to the active pane.

```typescript
// Cmd+T: new tab of same type as current
if (event.metaKey && !event.shiftKey && event.key === "t") {
  event.preventDefault();
  if (activeWorktreeId) {
    const layoutState = useLayoutStore.getState();
    const activePaneId = layoutState.activePaneId[activeWorktreeId];
    const pane = activePaneId ? layoutState.panes[activeWorktreeId]?.[activePaneId] : null;
    const paneActiveTab = pane ? tabs.find((t) => t.id === pane.activeTabId) : activeTab;
    const type = (!paneActiveTab || paneActiveTab.type === "changes") ? "claude" : paneActiveTab.type;

    const prevTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
    addTab(activeWorktreeId, type);
    const newTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
    const newTab = newTabs.find((t) => !prevTabs.some((p) => p.id === t.id));
    if (newTab && activePaneId) {
      layoutState.addTabToPane(activeWorktreeId, activePaneId, newTab.id);
    }
  }
  return;
}
```

For `Cmd+Shift+C` and `Cmd+Shift+T`: set the pane's active tab instead of the workspace-level active tab.

```typescript
// Cmd+Shift+C: switch to Changes tab in active pane
if (event.metaKey && event.shiftKey && event.key === "C") {
  event.preventDefault();
  if (activeWorktreeId) {
    const layoutState = useLayoutStore.getState();
    const activePaneId = layoutState.activePaneId[activeWorktreeId];
    if (activePaneId) {
      const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
      const changesTabId = pane?.tabIds.find((id) => tabs.find((t) => t.id === id && t.type === "changes"));
      if (changesTabId) {
        layoutState.setPaneActiveTab(activeWorktreeId, activePaneId, changesTabId);
      }
    }
  }
  return;
}

// Cmd+Shift+T: switch to first terminal/claude tab in active pane
if (event.metaKey && event.shiftKey && event.key === "T") {
  event.preventDefault();
  if (activeWorktreeId) {
    const layoutState = useLayoutStore.getState();
    const activePaneId = layoutState.activePaneId[activeWorktreeId];
    if (activePaneId) {
      const pane = layoutState.panes[activeWorktreeId]?.[activePaneId];
      const termTabId = pane?.tabIds.find((id) => tabs.find((t) => t.id === id && t.type !== "changes"));
      if (termTabId) {
        layoutState.setPaneActiveTab(activeWorktreeId, activePaneId, termTabId);
      }
    }
  }
  return;
}
```

- [ ] **Step 7: Clean up unused imports**

Remove imports that were only used by the deleted `TabBar`: `motion`, `Plus`, `X`, `Terminal`, `Sparkles`, `GitCompareArrows`, `GitPullRequest`, `Play`, `Square`, `DropdownMenu*`, `TerminalView`, `ChangesView`, `PrDetailPanel`. Keep them if still used elsewhere in AppShell.

Also remove `TAB_ICONS` and `EMPTY_TABS` constants if no longer referenced.

- [ ] **Step 8: Verify it compiles and renders**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

Run: `npm run dev`
Expected: App loads, tabs render in single-pane mode. Tab clicking switches tabs. No visual regressions.

- [ ] **Step 9: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat(ui): integrate LayoutRenderer into AppShell, replace inline TabBar"
```

---

### Task 8: Update Session Persistence

**Files:**
- Modify: `src/services/SessionPersistence.ts`

Add layout and pane state to the persisted session data. Handle migration for sessions saved before split view existed.

- [ ] **Step 1: Update SessionData interface and saveAllSessions**

In `src/services/SessionPersistence.ts`, update the interface and save function:

```typescript
import { saveSessionFile, loadSessionFile, deleteSessionFile } from "../api";
import type { WorkspaceTab, LayoutNode, Pane } from "../types";

export interface SessionData {
  tabs: WorkspaceTab[];
  activeTabId: string;
  terminals: Record<string, { scrollback: string }>;
  savedAt: string;
  /** Layout tree (added in split-view feature). */
  layout?: LayoutNode;
  /** Pane state (added in split-view feature). */
  panes?: Record<string, Pane>;
  /** Active pane ID (added in split-view feature). */
  activePaneId?: string;
}
```

Update `saveAllSessions` to accept layout getters:

```typescript
export async function saveAllSessions(
  repoPath: string,
  worktreeIds: string[],
  getTabs: (worktreeId: string) => WorkspaceTab[],
  getActiveTabId: (worktreeId: string) => string,
  getScrollback: (tabId: string) => string,
  getLayout?: (worktreeId: string) => LayoutNode | undefined,
  getPanes?: (worktreeId: string) => Record<string, Pane> | undefined,
  getActivePaneId?: (worktreeId: string) => string | undefined,
): Promise<void> {
  const saves = worktreeIds.map((wtId) => {
    // Exclude server tabs — they shouldn't persist across restarts
    const tabs = getTabs(wtId).filter((t) => t.type !== "server");
    const terminals: Record<string, { scrollback: string }> = {};
    for (const tab of tabs) {
      if (tab.type === "claude" || tab.type === "shell") {
        const scrollback = getScrollback(tab.id);
        if (scrollback) {
          terminals[tab.id] = { scrollback };
        }
      }
    }

    // Filter server tabs from pane state too
    const rawPanes = getPanes?.(wtId);
    const panes = rawPanes
      ? Object.fromEntries(
          Object.entries(rawPanes).map(([paneId, pane]) => [
            paneId,
            {
              ...pane,
              tabIds: pane.tabIds.filter((id) => tabs.some((t) => t.id === id)),
            },
          ]),
        )
      : undefined;

    const data: SessionData = {
      tabs,
      activeTabId: getActiveTabId(wtId),
      terminals,
      savedAt: new Date().toISOString(),
      layout: getLayout?.(wtId),
      panes,
      activePaneId: getActivePaneId?.(wtId),
    };
    return saveSession(repoPath, wtId, data);
  });
  await Promise.allSettled(saves);
}
```

- [ ] **Step 2: Update all saveAllSessions call sites in AppShell.tsx**

There are three call sites in AppShell.tsx that call `saveAllSessions`. Update each to pass layout getters. Find-and-replace each call to add the new arguments:

```typescript
// Add these after the existing getScrollback argument:
(wtId) => useLayoutStore.getState().layout[wtId],
(wtId) => useLayoutStore.getState().panes[wtId],
(wtId) => useLayoutStore.getState().activePaneId[wtId],
```

The three call sites are:
1. `handleSwitchRepo` (around line 345)
2. `onCloseRequested` handler (around line 527)
3. Auto-save interval (around line 551)

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add src/services/SessionPersistence.ts src/components/layout/AppShell.tsx
git commit -m "feat(persistence): save and restore layout + pane state"
```

---

### Task 9: Wire Up Layout for New Tabs from ensureDefaultTabs and addTab

**Files:**
- Modify: `src/stores/workspaceStore.ts`

When `ensureDefaultTabs` creates tabs or `addTab` creates a new tab, the layout store also needs to know about them. Rather than coupling the stores, we'll handle this at the call site in AppShell. But `ensureDefaultTabs` is called in a useEffect — we need to ensure layout is initialized after it runs.

- [ ] **Step 1: Update the ensureDefaultTabs effect in AppShell**

In the `AppShell` component, after the worktree loading effect initializes layouts, we need to handle the case where `ensureDefaultTabs` creates new tabs that aren't yet in any pane. Add an effect after the existing one:

Add this effect to AppShell (after the worktree loading effect):

```typescript
// Sync layout store when ensureDefaultTabs adds tabs not yet in a pane
useEffect(() => {
  if (!activeWorktreeId) return;
  const layoutState = useLayoutStore.getState();
  const wtLayout = layoutState.layout[activeWorktreeId];
  if (!wtLayout) {
    // Layout not initialized yet — init it from current tabs
    const wtTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
    const wtActiveTabId = useWorkspaceStore.getState().activeTabId[activeWorktreeId] ?? "";
    if (wtTabs.length > 0) {
      layoutState.initLayout(activeWorktreeId, wtTabs.map((t) => t.id), wtActiveTabId);
    }
    return;
  }
  // Check for tabs not in any pane and add them to the active pane
  const wtTabs = useWorkspaceStore.getState().tabs[activeWorktreeId] ?? [];
  const allPaneTabIds = new Set(
    Object.values(layoutState.panes[activeWorktreeId] ?? {}).flatMap((p) => p.tabIds),
  );
  const activePaneId = layoutState.activePaneId[activeWorktreeId];
  for (const tab of wtTabs) {
    if (!allPaneTabIds.has(tab.id) && activePaneId) {
      layoutState.addTabToPane(activeWorktreeId, activePaneId, tab.id);
    }
  }
}, [activeWorktreeId, tabs]);
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "feat(layout): sync layout store when new tabs are created"
```

---

### Task 10: Handle Worktree Removal Cleanup

**Files:**
- Modify: `src/components/layout/AppShell.tsx`

When a worktree is removed, clean up its layout state too.

- [ ] **Step 1: Add layout cleanup to removeWorktree**

In AppShell, find where `removeWorktree` is called (or where worktrees are cleaned up). The `removeWorktree` action in `workspaceStore` already cleans up tabs/activeTabId. We need to also call `useLayoutStore.getState().removeLayout(id)`.

The simplest approach: add a subscriber or call `removeLayout` alongside `removeWorktree`. Since `removeWorktree` is an action on `workspaceStore`, add a call to the layout store cleanup in the same place `removeWorktree` is dispatched.

Search for where `removeWorktree` is called in the codebase and add `useLayoutStore.getState().removeLayout(id)` right after each call.

If `removeWorktree` is only called from the Sidebar, the cleanup should happen there. Otherwise, add it as an effect that watches `worktrees` length.

Add a simpler approach — an effect in AppShell:

```typescript
// Clean up layout state for removed worktrees
const worktreeIds = worktrees.map((wt) => wt.id);
useEffect(() => {
  const layoutState = useLayoutStore.getState();
  for (const wtId of Object.keys(layoutState.layout)) {
    if (!worktreeIds.includes(wtId)) {
      layoutState.removeLayout(wtId);
    }
  }
}, [worktreeIds.join(",")]);
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/AppShell.tsx
git commit -m "fix(layout): clean up layout state when worktrees are removed"
```

---

### Task 11: End-to-End Smoke Test

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: App compiles and launches without errors.

- [ ] **Step 2: Test single-pane behavior**

1. Select a worktree
2. Verify tabs render in the tab bar
3. Click tabs to switch between them
4. Close a tab (hover → X)
5. Add a new tab via the + dropdown
6. Verify Cmd+T, Cmd+Shift+C, Cmd+Shift+T all work

Expected: All existing tab behavior works as before.

- [ ] **Step 3: Test tab drag reorder**

1. Click and drag a tab to a new position
2. Verify the drop indicator appears
3. Release — tab should be in its new position
4. Verify the tab order persists across worktree switches

Expected: Smooth drag with visual feedback, correct reorder.

- [ ] **Step 4: Test split view**

1. Right-click a tab → "Split Right"
2. Verify the pane splits horizontally with a resize handle
3. Each pane should have its own tab bar
4. Click tabs in each pane independently
5. Drag the resize handle — both panes resize
6. xterm terminals should refit to their new size

Expected: Split works, each pane is independent, resize is smooth.

- [ ] **Step 5: Test split view closure**

1. In a split view, close all tabs in one pane
2. Verify the pane auto-collapses back to single view
3. Remaining pane should fill the full width

Expected: Clean collapse with no layout artifacts.

- [ ] **Step 6: Test split view disabled state**

1. With only 1 tab in a pane, right-click it
2. "Split Right" and "Split Down" should be disabled/grayed
3. In a split view (depth 1), right-click a tab — split options should be disabled

Expected: Context menu correctly reflects when splits are allowed.

- [ ] **Step 7: Test session persistence**

1. Create a split view
2. Quit and relaunch the app
3. Verify the split layout is restored

Expected: Layout, pane assignments, and tab order all persist.

- [ ] **Step 8: Commit any fixes**

If any issues found during testing, fix them and commit:

```bash
git add -A
git commit -m "fix: address issues found in split view smoke testing"
```
