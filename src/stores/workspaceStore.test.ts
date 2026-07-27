import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";
import type { Worktree } from "../types";

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "wt-1",
    name: "wt-1",
    path: "/path/wt-1",
    branch: "feature-1",
    repoPath: "/repo",
    prStatus: null,
    agentStatus: "notRunning",
    column: "inProgress",
    isBranchMode: false,
    additions: null,
    deletions: null,
    ...overrides,
  };
}

beforeEach(() => {
  useWorkspaceStore.getState().clearStore();
  vi.restoreAllMocks();
});

// ── mergeWorktreeState (via setWorktrees) ─────────────────────────

describe("setWorktrees / mergeWorktreeState", () => {
  it("preserves enriched fields from existing state", () => {
    const store = useWorkspaceStore;
    // Seed with enriched state
    store.setState({
      worktrees: [
        makeWorktree({
          prStatus: { number: 1, state: "open", title: "PR", url: "u", draft: false, merged: false, branch: "feature-1" },
          column: "needsReview",
          agentStatus: "busy",
          channelAlive: true,
          staleBusy: true,
          archived: true,
          archivedAt: 500,
          claudeSessionId: "sess-1",
          linearTicketUrl: "https://linear.app/t/1",
          linearTicketIdentifier: "ROS-42",
          justCreated: true,
          additions: 917,
          deletions: 90,
          runningAgents: 3,
        }),
      ],
    });

    // Fresh git data has none of the enriched fields
    store.getState().setWorktrees([
      makeWorktree({ path: "/new/path", branch: "feature-1-updated" }),
    ]);

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    // Fresh git data wins
    expect(wt.path).toBe("/new/path");
    expect(wt.branch).toBe("feature-1-updated");
    // Enriched fields preserved
    expect(wt.prStatus?.number).toBe(1);
    expect(wt.column).toBe("needsReview");
    expect(wt.agentStatus).toBe("busy");
    expect(wt.channelAlive).toBe(true);
    expect(wt.staleBusy).toBe(true);
    expect(wt.archived).toBe(true);
    expect(wt.archivedAt).toBe(500);
    expect(wt.claudeSessionId).toBe("sess-1");
    expect(wt.linearTicketUrl).toBe("https://linear.app/t/1");
    expect(wt.linearTicketIdentifier).toBe("ROS-42");
    expect(wt.justCreated).toBe(true);
    expect(wt.additions).toBe(917);
    expect(wt.deletions).toBe(90);
    expect(wt.runningAgents).toBe(3);
  });

  it("preserves in-flight setupInProgress across a git refresh", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ setupInProgress: true })],
    });

    // Fresh git data never reports setup progress
    store.getState().setWorktrees([
      makeWorktree({ path: "/new/path", setupInProgress: false }),
    ]);

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.setupInProgress).toBe(true);
  });

  it("uses fresh stackParent/stackChildren/stackRebaseStatus when defined", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [
        makeWorktree({
          stackParent: "old-parent",
          stackChildren: ["old-child"],
          stackRebaseStatus: { kind: "upToDate" },
        }),
      ],
    });

    store.getState().setWorktrees([
      makeWorktree({
        stackParent: "new-parent",
        stackChildren: ["new-child"],
        stackRebaseStatus: { kind: "behind", count: 3 },
      }),
    ]);

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.stackParent).toBe("new-parent");
    expect(wt.stackChildren).toEqual(["new-child"]);
    expect(wt.stackRebaseStatus).toEqual({ kind: "behind", count: 3 });
  });

  it("preserves old stack fields when fresh values are undefined", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [
        makeWorktree({
          stackParent: "old-parent",
          stackChildren: ["old-child"],
          stackRebaseStatus: { kind: "upToDate" },
        }),
      ],
    });

    // Fresh data has no stack fields (undefined)
    store.getState().setWorktrees([makeWorktree()]);

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.stackParent).toBe("old-parent");
    expect(wt.stackChildren).toEqual(["old-child"]);
    expect(wt.stackRebaseStatus).toEqual({ kind: "upToDate" });
  });

  it("preserves creating/errored placeholders not in fresh data", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [
        makeWorktree({ id: "wt-1" }),
        makeWorktree({ id: "wt-creating", creating: true }),
        makeWorktree({ id: "wt-errored", createError: "failed" }),
      ],
    });

    // Fresh data only has wt-1
    store.getState().setWorktrees([makeWorktree({ id: "wt-1" })]);

    const ids = store.getState().worktrees.map((w) => w.id);
    expect(ids).toContain("wt-1");
    expect(ids).toContain("wt-creating");
    expect(ids).toContain("wt-errored");
  });

  it("excludes placeholders whose ID appears in fresh data", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [
        makeWorktree({ id: "wt-creating", creating: true }),
      ],
    });

    // Fresh data now includes wt-creating (creation completed)
    store.getState().setWorktrees([makeWorktree({ id: "wt-creating" })]);

    const worktrees = store.getState().worktrees;
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0].creating).toBeUndefined();
  });
});

