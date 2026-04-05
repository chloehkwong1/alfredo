import { describe, it, expect, beforeEach, vi } from "vitest";
import type { LayoutNode, Pane } from "../types";

vi.mock("./tabStore", () => ({
  useTabStore: {
    getState: () => ({
      removeTab: vi.fn(),
    }),
  },
}));

import { useLayoutStore } from "./layoutStore";

const W = "worktree-1";

function getState() {
  return useLayoutStore.getState();
}

function initWith(tabIds: string[], activeTabId?: string) {
  getState().initLayout(W, tabIds, activeTabId ?? tabIds[0]);
}

/** Returns the single paneId after initLayout. */
function getSinglePaneId(): string {
  const layout = getState().layout[W];
  expect(layout.type).toBe("leaf");
  return (layout as { type: "leaf"; paneId: string }).paneId;
}

describe("layoutStore", () => {
  beforeEach(() => {
    useLayoutStore.setState({ layout: {}, panes: {}, activePaneId: {} });
  });

  // ── initLayout ──────────────────────────────────────────────

  describe("initLayout", () => {
    it("creates a single leaf layout with the given tabs", () => {
      initWith(["tab-1", "tab-2"], "tab-1");

      const state = getState();
      const layout = state.layout[W];
      expect(layout.type).toBe("leaf");

      const paneId = (layout as { type: "leaf"; paneId: string }).paneId;
      const pane = state.panes[W][paneId];
      expect(pane.tabIds).toEqual(["tab-1", "tab-2"]);
      expect(pane.activeTabId).toBe("tab-1");
      expect(pane.previewTabId).toBeNull();
      expect(state.activePaneId[W]).toBe(paneId);
    });
  });

  // ── splitPane ───────────────────────────────────────────────

  describe("splitPane", () => {
    it("splits a pane, moving the tab to the new pane", () => {
      initWith(["tab-1", "tab-2"], "tab-1");
      const paneId = getSinglePaneId();

      const result = getState().splitPane(W, paneId, "tab-2", "horizontal");
      expect(result).toBe(true);

      const state = getState();
      const layout = state.layout[W] as {
        type: "split";
        direction: string;
        children: [LayoutNode, LayoutNode];
      };
      expect(layout.type).toBe("split");
      expect(layout.direction).toBe("horizontal");

      // Original pane keeps tab-1
      const leftPaneId = (layout.children[0] as { type: "leaf"; paneId: string }).paneId;
      expect(state.panes[W][leftPaneId].tabIds).toEqual(["tab-1"]);

      // New pane gets tab-2
      const rightPaneId = (layout.children[1] as { type: "leaf"; paneId: string }).paneId;
      expect(state.panes[W][rightPaneId].tabIds).toEqual(["tab-2"]);
      expect(state.panes[W][rightPaneId].activeTabId).toBe("tab-2");

      // Active pane switches to the new pane
      expect(state.activePaneId[W]).toBe(rightPaneId);
    });

    it("returns false when pane has only 1 tab", () => {
      initWith(["tab-1"]);
      const paneId = getSinglePaneId();

      const result = getState().splitPane(W, paneId, "tab-1", "horizontal");
      expect(result).toBe(false);
    });

    it("returns false when tree depth >= MAX_SPLIT_DEPTH", () => {
      initWith(["tab-1", "tab-2", "tab-3"], "tab-1");
      const paneId = getSinglePaneId();

      // First split succeeds (depth goes from 0 to 1)
      getState().splitPane(W, paneId, "tab-2", "horizontal");

      // Now try splitting again — depth is already 1 (MAX_SPLIT_DEPTH)
      const layout = getState().layout[W] as {
        type: "split";
        children: [LayoutNode, LayoutNode];
      };
      const leftPaneId = (layout.children[0] as { type: "leaf"; paneId: string }).paneId;
      // Add another tab so the pane has > 1 tab
      getState().addTabToPane(W, leftPaneId, "tab-3");

      const result = getState().splitPane(W, leftPaneId, "tab-3", "vertical");
      expect(result).toBe(false);
    });

    it("returns false when pane does not exist", () => {
      initWith(["tab-1", "tab-2"]);
      const result = getState().splitPane(W, "nonexistent-pane", "tab-1", "horizontal");
      expect(result).toBe(false);
    });

    it("updates activeTabId in source pane when the split tab was active", () => {
      initWith(["tab-1", "tab-2"], "tab-2");
      const paneId = getSinglePaneId();

      getState().splitPane(W, paneId, "tab-2", "horizontal");

      const state = getState();
      const layout = state.layout[W] as {
        type: "split";
        children: [LayoutNode, LayoutNode];
      };
      const leftPaneId = (layout.children[0] as { type: "leaf"; paneId: string }).paneId;
      // Source pane should fall back to first remaining tab
      expect(state.panes[W][leftPaneId].activeTabId).toBe("tab-1");
    });
  });

  // ── closePane ───────────────────────────────────────────────

  describe("closePane", () => {
    it("no-ops on a single leaf layout", () => {
      initWith(["tab-1"]);
      const paneId = getSinglePaneId();

      getState().closePane(W, paneId);

      // Layout should remain unchanged
      const state = getState();
      expect(state.layout[W].type).toBe("leaf");
      expect(state.panes[W][paneId]).toBeDefined();
    });

    it("promotes sibling when closing a pane in a split", () => {
      initWith(["tab-1", "tab-2"], "tab-1");
      const paneId = getSinglePaneId();

      getState().splitPane(W, paneId, "tab-2", "horizontal");
      const splitLayout = getState().layout[W] as {
        type: "split";
        children: [LayoutNode, LayoutNode];
      };
      const rightPaneId = (splitLayout.children[1] as { type: "leaf"; paneId: string }).paneId;

      // Close the right pane
      getState().closePane(W, rightPaneId);

      const state = getState();
      // Layout should collapse back to a leaf
      expect(state.layout[W].type).toBe("leaf");
      expect((state.layout[W] as { type: "leaf"; paneId: string }).paneId).toBe(paneId);
      // Right pane should be removed
      expect(state.panes[W][rightPaneId]).toBeUndefined();
    });
  });

  // ── removeTabFromPane ───────────────────────────────────────

  describe("removeTabFromPane", () => {
    it("removes a tab from the pane", () => {
      initWith(["tab-1", "tab-2"], "tab-1");
      const paneId = getSinglePaneId();

      getState().removeTabFromPane(W, "tab-2");

      const pane = getState().panes[W][paneId];
      expect(pane.tabIds).toEqual(["tab-1"]);
    });

    it("updates activeTabId when the active tab is removed", () => {
      initWith(["tab-1", "tab-2"], "tab-1");
      const paneId = getSinglePaneId();

      getState().removeTabFromPane(W, "tab-1");

      const pane = getState().panes[W][paneId];
      expect(pane.activeTabId).toBe("tab-2");
    });

    it("auto-closes pane when last tab is removed from a split", () => {
      initWith(["tab-1", "tab-2"], "tab-1");
      const paneId = getSinglePaneId();

      getState().splitPane(W, paneId, "tab-2", "horizontal");
      const splitLayout = getState().layout[W] as {
        type: "split";
        children: [LayoutNode, LayoutNode];
      };
      const rightPaneId = (splitLayout.children[1] as { type: "leaf"; paneId: string }).paneId;

      // Remove the only tab in the right pane
      getState().removeTabFromPane(W, "tab-2");

      // Layout should collapse back to a leaf
      const state = getState();
      expect(state.layout[W].type).toBe("leaf");
      expect(state.panes[W][rightPaneId]).toBeUndefined();
    });

    it("clears previewTabId when the preview tab is removed", () => {
      initWith(["tab-1"], "tab-1");
      const paneId = getSinglePaneId();

      getState().openPreviewTab(W, paneId, "tab-preview");

      // Add another tab so removing preview doesn't auto-close
      getState().addTabToPane(W, paneId, "tab-2");

      getState().removeTabFromPane(W, "tab-preview");

      const pane = getState().panes[W][paneId];
      expect(pane.previewTabId).toBeNull();
      expect(pane.tabIds).not.toContain("tab-preview");
    });
  });

  // ── reorderTabs ─────────────────────────────────────────────

  describe("reorderTabs", () => {
    it("reorders tabs via splice", () => {
      initWith(["tab-1", "tab-2", "tab-3"], "tab-1");
      const paneId = getSinglePaneId();

      getState().reorderTabs(W, paneId, 0, 2);

      const pane = getState().panes[W][paneId];
      expect(pane.tabIds).toEqual(["tab-2", "tab-3", "tab-1"]);
    });

    it("no-ops for nonexistent pane", () => {
      initWith(["tab-1"]);
      // Should not throw
      getState().reorderTabs(W, "nonexistent", 0, 1);
    });
  });

  // ── moveTabToSiblingPane ────────────────────────────────────

  describe("moveTabToSiblingPane", () => {
    it("moves a tab from one pane to the sibling pane", () => {
      initWith(["tab-1", "tab-2", "tab-3"], "tab-1");
      const paneId = getSinglePaneId();

      getState().splitPane(W, paneId, "tab-3", "horizontal");
      const splitLayout = getState().layout[W] as {
        type: "split";
        children: [LayoutNode, LayoutNode];
      };
      const leftPaneId = (splitLayout.children[0] as { type: "leaf"; paneId: string }).paneId;
      const rightPaneId = (splitLayout.children[1] as { type: "leaf"; paneId: string }).paneId;

      // Move tab-1 from left to right (sibling)
      getState().moveTabToSiblingPane(W, leftPaneId, "tab-1");

      const state = getState();
      expect(state.panes[W][leftPaneId].tabIds).toEqual(["tab-2"]);
      expect(state.panes[W][rightPaneId].tabIds).toEqual(["tab-3", "tab-1"]);
      expect(state.activePaneId[W]).toBe(rightPaneId);
    });

    it("collapses split when source pane becomes empty", () => {
      initWith(["tab-1", "tab-2"], "tab-1");
      const paneId = getSinglePaneId();

      getState().splitPane(W, paneId, "tab-2", "horizontal");
      const splitLayout = getState().layout[W] as {
        type: "split";
        children: [LayoutNode, LayoutNode];
      };
      const leftPaneId = (splitLayout.children[0] as { type: "leaf"; paneId: string }).paneId;
      const rightPaneId = (splitLayout.children[1] as { type: "leaf"; paneId: string }).paneId;

      // Move the only tab from left to right
      getState().moveTabToSiblingPane(W, leftPaneId, "tab-1");

      const state = getState();
      // Layout should collapse to a single leaf
      expect(state.layout[W].type).toBe("leaf");
      // Right pane should have both tabs
      expect(state.panes[W][rightPaneId].tabIds).toEqual(["tab-2", "tab-1"]);
    });

    it("no-ops when there is no sibling (single leaf)", () => {
      initWith(["tab-1", "tab-2"], "tab-1");
      const paneId = getSinglePaneId();

      getState().moveTabToSiblingPane(W, paneId, "tab-1");

      // Nothing should change
      const pane = getState().panes[W][paneId];
      expect(pane.tabIds).toEqual(["tab-1", "tab-2"]);
    });
  });

  // ── restoreLayout ───────────────────────────────────────────

  describe("restoreLayout", () => {
    it("restores layout, panes, and activePaneId", () => {
      const layout: LayoutNode = { type: "leaf", paneId: "pane-a" };
      const panes: Record<string, Pane> = {
        "pane-a": { tabIds: ["tab-1", "tab-2"], activeTabId: "tab-1", previewTabId: null },
      };

      getState().restoreLayout(W, layout, panes, "pane-a");

      const state = getState();
      expect(state.layout[W]).toEqual(layout);
      expect(state.panes[W]["pane-a"].tabIds).toEqual(["tab-1", "tab-2"]);
      expect(state.activePaneId[W]).toBe("pane-a");
    });

    it("falls back activeTabId to first tab when it does not exist in tabIds", () => {
      const layout: LayoutNode = { type: "leaf", paneId: "pane-a" };
      const panes: Record<string, Pane> = {
        "pane-a": { tabIds: ["tab-1", "tab-2"], activeTabId: "tab-gone", previewTabId: null },
      };

      getState().restoreLayout(W, layout, panes, "pane-a");

      const pane = getState().panes[W]["pane-a"];
      expect(pane.activeTabId).toBe("tab-1");
    });

    it("ensures previewTabId defaults to null", () => {
      const layout: LayoutNode = { type: "leaf", paneId: "pane-a" };
      const panes = {
        "pane-a": { tabIds: ["tab-1"], activeTabId: "tab-1" },
      } as unknown as Record<string, Pane>;

      getState().restoreLayout(W, layout, panes, "pane-a");

      const pane = getState().panes[W]["pane-a"];
      expect(pane.previewTabId).toBeNull();
    });
  });

  // ── openPreviewTab ──────────────────────────────────────────

  describe("openPreviewTab", () => {
    it("adds a new preview tab and sets it active", () => {
      initWith(["tab-1"], "tab-1");
      const paneId = getSinglePaneId();

      getState().openPreviewTab(W, paneId, "tab-preview");

      const pane = getState().panes[W][paneId];
      expect(pane.tabIds).toContain("tab-preview");
      expect(pane.activeTabId).toBe("tab-preview");
      expect(pane.previewTabId).toBe("tab-preview");
    });

    it("replaces old preview tab with new one", () => {
      initWith(["tab-1"], "tab-1");
      const paneId = getSinglePaneId();

      getState().openPreviewTab(W, paneId, "preview-1");
      getState().openPreviewTab(W, paneId, "preview-2");

      const pane = getState().panes[W][paneId];
      expect(pane.tabIds).not.toContain("preview-1");
      expect(pane.tabIds).toContain("preview-2");
      expect(pane.previewTabId).toBe("preview-2");
    });

    it("does not duplicate a tab that already exists in the pane", () => {
      initWith(["tab-1"], "tab-1");
      const paneId = getSinglePaneId();

      getState().openPreviewTab(W, paneId, "tab-1");

      const pane = getState().panes[W][paneId];
      expect(pane.tabIds).toEqual(["tab-1"]);
      expect(pane.previewTabId).toBe("tab-1");
    });
  });

  // ── pinPreviewTab ───────────────────────────────────────────

  describe("pinPreviewTab", () => {
    it("clears previewTabId", () => {
      initWith(["tab-1"], "tab-1");
      const paneId = getSinglePaneId();

      getState().openPreviewTab(W, paneId, "tab-preview");
      getState().pinPreviewTab(W, paneId);

      const pane = getState().panes[W][paneId];
      expect(pane.previewTabId).toBeNull();
      // Tab should still be in the pane
      expect(pane.tabIds).toContain("tab-preview");
    });

    it("no-ops when there is no preview tab", () => {
      initWith(["tab-1"], "tab-1");
      const paneId = getSinglePaneId();

      getState().pinPreviewTab(W, paneId);

      const pane = getState().panes[W][paneId];
      expect(pane.previewTabId).toBeNull();
    });
  });

  // ── addTabToPane ────────────────────────────────────────────

  describe("addTabToPane", () => {
    it("adds a tab and makes it active", () => {
      initWith(["tab-1"], "tab-1");
      const paneId = getSinglePaneId();

      getState().addTabToPane(W, paneId, "tab-2");

      const pane = getState().panes[W][paneId];
      expect(pane.tabIds).toEqual(["tab-1", "tab-2"]);
      expect(pane.activeTabId).toBe("tab-2");
    });

    it("falls back to active pane when target pane does not exist", () => {
      initWith(["tab-1"], "tab-1");
      const paneId = getSinglePaneId();

      getState().addTabToPane(W, "nonexistent-pane", "tab-2");

      // Should have been added to the active pane
      const pane = getState().panes[W][paneId];
      expect(pane.tabIds).toContain("tab-2");
    });
  });

  // ── findPaneForTab ──────────────────────────────────────────

  describe("findPaneForTab", () => {
    it("returns the paneId containing the tab", () => {
      initWith(["tab-1", "tab-2"], "tab-1");
      const paneId = getSinglePaneId();

      expect(getState().findPaneForTab(W, "tab-1")).toBe(paneId);
      expect(getState().findPaneForTab(W, "tab-2")).toBe(paneId);
    });

    it("returns null when tab is not found", () => {
      initWith(["tab-1"], "tab-1");
      expect(getState().findPaneForTab(W, "nonexistent")).toBeNull();
    });

    it("returns null for nonexistent worktree", () => {
      expect(getState().findPaneForTab("no-worktree", "tab-1")).toBeNull();
    });
  });

  // ── updateSplitRatio ────────────────────────────────────────

  describe("updateSplitRatio", () => {
    it("updates the ratio on a split layout", () => {
      initWith(["tab-1", "tab-2"], "tab-1");
      const paneId = getSinglePaneId();

      getState().splitPane(W, paneId, "tab-2", "horizontal");
      getState().updateSplitRatio(W, 0.7);

      const layout = getState().layout[W] as { type: "split"; ratio: number };
      expect(layout.ratio).toBe(0.7);
    });
  });

  // ── removeLayout ────────────────────────────────────────────

  describe("removeLayout", () => {
    it("removes all state for a worktree", () => {
      initWith(["tab-1"], "tab-1");

      getState().removeLayout(W);

      const state = getState();
      expect(state.layout[W]).toBeUndefined();
      expect(state.panes[W]).toBeUndefined();
      expect(state.activePaneId[W]).toBeUndefined();
    });
  });

  // ── Store persistence boundary ─────────────────────────────────
  // These tests verify that restoreLayout correctly handles data shapes
  // that come from @tauri-apps/plugin-store persistence. If the plugin
  // changes serialization format or the persisted schema drifts, these
  // will catch deserialization issues at the boundary.

  describe("store persistence boundary (restoreLayout)", () => {
    it("round-trips layout through initLayout then restoreLayout", () => {
      // Simulate: create state, read it out, restore into a clean store
      initWith(["tab-1", "tab-2"], "tab-1");

      const snapshot = getState();
      const savedLayout = snapshot.layout[W];
      const savedPanes = snapshot.panes[W];
      const savedActivePaneId = snapshot.activePaneId[W];

      // Clear and restore (simulates app restart with persisted data)
      useLayoutStore.setState({ layout: {}, panes: {}, activePaneId: {} });
      getState().restoreLayout(W, savedLayout, savedPanes, savedActivePaneId);

      const restored = getState();
      expect(restored.layout[W]).toEqual(savedLayout);
      expect(restored.panes[W]).toEqual(savedPanes);
      expect(restored.activePaneId[W]).toBe(savedActivePaneId);
    });

    it("handles persisted pane with missing previewTabId field (old schema)", () => {
      const layout: LayoutNode = { type: "leaf", paneId: "pane-a" };
      // Simulate old persisted data that lacks previewTabId entirely
      const panes = {
        "pane-a": { tabIds: ["tab-1"], activeTabId: "tab-1" },
      } as unknown as Record<string, Pane>;

      getState().restoreLayout(W, layout, panes, "pane-a");

      const pane = getState().panes[W]["pane-a"];
      expect(pane.previewTabId).toBeNull();
      expect(pane.tabIds).toEqual(["tab-1"]);
    });

    it("recovers when persisted activeTabId no longer exists in tabIds", () => {
      const layout: LayoutNode = { type: "leaf", paneId: "pane-a" };
      const panes: Record<string, Pane> = {
        "pane-a": {
          tabIds: ["tab-2", "tab-3"],
          activeTabId: "tab-deleted",
          previewTabId: null,
        },
      };

      getState().restoreLayout(W, layout, panes, "pane-a");

      const pane = getState().panes[W]["pane-a"];
      // Should fall back to first tab in the list
      expect(pane.activeTabId).toBe("tab-2");
    });

    it("preserves split layout structure through restore", () => {
      initWith(["tab-1", "tab-2"], "tab-1");
      const paneId = getSinglePaneId();

      getState().splitPane(W, paneId, "tab-2", "horizontal");

      // Snapshot the split state
      const snapshot = getState();
      const savedLayout = snapshot.layout[W];
      const savedPanes = snapshot.panes[W];
      const savedActivePaneId = snapshot.activePaneId[W];

      // Clear and restore
      useLayoutStore.setState({ layout: {}, panes: {}, activePaneId: {} });
      getState().restoreLayout(W, savedLayout, savedPanes, savedActivePaneId);

      const restored = getState();
      const layout = restored.layout[W] as {
        type: "split";
        direction: string;
        children: [LayoutNode, LayoutNode];
      };
      expect(layout.type).toBe("split");
      expect(layout.direction).toBe("horizontal");
      expect(layout.children).toHaveLength(2);

      // Both panes should be restored
      const paneIds = Object.keys(restored.panes[W]);
      expect(paneIds).toHaveLength(2);
    });

    it("restores multiple worktrees independently", () => {
      const W2 = "worktree-2";
      const layout1: LayoutNode = { type: "leaf", paneId: "pane-a" };
      const panes1: Record<string, Pane> = {
        "pane-a": { tabIds: ["tab-1"], activeTabId: "tab-1", previewTabId: null },
      };
      const layout2: LayoutNode = { type: "leaf", paneId: "pane-b" };
      const panes2: Record<string, Pane> = {
        "pane-b": { tabIds: ["tab-2"], activeTabId: "tab-2", previewTabId: null },
      };

      getState().restoreLayout(W, layout1, panes1, "pane-a");
      getState().restoreLayout(W2, layout2, panes2, "pane-b");

      expect(getState().layout[W]).toEqual(layout1);
      expect(getState().layout[W2]).toEqual(layout2);
      expect(getState().panes[W]["pane-a"].tabIds).toEqual(["tab-1"]);
      expect(getState().panes[W2]["pane-b"].tabIds).toEqual(["tab-2"]);
    });
  });
});
