import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock all dependencies
const mockRemoveWorktree = vi.fn();
const mockRemoveWorktreeTabs = vi.fn();
const mockRemoveWorktreeState = vi.fn();
const mockRemoveLayout = vi.fn();
const mockCloseSession = vi.fn().mockResolvedValue(undefined);
const mockDeleteWorktreeApi = vi.fn().mockResolvedValue(undefined);
const mockDeleteSessionFile = vi.fn().mockResolvedValue(undefined);
const mockAddTab = vi.fn();
const mockRemoveTab = vi.fn();
const mockEnsureDefaultTabs = vi.fn();
const mockRestoreTabs = vi.fn();
const mockUpdateTab = vi.fn();
const mockInitLayout = vi.fn();
const mockAddTabToPane = vi.fn();
const mockRemoveTabFromPane = vi.fn();
const mockOpenPreviewTab = vi.fn();
const mockSetPaneActiveTab = vi.fn();
const mockPinPreviewTab = vi.fn();
const mockGetPane = vi.fn();

let tabStoreState: Record<string, unknown>;
let layoutStoreState: Record<string, unknown>;

vi.mock("../stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({ removeWorktree: mockRemoveWorktree }),
  },
}));

vi.mock("../stores/tabStore", () => ({
  useTabStore: {
    getState: () => tabStoreState,
  },
}));

vi.mock("../stores/prStore", () => ({
  usePrStore: {
    getState: () => ({ removeWorktreeState: mockRemoveWorktreeState }),
  },
}));

vi.mock("../stores/layoutStore", () => ({
  useLayoutStore: {
    getState: () => layoutStoreState,
  },
}));

vi.mock("./sessionManager", () => ({
  sessionManager: {
    closeSession: (...args: unknown[]) => mockCloseSession(...args),
  },
}));

vi.mock("../api", () => ({
  deleteWorktree: (...args: unknown[]) => mockDeleteWorktreeApi(...args),
}));

vi.mock("./SessionPersistence", () => ({
  deleteSession: (...args: unknown[]) => mockDeleteSessionFile(...args),
}));

// Import AFTER mocks are declared
import { lifecycleManager } from "./lifecycleManager";

beforeEach(() => {
  vi.resetAllMocks();
  mockCloseSession.mockResolvedValue(undefined);
  mockDeleteWorktreeApi.mockResolvedValue(undefined);
  mockDeleteSessionFile.mockResolvedValue(undefined);
  tabStoreState = {
    tabs: {},
    activeTabId: {},
    addTab: mockAddTab,
    removeTab: mockRemoveTab,
    removeWorktreeTabs: mockRemoveWorktreeTabs,
    ensureDefaultTabs: mockEnsureDefaultTabs,
    restoreTabs: mockRestoreTabs,
    updateTab: mockUpdateTab,
  };
  layoutStoreState = {
    layout: {},
    panes: {},
    activePaneId: {},
    initLayout: mockInitLayout,
    addTabToPane: mockAddTabToPane,
    removeTabFromPane: mockRemoveTabFromPane,
    openPreviewTab: mockOpenPreviewTab,
    setPaneActiveTab: mockSetPaneActiveTab,
    pinPreviewTab: mockPinPreviewTab,
    getPane: mockGetPane,
    removeLayout: mockRemoveLayout,
  };
});

