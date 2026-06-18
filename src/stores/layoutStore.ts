import { create } from "zustand";
import type { LayoutNode, Pane } from "../types";
import { isAgentTab } from "../types";
import { useTabStore } from "./tabStore";

const MAX_SPLIT_DEPTH = 1;

interface LayoutState {
  /** Layout tree per worktree. */
  layout: Record<string, LayoutNode>;
  /** Pane state per worktree, keyed by paneId. */
  panes: Record<string, Record<string, Pane>>;
  /** Currently focused pane per worktree. */
  activePaneId: Record<string, string>;
  /** Most recently focused agent tab per worktree (used to route inline review comments). */
  lastFocusedAgentTabId: Record<string, string>;
  /** Most recently focused non-agent tab per worktree (used to restore context when toggling back from an agent). */
  lastFocusedNonAgentTabId: Record<string, string>;

  // ── Initialization ──
  initLayout: (worktreeId: string, tabIds: string[], activeTabId: string) => void;
  restoreLayout: (
    worktreeId: string,
    layout: LayoutNode,
    panes: Record<string, Pane>,
    activePaneId: string,
  ) => void;
  removeLayout: (worktreeId: string) => void;

  // ── Split actions ──
  splitPane: (
    worktreeId: string,
    paneId: string,
    tabId: string,
    direction: "horizontal" | "vertical",
  ) => boolean;
  closePane: (worktreeId: string, paneId: string) => void;
  updateSplitRatio: (worktreeId: string, ratio: number) => void;

  // ── Pane actions ──
  setActivePaneId: (worktreeId: string, paneId: string) => void;
  setPaneActiveTab: (worktreeId: string, paneId: string, tabId: string) => void;
  setLastFocusedAgentTab: (worktreeId: string, tabId: string) => void;
  setLastFocusedNonAgentTab: (worktreeId: string, tabId: string) => void;
  addTabToPane: (worktreeId: string, paneId: string, tabId: string) => void;
  /** Insert a tab at the front of a pane WITHOUT changing the active tab.
   * Used to adopt the permanent notes tab without stealing focus. */
  addPinnedTabToPane: (worktreeId: string, paneId: string, tabId: string) => void;
  removeTabFromPane: (worktreeId: string, tabId: string) => void;
  moveTabToSiblingPane: (worktreeId: string, paneId: string, tabId: string) => void;
  reorderTabs: (worktreeId: string, paneId: string, fromIndex: number, toIndex: number) => void;
  setPaneTabIds: (worktreeId: string, paneId: string, tabIds: string[]) => void;
  openPreviewTab: (worktreeId: string, paneId: string, tabId: string) => void;
  pinPreviewTab: (worktreeId: string, paneId: string) => void;

  // ── Queries ──
  findPaneForTab: (worktreeId: string, tabId: string) => string | null;
  getPane: (worktreeId: string, paneId: string) => Pane | undefined;
}

function generatePaneId(): string {
  return `pane-${crypto.randomUUID().slice(0, 8)}`;
}

function findSiblingPaneId(node: LayoutNode, paneId: string): string | null {
  if (node.type === "leaf") return null;
  const [left, right] = node.children;
  if (left.type === "leaf" && left.paneId === paneId && right.type === "leaf") return right.paneId;
  if (right.type === "leaf" && right.paneId === paneId && left.type === "leaf") return left.paneId;
  return findSiblingPaneId(left, paneId) ?? findSiblingPaneId(right, paneId);
}

function treeDepth(node: LayoutNode): number {
  if (node.type === "leaf") return 0;
  return 1 + Math.max(treeDepth(node.children[0]), treeDepth(node.children[1]));
}

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

