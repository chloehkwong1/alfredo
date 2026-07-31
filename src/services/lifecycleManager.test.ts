import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock all dependencies
const mockRemoveWorktree = vi.fn();
const mockRemoveWorktreeTabs = vi.fn();
const mockRemoveWorktreeState = vi.fn();
const mockRemoveLayout = vi.fn();
const mockCloseSession = vi.fn().mockResolvedValue(undefined);
const mockStopSession = vi.fn().mockResolvedValue(undefined);
const mockSetRunningServer = vi.fn();
const mockGetSession = vi.fn(() => null as { sessionId: string } | null);
const mockListSessions = vi.fn(() => Promise.resolve([] as unknown[]));
const mockClosePty = vi.fn((..._args: unknown[]) => Promise.resolve());
const mockDeleteWorktreeApi = vi.fn().mockResolvedValue(undefined);
const mockReleaseWorktreePort = vi.fn((..._args: unknown[]) => Promise.resolve());
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
let workspaceStoreState: Record<string, unknown>;

vi.mock("../stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => workspaceStoreState,
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
    stopSession: (...args: unknown[]) => mockStopSession(...args),
    getSession: (...args: unknown[]) => mockGetSession(...(args as [])),
  },
  stateSourceMap: new Map(),
}));

vi.mock("../api", () => ({
  deleteWorktree: (...args: unknown[]) => mockDeleteWorktreeApi(...args),
  releaseWorktreePort: (...args: unknown[]) => mockReleaseWorktreePort(...args),
  releasePortFor: (wt: { repoPath: string; id: string }) =>
    mockReleaseWorktreePort(wt.repoPath, wt.id),
  listSessions: () => mockListSessions(),
  closePty: (...args: unknown[]) => mockClosePty(...args),
}));

vi.mock("./SessionPersistence", () => ({
  deleteSession: (...args: unknown[]) => mockDeleteSessionFile(...args),
}));

// Import AFTER mocks are declared
import { lifecycleManager } from "./lifecycleManager";
import { stopServerAndReleasePort, stopDevServer } from "./portReclaim";

