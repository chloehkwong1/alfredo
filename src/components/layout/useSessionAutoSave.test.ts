import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useTabStore } from "../../stores/tabStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { installResumeSessionPersistence } from "./useSessionAutoSave";
import type { Worktree } from "../../types";

const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;

function saveSessionCalls() {
  return invokeMock.mock.calls.filter((c) => c[0] === "save_session_file");
}

function seedWorktree(repoPath: string, wtId: string, tabId: string, resumeSessionId?: string) {
  useWorkspaceStore.setState({
    worktrees: [
      {
        id: wtId,
        name: "branch",
        path: repoPath,
        branch: "branch",
        prStatus: null,
        agentStatus: "notRunning",
        column: "inProgress",
        additions: null,
        deletions: null,
        repoPath,
      } as unknown as Worktree,
    ],
  });
  useTabStore.setState({
    tabs: { [wtId]: [{ id: tabId, type: "claude", label: "Claude", ...(resumeSessionId ? { resumeSessionId } : {}) }] },
    activeTabId: { [wtId]: tabId },
  });
}

describe("installResumeSessionPersistence — write-through on resumeSessionId change", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockClear();
    invokeMock.mockResolvedValue(undefined);
    useTabStore.getState().clearStore();
    useWorkspaceStore.setState({ worktrees: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The 30s autosave + onCloseRequested are the only paths that persisted
  // resumeSessionId, and Force Quit (SIGKILL) skips onCloseRequested entirely.
  // Write-through must persist the moment discovery adopts a new session.
  it("persists a tab's resumeSessionId to disk when it changes, with no quit/close save", async () => {
    const repoPath = "/repo";
    const wtId = "/repo::branch";
    const tabId = `${wtId}:claude:abc12345`;
    seedWorktree(repoPath, wtId, tabId);

    const stop = installResumeSessionPersistence();
    try {
      // Simulate TerminalView's discovery loop adopting a freshly-spawned session.
      useTabStore.getState().updateTab(wtId, tabId, { resumeSessionId: "sess-xyz-789" });
      await vi.advanceTimersByTimeAsync(2_000);
    } finally {
      stop();
    }

    const calls = saveSessionCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(calls[calls.length - 1][1])).toContain("sess-xyz-789");
  });

  it("does not persist when a tab change leaves all resumeSessionIds unchanged", async () => {
    const repoPath = "/repo";
    const wtId = "/repo::branch";
    const tabId = `${wtId}:claude:abc12345`;
    seedWorktree(repoPath, wtId, tabId, "stable-id");

    const stop = installResumeSessionPersistence();
    try {
      // Active-tab change touches the store but not any resumeSessionId.
      useTabStore.getState().setActiveTabId(wtId, tabId);
      await vi.advanceTimersByTimeAsync(2_000);
    } finally {
      stop();
    }

    expect(saveSessionCalls().length).toBe(0);
  });
});