function removeLeaf(node: LayoutNode, targetPaneId: string): LayoutNode | null {
  if (node.type === "leaf") return null;
  if (node.children[0].type === "leaf" && node.children[0].paneId === targetPaneId) {
    return node.children[1];
  }
  if (node.children[1].type === "leaf" && node.children[1].paneId === targetPaneId) {
    return node.children[0];
  }
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
  lastFocusedAgentTabId: {},
  lastFocusedNonAgentTabId: {},

  initLayout: (worktreeId, tabIds, activeTabId) => {
    const paneId = generatePaneId();
    set((s) => ({
      layout: { ...s.layout, [worktreeId]: { type: "leaf", paneId } },
      panes: {
        ...s.panes,
        [worktreeId]: { [paneId]: { tabIds, activeTabId, previewTabId: null } },
      },
      activePaneId: { ...s.activePaneId, [worktreeId]: paneId },
    }));
  },

  restoreLayout: (worktreeId, layout, panes, activePaneId) => {
    // Validate each pane's activeTabId exists in its tabIds
    const validatedPanes = Object.fromEntries(
      Object.entries(panes).map(([paneId, pane]) => [
        paneId,
        {
          ...(pane.tabIds.includes(pane.activeTabId)
            ? pane
            : { ...pane, activeTabId: pane.tabIds[0] ?? pane.activeTabId }),
          previewTabId: pane.previewTabId ?? null,
        },
      ]),
    );
    set((s) => ({
      layout: { ...s.layout, [worktreeId]: layout },
      panes: { ...s.panes, [worktreeId]: validatedPanes },
      activePaneId: { ...s.activePaneId, [worktreeId]: activePaneId },
    }));
  },

  removeLayout: (worktreeId) => {
    set((s) => {
      const { [worktreeId]: _l, ...restLayout } = s.layout;
      const { [worktreeId]: _p, ...restPanes } = s.panes;
      const { [worktreeId]: _a, ...restActive } = s.activePaneId;
      const { [worktreeId]: _f, ...restLastAgent } = s.lastFocusedAgentTabId;
      const { [worktreeId]: _fn, ...restLastNonAgent } = s.lastFocusedNonAgentTabId;
      return {
        layout: restLayout,
        panes: restPanes,
        activePaneId: restActive,
        lastFocusedAgentTabId: restLastAgent,
        lastFocusedNonAgentTabId: restLastNonAgent,
      };
    });
  },

  splitPane: (worktreeId, paneId, tabId, direction) => {
    const state = get();
    const tree = state.layout[worktreeId];
    const worktreePanes = state.panes[worktreeId];
    if (!tree || !worktreePanes) return false;

    const sourcePane = worktreePanes[paneId];
    if (!sourcePane) return false;

    if (sourcePane.tabIds.length <= 1) return false;
    if (treeDepth(tree) >= MAX_SPLIT_DEPTH) return false;

    const newPaneId = generatePaneId();
    const newSourceTabIds = sourcePane.tabIds.filter((id) => id !== tabId);
    const newSourceActiveTab =
      sourcePane.activeTabId === tabId
        ? newSourceTabIds[0]
        : sourcePane.activeTabId;

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
          [paneId]: { tabIds: newSourceTabIds, activeTabId: newSourceActiveTab, previewTabId: null },
          [newPaneId]: { tabIds: [tabId], activeTabId: tabId, previewTabId: null },
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

    if (tree.type === "leaf") return;

    const newTree = removeLeaf(tree, paneId);
    if (!newTree) return;

    const { [paneId]: _removed, ...remainingPanes } = worktreePanes;

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
    set((s) => {
      // If the newly-active pane's active tab is an agent tab, treat the
      // pane-switch as "focusing" that agent so "Send to agent" routing
      // follows the user's current attention — not just their last
      // tab-chip click.
      const activeTabId = s.panes[worktreeId]?.[paneId]?.activeTabId;
      const tab = activeTabId
        ? useTabStore.getState().tabs[worktreeId]?.find((t) => t.id === activeTabId)
        : undefined;
      const nextLastFocused =
        tab && isAgentTab(tab)
          ? { ...s.lastFocusedAgentTabId, [worktreeId]: activeTabId! }
          : s.lastFocusedAgentTabId;
      const nextLastNonAgent =
        tab && !isAgentTab(tab)
          ? { ...s.lastFocusedNonAgentTabId, [worktreeId]: activeTabId! }
          : s.lastFocusedNonAgentTabId;
      return {
        activePaneId: { ...s.activePaneId, [worktreeId]: paneId },
        lastFocusedAgentTabId: nextLastFocused,
        lastFocusedNonAgentTabId: nextLastNonAgent,
      };
    });
  },

  setLastFocusedAgentTab: (worktreeId, tabId) => {
    set((s) => ({
      lastFocusedAgentTabId: { ...s.lastFocusedAgentTabId, [worktreeId]: tabId },
    }));
  },

  setLastFocusedNonAgentTab: (worktreeId, tabId) => {
    set((s) => ({
      lastFocusedNonAgentTabId: { ...s.lastFocusedNonAgentTabId, [worktreeId]: tabId },
    }));
  },

  setPaneActiveTab: (worktreeId, paneId, tabId) => {
    set((s) => {
      const worktreePanes = s.panes[worktreeId];
      if (!worktreePanes?.[paneId]) return s;
      const tab = useTabStore.getState().tabs[worktreeId]?.find((t) => t.id === tabId);
      const nextLastFocused =
        tab && isAgentTab(tab)
          ? { ...s.lastFocusedAgentTabId, [worktreeId]: tabId }
          : s.lastFocusedAgentTabId;
      const nextLastNonAgent =
        tab && !isAgentTab(tab)
          ? { ...s.lastFocusedNonAgentTabId, [worktreeId]: tabId }
          : s.lastFocusedNonAgentTabId;
      return {
        panes: {
          ...s.panes,
          [worktreeId]: {
            ...worktreePanes,
            [paneId]: { ...worktreePanes[paneId], activeTabId: tabId },
          },
        },
        lastFocusedAgentTabId: nextLastFocused,
        lastFocusedNonAgentTabId: nextLastNonAgent,
      };
    });
  },

  addTabToPane: (worktreeId, paneId, tabId) => {
    set((s) => {
      const worktreePanes = s.panes[worktreeId];
      if (!worktreePanes) return s;
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
              previewTabId: pane.previewTabId ?? null,
            },
          },
        },
      };
    });
  },

  addPinnedTabToPane: (worktreeId, paneId, tabId) => {
    set((s) => {
      const worktreePanes = s.panes[worktreeId];
      if (!worktreePanes) return s;
      const targetPaneId = worktreePanes[paneId] ? paneId : s.activePaneId[worktreeId];
      const pane = worktreePanes[targetPaneId];
      if (!pane || pane.tabIds.includes(tabId)) return s;
      return {
        panes: {
          ...s.panes,
          [worktreeId]: {
            ...worktreePanes,
            [targetPaneId]: {
              ...pane,
              tabIds: [tabId, ...pane.tabIds],
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

    const paneEntry = Object.entries(worktreePanes).find(([, pane]) =>
      pane.tabIds.includes(tabId),
    );
    if (!paneEntry) return;

    const [paneId, pane] = paneEntry;
    const newTabIds = pane.tabIds.filter((id) => id !== tabId);

    if (newTabIds.length === 0) {
      get().closePane(worktreeId, paneId);
      return;
    }

    const newActiveTabId =
      pane.activeTabId === tabId ? newTabIds[0] : pane.activeTabId;
    const newPreviewTabId =
      pane.previewTabId === tabId ? null : pane.previewTabId ?? null;

    set((s) => ({
      panes: {
        ...s.panes,
        [worktreeId]: {
          ...worktreePanes,
          [paneId]: { tabIds: newTabIds, activeTabId: newActiveTabId, previewTabId: newPreviewTabId },
        },
      },
    }));
  },

  moveTabToSiblingPane: (worktreeId, paneId, tabId) => {
    const state = get();
    const tree = state.layout[worktreeId];
    const worktreePanes = state.panes[worktreeId];
    if (!tree || !worktreePanes) return;

    const siblingPaneId = findSiblingPaneId(tree, paneId);
    if (!siblingPaneId) return;

    const sourcePane = worktreePanes[paneId];
    const targetPane = worktreePanes[siblingPaneId];
    if (!sourcePane || !targetPane) return;

    // Add tab to sibling pane
    const newTargetTabIds = [...targetPane.tabIds, tabId];

    // Remove tab from source pane
    const newSourceTabIds = sourcePane.tabIds.filter((id) => id !== tabId);

    // If the moved tab was the source pane's preview, clear it (auto-pin on drag)
    const newSourcePreviewTabId =
      sourcePane.previewTabId === tabId ? null : sourcePane.previewTabId ?? null;

    if (newSourceTabIds.length === 0) {
      // Source pane is now empty — collapse the split
      set((s) => ({
        panes: {
          ...s.panes,
          [worktreeId]: {
            ...worktreePanes,
            [siblingPaneId]: { tabIds: newTargetTabIds, activeTabId: tabId, previewTabId: targetPane.previewTabId ?? null },
          },
        },
      }));
      get().closePane(worktreeId, paneId);
    } else {
      const newSourceActiveTab =
        sourcePane.activeTabId === tabId ? newSourceTabIds[0] : sourcePane.activeTabId;
      set((s) => ({
        panes: {
          ...s.panes,
          [worktreeId]: {
            ...worktreePanes,
            [paneId]: { tabIds: newSourceTabIds, activeTabId: newSourceActiveTab, previewTabId: newSourcePreviewTabId },
            [siblingPaneId]: { tabIds: newTargetTabIds, activeTabId: tabId, previewTabId: targetPane.previewTabId ?? null },
          },
        },
        activePaneId: { ...s.activePaneId, [worktreeId]: siblingPaneId },
      }));
    }
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

  setPaneTabIds: (worktreeId, paneId, tabIds) => {
    set((s) => {
      const worktreePanes = s.panes[worktreeId];
      const pane = worktreePanes?.[paneId];
      if (!pane) return s;
      // Refuse to drop or duplicate tabs — must be a permutation of the current set.
      const before = new Set(pane.tabIds);
      if (
        tabIds.length !== pane.tabIds.length ||
        !tabIds.every((id) => before.has(id))
      ) {
        console.warn(
          "setPaneTabIds: ids must be a permutation of the current pane.tabIds",
        );
        return s;
      }
      return {
        panes: {
          ...s.panes,
          [worktreeId]: {
            ...worktreePanes,
            [paneId]: { ...pane, tabIds: [...tabIds] },
          },
        },
      };
    });
  },

  openPreviewTab: (worktreeId, paneId, tabId) => {
    const state = get();
    const worktreePanes = state.panes[worktreeId];
    if (!worktreePanes) return;
    const pane = worktreePanes[paneId];
    if (!pane) return;

    let newTabIds = [...pane.tabIds];

    // Remove the old preview tab if it exists and is different from the new one
    if (pane.previewTabId && pane.previewTabId !== tabId) {
      newTabIds = newTabIds.filter((id) => id !== pane.previewTabId);
      // Also remove from tab store
      useTabStore.getState().removeTab(worktreeId, pane.previewTabId);
    }

    // Add the new tab if not already in pane
    if (!newTabIds.includes(tabId)) {
      newTabIds.push(tabId);
    }

    set((s) => ({
      panes: {
        ...s.panes,
        [worktreeId]: {
          ...worktreePanes,
          [paneId]: { tabIds: newTabIds, activeTabId: tabId, previewTabId: tabId },
        },
      },
    }));
  },

  pinPreviewTab: (worktreeId, paneId) => {
    set((s) => {
      const worktreePanes = s.panes[worktreeId];
      const pane = worktreePanes?.[paneId];
      if (!pane || !pane.previewTabId) return s;
      return {
        panes: {
          ...s.panes,
          [worktreeId]: {
            ...worktreePanes,
            [paneId]: { ...pane, previewTabId: null },
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