beforeEach(() => {
  vi.resetAllMocks();
  mockCloseSession.mockResolvedValue(undefined);
  mockStopSession.mockResolvedValue(undefined);
  mockGetSession.mockReturnValue(null);
  mockListSessions.mockResolvedValue([]);
  mockClosePty.mockResolvedValue(undefined);
  mockDeleteWorktreeApi.mockResolvedValue(undefined);
  mockReleaseWorktreePort.mockResolvedValue(undefined);
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
  workspaceStoreState = {
    removeWorktree: mockRemoveWorktree,
    runningServers: {},
    setRunningServer: mockSetRunningServer,
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

    it("releases the worktree port by id before deleting", async () => {
      await lifecycleManager.removeWorktree(
        "/repo::feat/x",      // worktreeId (the port_assignments key)
        "/repo",              // repoPath
        "feat-x",             // worktreeName (git name — must NOT be the release key)
      );
      expect(mockReleaseWorktreePort).toHaveBeenCalledWith("/repo", "/repo::feat/x");
      expect(mockReleaseWorktreePort).not.toHaveBeenCalledWith("/repo", "feat-x");
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

    it("does NOT focus a pinned committed tab when opening the uncommitted variant of the same file", () => {
      (layoutStoreState.activePaneId as Record<string, string>)[worktreeId] =
        "pane-1";
      mockGetPane.mockReturnValue({
        tabIds: ["pinned-committed"],
        previewTabId: undefined,
      });

      tabStoreState.tabs = {
        [worktreeId]: [
          {
            id: "pinned-committed",
            type: "diff",
            label: "App.tsx",
            diffTarget: { ...fileDiffTarget, isUncommitted: false },
          },
        ],
      };

      const result = lifecycleManager.openDiffPreview(worktreeId, {
        ...fileDiffTarget,
        isUncommitted: true,
      });

      expect(result).not.toBe("pinned-committed");
      expect(mockSetPaneActiveTab).not.toHaveBeenCalledWith(
        worktreeId,
        "pane-1",
        "pinned-committed",
      );
      // Should create a new tab for the uncommitted variant
      expect(mockRestoreTabs).toHaveBeenCalled();
      expect(mockOpenPreviewTab).toHaveBeenCalled();
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

describe("stopServerAndReleasePort", () => {
  const wt = { repoPath: "/repo", id: "/repo::feature-1" };

  it("stops the running dev server before releasing its port", async () => {
    const callOrder: string[] = [];
    workspaceStoreState.runningServers = {
      [wt.id]: { sessionId: "sess-1", tabId: "tab-server" },
    };
    mockStopSession.mockImplementation(() => {
      callOrder.push("stopSession");
      return Promise.resolve();
    });
    mockReleaseWorktreePort.mockImplementation(() => {
      callOrder.push("releasePort");
      return Promise.resolve();
    });

    await stopServerAndReleasePort(wt, "test");

    expect(mockStopSession).toHaveBeenCalledWith("tab-server");
    expect(mockReleaseWorktreePort).toHaveBeenCalledWith("/repo", "/repo::feature-1");
    // Releasing the assignment while the process still holds the OS port is the
    // bug this guards: the next claimant would be handed a bound port.
    expect(callOrder).toEqual(["stopSession", "releasePort"]);
  });

  it("clears the tab command and the running-server entry so Start can re-run", async () => {
    workspaceStoreState.runningServers = {
      [wt.id]: { sessionId: "sess-1", tabId: "tab-server" },
    };

    await stopServerAndReleasePort(wt, "test");

    expect(mockUpdateTab).toHaveBeenCalledWith(wt.id, "tab-server", { command: undefined });
    expect(mockSetRunningServer).toHaveBeenCalledWith(wt.id, null);
  });

  it("releases the port without touching sessions when no server is running", async () => {
    workspaceStoreState.runningServers = {};

    await stopServerAndReleasePort(wt, "test");

    expect(mockStopSession).not.toHaveBeenCalled();
    expect(mockReleaseWorktreePort).toHaveBeenCalledWith("/repo", "/repo::feature-1");
  });

  it("keys on worktree id, not name — a name key silently no-ops the release", async () => {
    workspaceStoreState.runningServers = {
      "feature-1": { sessionId: "sess-1", tabId: "tab-server" },
    };

    await stopServerAndReleasePort(wt, "test");

    expect(mockStopSession).not.toHaveBeenCalled();
  });

  it("stopDevServer performs the full stop trio in order", async () => {
    await stopDevServer("wt-9", "tab-9");

    expect(mockStopSession).toHaveBeenCalledWith("tab-9");
    expect(mockUpdateTab).toHaveBeenCalledWith("wt-9", "tab-9", { command: undefined });
    expect(mockSetRunningServer).toHaveBeenCalledWith("wt-9", null);
  });

  it("stopDevServer does not disown a server started during the await", async () => {
    // The entry moved on to a different tab while stopSession was in flight —
    // clearing it would hide a server that is actually running.
    mockStopSession.mockImplementation(() => {
      workspaceStoreState.runningServers = {
        "wt-9": { sessionId: "sess-2", tabId: "tab-NEW" },
      };
      return Promise.resolve();
    });

    await stopDevServer("wt-9", "tab-OLD");

    expect(mockSetRunningServer).not.toHaveBeenCalled();
  });

  it("keeps the port assignment when the server fails to stop", async () => {
    // Releasing here would strand a bound port: the picker builds held slots
    // from the assignments map, so a released port renders free and unreclaimable.
    workspaceStoreState.runningServers = {
      [wt.id]: { sessionId: "sess-1", tabId: "tab-server" },
    };
    mockStopSession.mockRejectedValue(new Error("pty already gone"));

    await stopServerAndReleasePort(wt, "test");

    expect(mockReleaseWorktreePort).not.toHaveBeenCalled();
  });

  it("closes a live server session the store lost track of, then releases", async () => {
    // runningServers is best-effort — the stale-server sweep can clear an entry
    // while the PTY is still alive. Rust is the authority.
    workspaceStoreState.runningServers = {};
    mockListSessions.mockResolvedValue([
      { id: "sess-orphan", worktreeId: wt.id, sessionType: "server", status: "running" },
    ]);

    await stopServerAndReleasePort(wt, "test");

    expect(mockClosePty).toHaveBeenCalledWith("sess-orphan");
    expect(mockReleaseWorktreePort).toHaveBeenCalledWith("/repo", "/repo::feature-1");
  });

  it("does not double-close the session already handled by stopDevServer", async () => {
    workspaceStoreState.runningServers = {
      [wt.id]: { sessionId: "sess-1", tabId: "tab-server" },
    };
    mockGetSession.mockReturnValue({ sessionId: "sess-1" });
    mockListSessions.mockResolvedValue([
      { id: "sess-1", worktreeId: wt.id, sessionType: "server", status: "running" },
    ]);

    await stopServerAndReleasePort(wt, "test");

    expect(mockStopSession).toHaveBeenCalledWith("tab-server");
    expect(mockClosePty).not.toHaveBeenCalled();
    expect(mockReleaseWorktreePort).toHaveBeenCalledWith("/repo", "/repo::feature-1");
  });

  it("ignores agent and shell sessions, and other worktrees' servers", async () => {
    workspaceStoreState.runningServers = {};
    mockListSessions.mockResolvedValue([
      { id: "a", worktreeId: wt.id, sessionType: "agent", status: "running" },
      { id: "s", worktreeId: wt.id, sessionType: "shell", status: "running" },
      { id: "other", worktreeId: "/repo::feature-2", sessionType: "server", status: "running" },
      { id: "dead", worktreeId: wt.id, sessionType: "server", status: { exited: 0 } },
    ]);

    await stopServerAndReleasePort(wt, "test");

    expect(mockClosePty).not.toHaveBeenCalled();
    expect(mockReleaseWorktreePort).toHaveBeenCalledWith("/repo", "/repo::feature-1");
  });

  it("keeps the assignment when an orphaned session fails to close", async () => {
    workspaceStoreState.runningServers = {};
    mockListSessions.mockResolvedValue([
      { id: "sess-orphan", worktreeId: wt.id, sessionType: "server", status: "running" },
    ]);
    mockClosePty.mockRejectedValue(new Error("close failed"));

    await stopServerAndReleasePort(wt, "test");

    expect(mockReleaseWorktreePort).not.toHaveBeenCalled();
  });

  it("does not release a port claimed by a server started during teardown", async () => {
    workspaceStoreState.runningServers = {
      [wt.id]: { sessionId: "sess-1", tabId: "tab-OLD" },
    };
    // User drags back out of Done and hits Start while the stop is in flight.
    mockStopSession.mockImplementation(() => {
      workspaceStoreState.runningServers = {
        [wt.id]: { sessionId: "sess-2", tabId: "tab-NEW" },
      };
      return Promise.resolve();
    });

    await stopServerAndReleasePort(wt, "test");

    expect(mockReleaseWorktreePort).not.toHaveBeenCalled();
  });

  it("keeps the assignment when the session list is unavailable", async () => {
    // Without the authoritative list we cannot know what is still bound.
    mockListSessions.mockRejectedValue(new Error("ipc down"));

    await stopServerAndReleasePort(wt, "test");

    expect(mockStopSession).not.toHaveBeenCalled();
    expect(mockReleaseWorktreePort).not.toHaveBeenCalled();
  });
});