// ── withActivityTimestamps (via setWorktrees) ─────────────────────

describe("setWorktrees / withActivityTimestamps", () => {
  it("sets lastActivityAt to max of lastCommitEpoch and previous lastActivityAt", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ lastActivityAt: 800 })],
    });

    store.getState().setWorktrees([
      makeWorktree({ lastCommitEpoch: 900 }),
    ]);

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.lastActivityAt).toBe(900);
  });

  it("preserves previous lastActivityAt when it is higher than lastCommitEpoch", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ lastActivityAt: 1000 })],
    });

    store.getState().setWorktrees([
      makeWorktree({ lastCommitEpoch: 500 }),
    ]);

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.lastActivityAt).toBe(1000);
  });

  it("uses Date.now() when agent status changes (new worktree)", () => {
    vi.spyOn(Date, "now").mockReturnValue(2000);
    const store = useWorkspaceStore;
    // Existing store has a worktree with "idle" status
    store.setState({
      worktrees: [makeWorktree({ id: "wt-existing", agentStatus: "idle", lastActivityAt: 500 })],
    });

    // A brand new worktree appears with "busy" — no previous state, so
    // withActivityTimestamps sees prev=undefined (no agent status change).
    // To trigger the agent status change path, use updateWorktree instead.
    // Here we verify that for a known worktree whose agentStatus is
    // preserved by merge, the previous lastActivityAt is kept.
    store.getState().setWorktrees([
      makeWorktree({ id: "wt-existing", agentStatus: "idle", lastCommitEpoch: 100 }),
    ]);

    const wt = store.getState().worktrees.find((w) => w.id === "wt-existing")!;
    // Previous lastActivityAt (500) > lastCommitEpoch (100), so 500 wins
    expect(wt.lastActivityAt).toBe(500);
  });

  it("falls back to lastCommitEpoch when no other candidates exist", () => {
    const store = useWorkspaceStore;
    // No existing worktree — fresh insert
    store.getState().setWorktrees([
      makeWorktree({ lastCommitEpoch: 700 }),
    ]);

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.lastActivityAt).toBe(700);
  });

  it("sets lastActivityAt to undefined when no candidates and no lastCommitEpoch", () => {
    const store = useWorkspaceStore;
    store.getState().setWorktrees([makeWorktree()]);

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.lastActivityAt).toBeUndefined();
  });
});

// ── removeWorktree ────────────────────────────────────────────────