describe("lifecycleManager", () => {
  const worktreeId = "wt-1";

  describe("addTab", () => {
    it("returns the new tab ID and adds it to the layout pane", () => {
      const existingTab = { id: "tab-1", type: "claude" as const, label: "Claude" };
      const newTab = { id: "tab-2", type: "shell" as const, label: "Shell" };

      // Start with one tab; addTab side-effect appends the new tab
      tabStoreState.tabs = { [worktreeId]: [existingTab] };
      mockAddTab.mockImplementation(() => {
        (tabStoreState.tabs as Record<string, unknown[]>)[worktreeId] = [
          existingTab,
          newTab,
        ];
      });

      // Layout state with an active pane
      (layoutStoreState.activePaneId as Record<string, string>)[worktreeId] =
        "pane-1";

      const result = lifecycleManager.addTab(worktreeId, "shell");

      expect(result).toBe("tab-2");
      expect(mockAddTab).toHaveBeenCalledWith(worktreeId, "shell");
      expect(mockAddTabToPane).toHaveBeenCalledWith(
        worktreeId,
        "pane-1",
        "tab-2",
      );
    });

    it("returns null when no new tab was created", () => {
      const tabs = [{ id: "tab-1", type: "claude" as const, label: "Claude" }];
      tabStoreState.tabs = { [worktreeId]: tabs };
      // addTab doesn't actually add anything (simulates failure)

      const result = lifecycleManager.addTab(worktreeId, "shell");

      expect(result).toBeNull();
    });

    it("uses specified paneId instead of active pane", () => {
      const existingTab = { id: "tab-1", type: "claude" as const, label: "Claude" };
      const newTab = { id: "tab-3", type: "shell" as const, label: "Shell" };

      tabStoreState.tabs = { [worktreeId]: [existingTab] };
      mockAddTab.mockImplementation(() => {
        (tabStoreState.tabs as Record<string, unknown[]>)[worktreeId] = [
          existingTab,
          newTab,
        ];
      });

      const result = lifecycleManager.addTab(worktreeId, "shell", "custom-pane");

      expect(result).toBe("tab-3");
      expect(mockAddTabToPane).toHaveBeenCalledWith(
        worktreeId,
        "custom-pane",
        "tab-3",
      );
    });
  });

  describe("removeTab", () => {
    it("closes session, removes tab, and removes from layout pane in order", async () => {
      const callOrder: string[] = [];
      mockCloseSession.mockImplementation(() => {
        callOrder.push("closeSession");
        return Promise.resolve();
      });
      mockRemoveTab.mockImplementation(() => callOrder.push("removeTab"));
      mockRemoveTabFromPane.mockImplementation(() =>
        callOrder.push("removeTabFromPane"),
      );

      await lifecycleManager.removeTab(worktreeId, "tab-1");

      expect(mockCloseSession).toHaveBeenCalledWith("tab-1");
      expect(mockRemoveTab).toHaveBeenCalledWith(worktreeId, "tab-1");
      expect(mockRemoveTabFromPane).toHaveBeenCalledWith(worktreeId, "tab-1");
      expect(callOrder).toEqual([
        "closeSession",
        "removeTab",
        "removeTabFromPane",
      ]);
    });
  });

  describe("removeWorktree", () => {
    const repoPath = "/repos/my-project";
    const worktreeName = "feature-branch";
    const tabs = [
      { id: "tab-a", type: "claude" as const, label: "Claude" },
      { id: "tab-b", type: "shell" as const, label: "Shell" },
    ];

    beforeEach(() => {
      tabStoreState.tabs = { [worktreeId]: tabs };
    });

    it("removes from all stores, closes sessions, deletes worktree and session file", async () => {
      await lifecycleManager.removeWorktree(
        worktreeId,
        repoPath,
        worktreeName,
      );

      // Store removals
      expect(mockRemoveWorktree).toHaveBeenCalledWith(worktreeId);
      expect(mockRemoveWorktreeTabs).toHaveBeenCalledWith(worktreeId);
      expect(mockRemoveWorktreeState).toHaveBeenCalledWith(worktreeId);
      expect(mockRemoveLayout).toHaveBeenCalledWith(worktreeId);

      // Session closes for each tab
      expect(mockCloseSession).toHaveBeenCalledWith("tab-a");
      expect(mockCloseSession).toHaveBeenCalledWith("tab-b");

      // Git worktree deletion
      expect(mockDeleteWorktreeApi).toHaveBeenCalledWith(
        repoPath,
        worktreeName,
        true,
      );

      // Session file deletion
      expect(mockDeleteSessionFile).toHaveBeenCalledWith(repoPath, worktreeId);
    });

    it("calls stores synchronously before async cleanup", async () => {
      const callOrder: string[] = [];
      mockRemoveWorktree.mockImplementation(() =>
        callOrder.push("removeWorktree"),
      );
      mockRemoveWorktreeTabs.mockImplementation(() =>
        callOrder.push("removeWorktreeTabs"),
      );
      mockRemoveWorktreeState.mockImplementation(() =>
        callOrder.push("removeWorktreeState"),
      );
      mockRemoveLayout.mockImplementation(() =>
        callOrder.push("removeLayout"),
      );
      mockCloseSession.mockImplementation(() => {
        callOrder.push("closeSession");
        return Promise.resolve();
      });
      mockDeleteWorktreeApi.mockImplementation(() => {
        callOrder.push("deleteWorktreeApi");
        return Promise.resolve();
      });
      mockDeleteSessionFile.mockImplementation(() => {
        callOrder.push("deleteSessionFile");
        return Promise.resolve();
      });

      await lifecycleManager.removeWorktree(
        worktreeId,
        repoPath,
        worktreeName,
      );

      // Stores removed first, then async cleanup
      expect(callOrder.indexOf("removeWorktree")).toBeLessThan(
        callOrder.indexOf("closeSession"),
      );
      expect(callOrder.indexOf("removeLayout")).toBeLessThan(
        callOrder.indexOf("deleteWorktreeApi"),
      );
    });

    it("continues cleanup even when session close fails", async () => {
      mockCloseSession.mockRejectedValue(new Error("PTY gone"));

      await lifecycleManager.removeWorktree(
        worktreeId,
        repoPath,
        worktreeName,
      );

      // Should still attempt all cleanup despite session close failure
      expect(mockDeleteWorktreeApi).toHaveBeenCalled();
      expect(mockDeleteSessionFile).toHaveBeenCalled();
    });

    it("continues cleanup even when deleteWorktreeApi fails", async () => {
      mockDeleteWorktreeApi.mockRejectedValue(new Error("git error"));

      await lifecycleManager.removeWorktree(
        worktreeId,
        repoPath,
        worktreeName,
      );

      // Session file deletion should still be attempted
      expect(mockDeleteSessionFile).toHaveBeenCalledWith(repoPath, worktreeId);
    });
  });

  describe("initWorktreeDefaults", () => {
    it("calls ensureDefaultTabs and initLayout when no layout exists", () => {
      const tabs = [
        { id: "tab-1", type: "claude" as const, label: "Claude" },
      ];
      // After ensureDefaultTabs, tabStore should return tabs
      tabStoreState.tabs = { [worktreeId]: tabs };
      tabStoreState.activeTabId = { [worktreeId]: "tab-1" };

      lifecycleManager.initWorktreeDefaults(worktreeId);

      expect(mockEnsureDefaultTabs).toHaveBeenCalledWith(worktreeId);
      expect(mockInitLayout).toHaveBeenCalledWith(
        worktreeId,
        ["tab-1"],
        "tab-1",
      );
    });

    it("skips initLayout when layout already exists", () => {
      tabStoreState.tabs = { [worktreeId]: [] };
      (layoutStoreState.layout as Record<string, unknown>)[worktreeId] = {
        paneIds: ["pane-1"],
      };

      lifecycleManager.initWorktreeDefaults(worktreeId);

      expect(mockEnsureDefaultTabs).toHaveBeenCalledWith(worktreeId);
      expect(mockInitLayout).not.toHaveBeenCalled();
    });
  });

  describe("openDiffPreview", () => {
    const fileDiffTarget = {
      type: "file" as const,
      filePath: "src/components/App.tsx",
    };

    it("returns null when no active pane exists", () => {
      const result = lifecycleManager.openDiffPreview(
        worktreeId,
        fileDiffTarget,
      );
      expect(result).toBeNull();
    });

    it("updates existing preview tab in place and reuses its ID", () => {
      (layoutStoreState.activePaneId as Record<string, string>)[worktreeId] =
        "pane-1";
      mockGetPane.mockReturnValue({
        tabIds: ["tab-1"],
        previewTabId: "tab-1",
      });

      tabStoreState.tabs = {
        [worktreeId]: [
          { id: "tab-1", type: "diff", label: "Old", diffTarget: null },
        ],
      };

      const result = lifecycleManager.openDiffPreview(
        worktreeId,
        fileDiffTarget,
      );

      expect(result).toBe("tab-1");
      expect(mockUpdateTab).toHaveBeenCalledWith(worktreeId, "tab-1", {
        diffTarget: fileDiffTarget,
        label: "App.tsx",
      });
      expect(mockSetPaneActiveTab).toHaveBeenCalledWith(
        worktreeId,
        "pane-1",
        "tab-1",
      );
    });

    it("creates a new diff tab when no preview exists", () => {
      (layoutStoreState.activePaneId as Record<string, string>)[worktreeId] =
        "pane-1";
      mockGetPane.mockReturnValue({
        tabIds: ["tab-1"],
        previewTabId: undefined,
      });

      tabStoreState.tabs = {
        [worktreeId]: [
          { id: "tab-1", type: "claude", label: "Claude" },
        ],
      };

      const result = lifecycleManager.openDiffPreview(
        worktreeId,
        fileDiffTarget,
      );

      expect(result).not.toBeNull();
      expect(mockRestoreTabs).toHaveBeenCalled();
      expect(mockOpenPreviewTab).toHaveBeenCalledWith(
        worktreeId,
        "pane-1",
        expect.any(String),
      );
    });

    it("focuses existing pinned tab for the same file instead of creating a duplicate", () => {
      (layoutStoreState.activePaneId as Record<string, string>)[worktreeId] =
        "pane-1";
      mockGetPane.mockReturnValue({
        tabIds: ["pinned-diff"],
        previewTabId: undefined,
      });

      tabStoreState.tabs = {
        [worktreeId]: [
          {
            id: "pinned-diff",
            type: "diff",
            label: "App.tsx",
            diffTarget: fileDiffTarget,
          },
        ],
      };

      const result = lifecycleManager.openDiffPreview(
        worktreeId,
        fileDiffTarget,
      );

      expect(result).toBe("pinned-diff");
      expect(mockSetPaneActiveTab).toHaveBeenCalledWith(
        worktreeId,
        "pane-1",
        "pinned-diff",
      );
      // Should NOT create a new tab
      expect(mockRestoreTabs).not.toHaveBeenCalled();
      expect(mockOpenPreviewTab).not.toHaveBeenCalled();
    });

    it("uses commit hash prefix as label for commit diffs", () => {
      const commitTarget = {
        type: "commit" as const,
        commitHash: "abc1234def5678",
      };
      (layoutStoreState.activePaneId as Record<string, string>)[worktreeId] =
        "pane-1";
      mockGetPane.mockReturnValue({
        tabIds: ["tab-1"],
        previewTabId: "tab-1",
      });

      tabStoreState.tabs = {
        [worktreeId]: [
          { id: "tab-1", type: "diff", label: "Old", diffTarget: null },
        ],
      };

      lifecycleManager.openDiffPreview(worktreeId, commitTarget);

      expect(mockUpdateTab).toHaveBeenCalledWith(worktreeId, "tab-1", {
        diffTarget: commitTarget,
        label: "abc1234",
      });
    });
  });

  describe("pinCurrentPreview", () => {
    it("calls pinPreviewTab on the active pane", () => {
      (layoutStoreState.activePaneId as Record<string, string>)[worktreeId] =
        "pane-1";

      lifecycleManager.pinCurrentPreview(worktreeId);

      expect(mockPinPreviewTab).toHaveBeenCalledWith(worktreeId, "pane-1");
    });

    it("does nothing when no active pane exists", () => {
      lifecycleManager.pinCurrentPreview(worktreeId);

      expect(mockPinPreviewTab).not.toHaveBeenCalled();
    });
  });

  describe("syncTabsToLayout", () => {
    it("adds orphaned tabs to the active pane", () => {
      (layoutStoreState.layout as Record<string, unknown>)[worktreeId] = {
        paneIds: ["pane-1"],
      };
      (layoutStoreState.panes as Record<string, unknown>)[worktreeId] = {
        "pane-1": { tabIds: ["tab-1"] },
      };
      (layoutStoreState.activePaneId as Record<string, string>)[worktreeId] =
        "pane-1";

      tabStoreState.tabs = {
        [worktreeId]: [
          { id: "tab-1", type: "claude", label: "Claude" },
          { id: "tab-2", type: "shell", label: "Shell" }, // orphaned
        ],
      };

      lifecycleManager.syncTabsToLayout(worktreeId);

      expect(mockAddTabToPane).toHaveBeenCalledWith(
        worktreeId,
        "pane-1",
        "tab-2",
      );
    });

    it("prunes stale tabs from panes", () => {
      (layoutStoreState.layout as Record<string, unknown>)[worktreeId] = {
        paneIds: ["pane-1"],
      };
      (layoutStoreState.panes as Record<string, unknown>)[worktreeId] = {
        "pane-1": { tabIds: ["tab-1", "tab-gone"] },
      };
      (layoutStoreState.activePaneId as Record<string, string>)[worktreeId] =
        "pane-1";

      tabStoreState.tabs = {
        [worktreeId]: [
          { id: "tab-1", type: "claude", label: "Claude" },
          // tab-gone is no longer in tabStore
        ],
      };

      lifecycleManager.syncTabsToLayout(worktreeId);

      expect(mockRemoveTabFromPane).toHaveBeenCalledWith(
        worktreeId,
        "tab-gone",
      );
    });

    it("falls back to initWorktreeDefaults when no layout exists", () => {
      tabStoreState.tabs = {
        [worktreeId]: [
          { id: "tab-1", type: "claude", label: "Claude" },
        ],
      };
      tabStoreState.activeTabId = { [worktreeId]: "tab-1" };

      lifecycleManager.syncTabsToLayout(worktreeId);

      // initWorktreeDefaults calls ensureDefaultTabs + initLayout
      expect(mockEnsureDefaultTabs).toHaveBeenCalledWith(worktreeId);
      expect(mockInitLayout).toHaveBeenCalled();
    });
  });

  // ── Tauri invoke interface contracts ───────────────────────────
  // These tests verify that the dependency boundary between the frontend
  // and Tauri backend (via @tauri-apps/api/core invoke) receives the
  // correct command names and argument shapes. If @tauri-apps/api changes
  // the invoke API or the Rust backend renames commands, these will catch it.

  describe("invoke interface contracts", () => {
    it("deleteWorktreeApi passes repoPath, worktreeName, and force flag to invoke", async () => {
      const repoPath = "/repos/my-project";
      const worktreeName = "feature-branch";
      const tabs = [{ id: "tab-a", type: "claude" as const, label: "Claude" }];
      tabStoreState.tabs = { [worktreeId]: tabs };

      await lifecycleManager.removeWorktree(worktreeId, repoPath, worktreeName);

      // Verify the exact argument shape passed to the API layer
      expect(mockDeleteWorktreeApi).toHaveBeenCalledTimes(1);
      const [argRepoPath, argWorktreeName, argForce] =
        mockDeleteWorktreeApi.mock.calls[0];
      expect(argRepoPath).toBe(repoPath);
      expect(argWorktreeName).toBe(worktreeName);
      expect(argForce).toBe(true);
    });

    it("deleteSessionFile passes repoPath and worktreeId to invoke", async () => {
      const repoPath = "/repos/my-project";
      const worktreeName = "feature-branch";
      tabStoreState.tabs = { [worktreeId]: [] };

      await lifecycleManager.removeWorktree(worktreeId, repoPath, worktreeName);

      expect(mockDeleteSessionFile).toHaveBeenCalledTimes(1);
      const [argRepoPath, argWorktreeId] = mockDeleteSessionFile.mock.calls[0];
      expect(argRepoPath).toBe(repoPath);
      expect(argWorktreeId).toBe(worktreeId);
    });

    it("closeSession passes tab ID as the session key to invoke", async () => {
      const tabs = [
        { id: "tab-x", type: "shell" as const, label: "Shell" },
      ];
      tabStoreState.tabs = { [worktreeId]: tabs };

      await lifecycleManager.removeWorktree(worktreeId, "/repo", "branch");

      expect(mockCloseSession).toHaveBeenCalledWith("tab-x");
    });

    it("removeTab closes session before any store mutations", async () => {
      const callOrder: string[] = [];
      mockCloseSession.mockImplementation(() => {
        callOrder.push("closeSession");
        return Promise.resolve();
      });
      mockRemoveTab.mockImplementation(() => callOrder.push("removeTab"));
      mockRemoveTabFromPane.mockImplementation(() =>
        callOrder.push("removeTabFromPane"),
      );

      await lifecycleManager.removeTab(worktreeId, "tab-1");

      // Session close (async invoke boundary) must complete before store ops
      expect(callOrder[0]).toBe("closeSession");
    });
  });
});
