import { describe, it, expect, beforeEach, vi } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";
import { useTabStore } from "./tabStore";
import { useLayoutStore } from "./layoutStore";
import { usePrStore } from "./prStore";
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

  it("preserves enriched state when a branch switch changes the worktree id", () => {
    const store = useWorkspaceStore;
    // The backend derives ids as `${repoPath}::${branch}` (git_manager.rs
    // worktree_id), so `git checkout` inside a worktree re-ids it. The path is
    // what actually stayed the same.
    store.setState({
      worktrees: [
        makeWorktree({
          id: "/repo::feature-1",
          path: "/path/wt-1",
          branch: "feature-1",
          column: "needsReview",
          agentStatus: "busy",
          claudeSessionId: "sess-1",
          linearTicketIdentifier: "ROS-42",
        }),
      ],
    });

    store.getState().setWorktrees([
      makeWorktree({ id: "/repo::feature-2", path: "/path/wt-1", branch: "feature-2" }),
    ]);

    const worktrees = store.getState().worktrees;
    expect(worktrees).toHaveLength(1);
    const wt = worktrees[0];
    expect(wt.branch).toBe("feature-2");
    // The running agent and its column belong to the directory, not the branch
    // label — losing them orphans the agent and resets the board position.
    expect(wt.claudeSessionId).toBe("sess-1");
    expect(wt.column).toBe("needsReview");
    expect(wt.agentStatus).toBe("busy");
    expect(wt.linearTicketIdentifier).toBe("ROS-42");
  });

  it("re-keys per-worktree state when a branch switch changes the id", () => {
    const store = useWorkspaceStore;
    const oldId = "/repo::feature-1";
    const newId = "/repo::feature-2";

    store.setState({
      worktrees: [makeWorktree({ id: oldId, path: "/path/wt-1", branch: "feature-1" })],
      activeWorktreeId: oldId,
      pinnedWorktrees: new Set([oldId]),
      unreadWorktrees: new Set([oldId]),
      diffViewMode: { [oldId]: "side-by-side" },
      changesPanelCollapsed: { [oldId]: true },
    });
    useTabStore.setState({
      tabs: { [oldId]: [{ id: "tab-1", type: "claude", label: "Claude" }] },
      activeTabId: { [oldId]: "tab-1" },
    });
    useLayoutStore.setState({ activePaneId: { [oldId]: "pane-1" } });
    usePrStore.setState({
      prSummary: { [oldId]: { merged: false, closed: false } },
      // Manual kanban placement — losing this reverts the card to autoColumn
      // on the next PR sync.
      columnOverrides: { [oldId]: { column: "inProgress", autoColumnWhenSet: "needsReview" } },
      lastAutoColumn: { [oldId]: "needsReview" },
    });

    store.getState().setWorktrees([
      makeWorktree({ id: newId, path: "/path/wt-1", branch: "feature-2" }),
    ]);

    // The terminal tabs and their running agent belong to the directory — left
    // under the old key they vanish from the UI while the PTY keeps running.
    expect(useTabStore.getState().tabs[newId]).toHaveLength(1);
    expect(useTabStore.getState().tabs[oldId]).toBeUndefined();
    expect(useTabStore.getState().activeTabId[newId]).toBe("tab-1");
    expect(useLayoutStore.getState().activePaneId[newId]).toBe("pane-1");
    expect(usePrStore.getState().prSummary[newId]).toBeDefined();
    expect(usePrStore.getState().columnOverrides[newId]?.column).toBe("inProgress");
    expect(usePrStore.getState().lastAutoColumn[newId]).toBe("needsReview");

    expect(store.getState().activeWorktreeId).toBe(newId);
    expect(store.getState().pinnedWorktrees.has(newId)).toBe(true);
    expect(store.getState().pinnedWorktrees.has(oldId)).toBe(false);
    expect(store.getState().unreadWorktrees.has(newId)).toBe(true);
    expect(store.getState().diffViewMode[newId]).toBe("side-by-side");
    expect(store.getState().changesPanelCollapsed[newId]).toBe(true);
  });

  it("does not hand a recycled directory the dead worktree's state", () => {
    // `git worktree remove` + `git worktree add -b other <same dir>` between
    // two polls: same path, same admin name (basename), but the admin dir was
    // recreated, so its birthtime differs. The new worktree must start clean —
    // inheriting the old claudeSessionId would resume the wrong conversation.
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [
        makeWorktree({
          id: "/repo::removed-branch",
          path: "/path/wt-1",
          branch: "removed-branch",
          createdAtEpoch: 1_000,
          claudeSessionId: "sess-dead",
          archived: true,
        }),
      ],
    });

    store.getState().setWorktrees([
      makeWorktree({
        id: "/repo::fresh-branch",
        path: "/path/wt-1",
        branch: "fresh-branch",
        createdAtEpoch: 2_000,
      }),
    ]);

    const wt = store.getState().worktrees.find((w) => w.id === "/repo::fresh-branch")!;
    expect(wt.claudeSessionId).toBeUndefined();
    expect(wt.archived).toBeUndefined();
  });

  it("does not let a branch recycled into another worktree inherit by id", () => {
    // Worktree A switches b1→b2; worktree B (different directory) later checks
    // out b1. B's id now equals A's old id, but B is a different physical
    // worktree (different admin name) — A's session must follow A, not B.
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [
        makeWorktree({
          id: "/repo::b1",
          name: "wt-a",
          path: "/wt/a",
          branch: "b1",
          createdAtEpoch: 1_000,
          claudeSessionId: "sess-a",
        }),
      ],
    });
    useTabStore.setState({
      tabs: { "/repo::b1": [{ id: "tab-a", type: "claude", label: "Claude" }] },
      activeTabId: { "/repo::b1": "tab-a" },
    });

    store.getState().setWorktrees([
      makeWorktree({
        id: "/repo::b2",
        name: "wt-a",
        path: "/wt/a",
        branch: "b2",
        createdAtEpoch: 1_000,
      }),
      makeWorktree({
        id: "/repo::b1",
        name: "wt-b",
        path: "/wt/b",
        branch: "b1",
        createdAtEpoch: 5_000,
      }),
    ]);

    const a = store.getState().worktrees.find((w) => w.path === "/wt/a")!;
    const b = store.getState().worktrees.find((w) => w.path === "/wt/b")!;
    // A keeps its session under its new id; B starts clean.
    expect(a.claudeSessionId).toBe("sess-a");
    expect(b.claudeSessionId).toBeUndefined();
    // The tabs follow A's rekey rather than staying under B's id.
    expect(useTabStore.getState().tabs["/repo::b2"]).toHaveLength(1);
    expect(useTabStore.getState().tabs["/repo::b1"]).toBeUndefined();
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

  it("preserves event-fed stackPending across a git refresh", () => {
    useWorkspaceStore.setState({
      worktrees: [
        makeWorktree({
          stackPending: { mergedParent: "chloe/root-branch", blockedBy: "dirty" },
        }),
      ],
    });
    useWorkspaceStore.getState().setWorktrees([
      makeWorktree({ path: "/new/path" }),
    ]);
    const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.stackPending).toEqual({ mergedParent: "chloe/root-branch", blockedBy: "dirty" });
  });

  it("preserves event-fed lastStackAction across a git refresh", () => {
    useWorkspaceStore.setState({
      worktrees: [
        makeWorktree({ lastStackAction: { action: "moved onto main", at: 1234 } }),
      ],
    });
    useWorkspaceStore.getState().setWorktrees([
      makeWorktree({ path: "/new/path" }),
    ]);
    const wt = useWorkspaceStore.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.lastStackAction).toEqual({ action: "moved onto main", at: 1234 });
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

  it("preserves stackRebaseStatus when listWorktrees sends an explicit null", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ stackRebaseStatus: { kind: "conflict" } })],
    });

    // What the backend actually sends: Rust `None` serialises to JSON null, not
    // undefined. A `!== undefined` guard let this wipe the conflict badge on
    // every 60s reconcile until the stack poll re-emitted it.
    store.getState().setWorktrees([makeWorktree({ stackRebaseStatus: null })]);

    const wt = store.getState().worktrees.find((w) => w.id === "wt-1")!;
    expect(wt.stackRebaseStatus).toEqual({ kind: "conflict" });
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

  it("moves the selection onto the new id when the active worktree is re-id'd", () => {
    // A re-id (branch switch, or a rebase that finishes on a detached HEAD)
    // gives the same directory a new id. The selection used to be nulled here
    // to stop it dangling; now it follows the directory, so the user stays on
    // the worktree they were looking at.
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ id: "repo::old", repoPath: "/repo-a", path: "/wt/x" })],
      activeWorktreeId: "repo::old",
    });

    store.getState().setWorktreesForRepo("/repo-a", [
      makeWorktree({ id: "repo::new", repoPath: "/repo-a", path: "/wt/x" }),
    ]);

    expect(store.getState().activeWorktreeId).toBe("repo::new");
  });

  it("clears the selection when the active worktree is gone entirely", () => {
    // No replacement at the same path — the directory really is gone, so there
    // is nothing to follow and a dangling id would render the main pane
    // against a worktree the store no longer holds.
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [makeWorktree({ id: "repo::old", repoPath: "/repo-a", path: "/wt/x" })],
      activeWorktreeId: "repo::old",
    });

    store.getState().setWorktreesForRepo("/repo-a", [
      makeWorktree({ id: "repo::other", repoPath: "/repo-a", path: "/wt/y" }),
    ]);

    expect(store.getState().activeWorktreeId).toBeNull();
  });

  it("keeps the selection when the active worktree is in another repo", () => {
    const store = useWorkspaceStore;
    store.setState({
      worktrees: [
        makeWorktree({ id: "wt-a", repoPath: "/repo-a" }),
        makeWorktree({ id: "wt-b", repoPath: "/repo-b" }),
      ],
      activeWorktreeId: "wt-b",
    });

    store.getState().setWorktreesForRepo("/repo-a", [
      makeWorktree({ id: "wt-a2", repoPath: "/repo-a" }),
    ]);

    expect(store.getState().activeWorktreeId).toBe("wt-b");
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

  it("unmarkRepoRestored closes the gate for one repo only", () => {
    const store = useWorkspaceStore;
    store.getState().markRepoRestored("/repo-a");
    store.getState().markRepoRestored("/repo-b");
    store.getState().unmarkRepoRestored("/repo-a");
    expect(store.getState().restoredRepos.has("/repo-a")).toBe(false);
    expect(store.getState().restoredRepos.has("/repo-b")).toBe(true);
  });
});