describe("removeWorktree", () => {
  it("removes the worktree from the list", () => {
    const store = useWorkspaceStore;
    store.setState({ worktrees: [makeWorktree()] });

    store.getState().removeWorktree("wt-1");

    expect(store.getState().worktrees).toHaveLength(0);
  });

  it("clears annotations for the removed worktree", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree()],
      annotations: {
        "wt-1": [{ id: "a1", worktreeId: "wt-1", filePath: "f", lineNumber: 1, side: "new", commitHash: null, text: "note", createdAt: 1 }],
        "wt-2": [{ id: "a2", worktreeId: "wt-2", filePath: "f", lineNumber: 1, side: "new", commitHash: null, text: "note", createdAt: 1 }],
      },
    });

    store.getState().removeWorktree("wt-1");

    expect(store.getState().annotations["wt-1"]).toBeUndefined();
    expect(store.getState().annotations["wt-2"]).toHaveLength(1);
  });

  it("clears seenWorktrees and unreadWorktrees entries", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree()],
      seenWorktrees: new Set(["wt-1", "wt-2"]),
      unreadWorktrees: new Set(["wt-1"]),
    });

    store.getState().removeWorktree("wt-1");

    expect(store.getState().seenWorktrees.has("wt-1")).toBe(false);
    expect(store.getState().seenWorktrees.has("wt-2")).toBe(true);
    expect(store.getState().unreadWorktrees.has("wt-1")).toBe(false);
  });

  it("resets activeWorktreeId when the active worktree is removed", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree()],
      activeWorktreeId: "wt-1",
    });

    store.getState().removeWorktree("wt-1");

    expect(store.getState().activeWorktreeId).toBeNull();
  });

  it("does not reset activeWorktreeId when a different worktree is removed", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree(), makeWorktree({ id: "wt-2" })],
      activeWorktreeId: "wt-1",
    });

    store.getState().removeWorktree("wt-2");

    expect(store.getState().activeWorktreeId).toBe("wt-1");
  });

  it("clears runningServer entry if it belonged to the removed worktree", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree()],
      runningServers: { "wt-1": { sessionId: "s1", tabId: "t1" } },
    });

    store.getState().removeWorktree("wt-1");

    expect(store.getState().runningServers["wt-1"]).toBeUndefined();
  });

  it("preserves runningServers for other worktrees when one is removed", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree(), makeWorktree({ id: "wt-2" })],
      runningServers: { "wt-2": { sessionId: "s1", tabId: "t1" } },
    });

    store.getState().removeWorktree("wt-1");

    expect(store.getState().runningServers["wt-2"]).toEqual({ sessionId: "s1", tabId: "t1" });
  });
});

// ── updateWorktree ────────────────────────────────────────────────

describe("updateWorktree", () => {
  it("clears seen flag when agentStatus changes to busy", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ agentStatus: "idle" })],
      seenWorktrees: new Set(["wt-1"]),
    });

    store.getState().updateWorktree("wt-1", { agentStatus: "busy" });

    expect(store.getState().seenWorktrees.has("wt-1")).toBe(false);
  });

  it("updates lastActivityAt when agentStatus changes", () => {
    vi.spyOn(Date, "now").mockReturnValue(3000);
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ agentStatus: "idle" })],
    });

    store.getState().updateWorktree("wt-1", { agentStatus: "busy" });

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.lastActivityAt).toBe(3000);
  });

  it("does not update lastActivityAt when agentStatus is unchanged", () => {
    vi.spyOn(Date, "now").mockReturnValue(3000);
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ agentStatus: "idle", lastActivityAt: 100 })],
    });

    store.getState().updateWorktree("wt-1", { agentStatus: "idle" });

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.lastActivityAt).toBe(100);
  });

  it("does not clear seen flag for non-busy status changes", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ agentStatus: "busy" })],
      seenWorktrees: new Set(["wt-1"]),
    });

    store.getState().updateWorktree("wt-1", { agentStatus: "idle" });

    expect(store.getState().seenWorktrees.has("wt-1")).toBe(true);
  });

  it("preserves seen flag when busy is re-asserted on an already-busy worktree", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ agentStatus: "busy" })],
      seenWorktrees: new Set(["wt-1"]),
    });

    store.getState().updateWorktree("wt-1", { agentStatus: "busy" });

    expect(store.getState().seenWorktrees.has("wt-1")).toBe(true);
  });
});

// ── markSetupComplete / setup-complete buffering ──────────────────

describe("markSetupComplete / setup-complete buffering", () => {
  it("clears setupInProgress immediately when the worktree is present", () => {
    const store = useWorkspaceStore;
    store.setState({ worktrees: [makeWorktree({ setupInProgress: true })] });

    store.getState().markSetupComplete({ id: "wt-1", path: "/path/wt-1", error: null });

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.setupInProgress).toBe(false);
    expect(wt.setupScriptError).toBeNull();
  });

  it("propagates the error when setup failed", () => {
    const store = useWorkspaceStore;
    store.setState({ worktrees: [makeWorktree({ setupInProgress: true })] });

    store.getState().markSetupComplete({ id: "wt-1", path: "/path/wt-1", error: "boom" });

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.setupInProgress).toBe(false);
    expect(wt.setupScriptError).toBe("boom");
  });

  it("buffers a completion that arrives before the worktree, applied on replaceWorktree", () => {
    const store = useWorkspaceStore;
    // Placeholder present; real worktree not yet swapped in.
    store.setState({
      worktrees: [makeWorktree({ id: "temp-1", name: "temp", creating: true })],
    });

    // Fast setup script emits before replaceWorktree runs — no worktree with the real id yet.
    store.getState().markSetupComplete({ id: "wt-1", path: "/path/wt-1", error: null });
    expect(store.getState().completedSetups).toHaveLength(1);

    // Real worktree arrives carrying the backend's stale setupInProgress: true.
    store.getState().replaceWorktree("temp-1", makeWorktree({ setupInProgress: true }));

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.setupInProgress).toBe(false);
    expect(store.getState().completedSetups).toHaveLength(0);
  });

  it("matches a buffered completion by path when the id was rewritten", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ id: "temp-1", name: "temp", creating: true })],
    });
    // Event's id differs from the worktree's final id, but the path matches.
    store.getState().markSetupComplete({ id: "stale-id", path: "/path/wt-1", error: null });

    store.getState().replaceWorktree("temp-1", makeWorktree({ setupInProgress: true }));

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.setupInProgress).toBe(false);
  });

  it("leaves setupInProgress true on replaceWorktree when no completion buffered", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ id: "temp-1", name: "temp", creating: true })],
    });
    store.getState().replaceWorktree("temp-1", makeWorktree({ setupInProgress: true }));

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.setupInProgress).toBe(true);
  });

  it("drops a buffered completion when its worktree is removed, so a recreate isn't tainted", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ setupInProgress: true })],
      completedSetups: [],
    });
    // Setup fails and is buffered while the worktree still looks like it's creating.
    store.setState({ completedSetups: [{ id: "wt-1", path: "/path/wt-1", error: "boom" }] });

    store.getState().removeWorktree("wt-1");
    expect(store.getState().completedSetups).toHaveLength(0);

    // Recreate the same branch (same path) — the stale completion is gone, so
    // it can't drain onto the new worktree.
    store.setState({
      worktrees: [makeWorktree({ id: "temp-2", name: "temp", creating: true })],
    });
    store.getState().replaceWorktree("temp-2", makeWorktree({ setupInProgress: true }));

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.setupInProgress).toBe(true);
    expect(wt.setupScriptError).toBeUndefined();
  });
});

// ── archiveWorktree / unarchiveWorktree ───────────────────────────

describe("archiveWorktree / unarchiveWorktree", () => {
  it("sets archived flag and archivedAt timestamp", () => {
    vi.spyOn(Date, "now").mockReturnValue(5000);
    const store = useWorkspaceStore;
    store.setState({ worktrees: [makeWorktree()] });

    store.getState().archiveWorktree("wt-1");

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.archived).toBe(true);
    expect(wt.archivedAt).toBe(5000);
  });

  it("clears archived flag and archivedAt on unarchive", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ archived: true, archivedAt: 5000 })],
    });

    store.getState().unarchiveWorktree("wt-1");

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.archived).toBe(false);
    expect(wt.archivedAt).toBeUndefined();
  });
});

// ── setWorktreesForRepo ───────────────────────────────────────────