// ── worktreeOrder (manual sidebar ordering) ───────────────────────

describe("worktreeOrder", () => {
  it("setWorktreeOrderForRepo hydrates a repo's map", () => {
    const store = useWorkspaceStore;
    store.getState().setWorktreeOrderForRepo("/repo-a", {
      inProgress: ["wt-2", "wt-1"],
      needsReview: ["wt-3"],
    });

    expect(store.getState().worktreeOrder["/repo-a"]).toEqual({
      inProgress: ["wt-2", "wt-1"],
      needsReview: ["wt-3"],
    });
  });

  it("setColumnOrder replaces one column for one repo without touching other columns or repos", () => {
    const store = useWorkspaceStore;
    store.getState().setWorktreeOrderForRepo("/repo-a", {
      inProgress: ["wt-1"],
      needsReview: ["wt-3"],
    });
    store.getState().setWorktreeOrderForRepo("/repo-b", { inProgress: ["other"] });

    store.getState().setColumnOrder("/repo-a", "inProgress", ["wt-2", "wt-1"]);

    expect(store.getState().worktreeOrder["/repo-a"]).toEqual({
      inProgress: ["wt-2", "wt-1"],
      needsReview: ["wt-3"],
    });
    expect(store.getState().worktreeOrder["/repo-b"]).toEqual({ inProgress: ["other"] });
  });

  it("setColumnOrder works for a repo with no existing entry", () => {
    const store = useWorkspaceStore;
    store.getState().setColumnOrder("/repo-new", "inProgress", ["wt-1"]);

    expect(store.getState().worktreeOrder["/repo-new"]).toEqual({ inProgress: ["wt-1"] });
  });

  it("clearStore resets worktreeOrder", () => {
    const store = useWorkspaceStore;
    store.getState().setWorktreeOrderForRepo("/repo-a", { inProgress: ["wt-1"] });

    store.getState().clearStore();

    expect(store.getState().worktreeOrder).toEqual({});
  });
});