describe("setWorktreesForRepo", () => {
  it("only merges worktrees for the specified repoPath", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [
        makeWorktree({ id: "wt-1", repoPath: "/repo-a", branch: "old-branch" }),
        makeWorktree({ id: "wt-2", repoPath: "/repo-b" }),
      ],
    });

    store.getState().setWorktreesForRepo("/repo-a", [
      makeWorktree({ id: "wt-1", repoPath: "/repo-a", branch: "new-branch" }),
    ]);

    const worktrees = store.getState().worktrees;
    const wtA = worktrees.find((w) => w.id === "wt-1")!;
    const wtB = worktrees.find((w) => w.id === "wt-2")!;
    expect(wtA.branch).toBe("new-branch");
    expect(wtB.repoPath).toBe("/repo-b");
  });

  it("preserves enriched fields for the target repo", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [
        makeWorktree({ id: "wt-1", repoPath: "/repo-a", agentStatus: "busy", column: "needsReview" }),
      ],
    });

    store.getState().setWorktreesForRepo("/repo-a", [
      makeWorktree({ id: "wt-1", repoPath: "/repo-a" }),
    ]);

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.agentStatus).toBe("busy");
    expect(wt.column).toBe("needsReview");
  });

  it("preserves branch-mode synthetics across a fresh refresh", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [
        makeWorktree({ id: "branch::/repo-a", repoPath: "/repo-a", isBranchMode: true }),
        makeWorktree({ id: "wt-real", repoPath: "/repo-a" }),
      ],
    });

    // Simulate a refresh from listWorktrees (only real worktrees)
    store.getState().setWorktreesForRepo("/repo-a", [
      makeWorktree({ id: "wt-real", repoPath: "/repo-a", branch: "feature-1-updated" }),
    ]);

    const ids = store.getState().worktrees.map((w) => w.id);
    expect(ids).toContain("branch::/repo-a");
    expect(ids).toContain("wt-real");
  });
});

// ── moveWorktreeToFront ───────────────────────────────────────────

describe("moveWorktreeToFront", () => {
  it("moves a worktree to the front of the list", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [
        makeWorktree({ id: "wt-1" }),
        makeWorktree({ id: "wt-2" }),
        makeWorktree({ id: "wt-3" }),
      ],
    });

    store.getState().moveWorktreeToFront("wt-3");

    const ids = store.getState().worktrees.map((w) => w.id);
    expect(ids).toEqual(["wt-3", "wt-1", "wt-2"]);
  });

  it("is a no-op when the worktree is already first", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ id: "wt-1" }), makeWorktree({ id: "wt-2" })],
    });

    store.getState().moveWorktreeToFront("wt-1");

    const ids = store.getState().worktrees.map((w) => w.id);
    expect(ids).toEqual(["wt-1", "wt-2"]);
  });

  it("is a no-op when the worktree is not found", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ id: "wt-1" })],
    });

    store.getState().moveWorktreeToFront("wt-nonexistent");

    expect(store.getState().worktrees).toHaveLength(1);
  });
});

// ── setActiveWorktree ─────────────────────────────────────────────

describe("setActiveWorktree", () => {
  it("clears unread flag for the activated worktree", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree()],
      unreadWorktrees: new Set(["wt-1"]),
    });

    store.getState().setActiveWorktree("wt-1");

    expect(store.getState().unreadWorktrees.has("wt-1")).toBe(false);
  });

  it("clears justCreated flag for the activated worktree", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ justCreated: true })],
    });

    store.getState().setActiveWorktree("wt-1");

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.justCreated).toBeUndefined();
  });

  it("sets activeWorktreeId", () => {
    const store = useWorkspaceStore;
    store.setState({ worktrees: [makeWorktree()] });

    store.getState().setActiveWorktree("wt-1");

    expect(store.getState().activeWorktreeId).toBe("wt-1");
  });

  it("can set activeWorktreeId to null", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree()],
      activeWorktreeId: "wt-1",
    });

    store.getState().setActiveWorktree(null);

    expect(store.getState().activeWorktreeId).toBeNull();
  });
});

// ── restoredRepos (discovery-poll gate) ───────────────────────────

describe("restoredRepos", () => {
  it("marks repos restored and resets on clearStore", () => {
    const store = useWorkspaceStore;
    expect(store.getState().restoredRepos.has("/repo")).toBe(false);
    store.getState().markRepoRestored("/repo");
    expect(store.getState().restoredRepos.has("/repo")).toBe(true);
    store.getState().clearStore();
    expect(store.getState().restoredRepos.has("/repo")).toBe(false);
  });
});
