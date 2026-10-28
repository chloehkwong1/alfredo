import { describe, it, expect, beforeEach, vi } from "vitest";
import { autostartIfMarked, computeDiscovery, computeRemovals } from "./useWorktreeDiscovery";
import { takeAutostartMarker } from "../api";
import { ensureAgentSession } from "../services/agentMessenger";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useTabStore } from "../stores/tabStore";
import { useLayoutStore } from "../stores/layoutStore";
import type { Worktree } from "../types";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  takeAutostartMarker: vi.fn(),
}));
vi.mock("../services/agentMessenger", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/agentMessenger")>()),
  ensureAgentSession: vi.fn(),
}));

describe("computeDiscovery", () => {
  it("baseline tick (no known set) adopts nothing and records all ids", () => {
    const d = computeDiscovery({
      known: undefined,
      freshWorktrees: [{ id: "a", path: "/a" }, { id: "b", path: "/b" }],
      knownPaths: new Set(),
    });
    expect(d.adoptIds).toEqual([]);
    expect([...d.nextKnown].sort()).toEqual(["a", "b"]);
  });

  it("adopts only ids missing from the baseline", () => {
    const d = computeDiscovery({
      known: new Set(["a"]),
      freshWorktrees: [{ id: "a", path: "/a" }, { id: "b", path: "/b" }],
      knownPaths: new Set(["/a"]),
    });
    expect(d.adoptIds).toEqual(["b"]);
    expect([...d.nextKnown].sort()).toEqual(["a", "b"]);
  });

  it("an empty baseline set still adopts (distinct from undefined)", () => {
    const d = computeDiscovery({
      known: new Set(),
      freshWorktrees: [{ id: "a", path: "/a" }],
      knownPaths: new Set(),
    });
    expect(d.adoptIds).toEqual(["a"]);
  });

  it("drops vanished ids from the next baseline so a recreate re-adopts", () => {
    const gone = computeDiscovery({
      known: new Set(["a", "b"]),
      freshWorktrees: [{ id: "a", path: "/a" }],
      knownPaths: new Set(["/a"]),
    });
    expect(gone.adoptIds).toEqual([]);
    expect([...gone.nextKnown]).toEqual(["a"]);
    const back = computeDiscovery({
      known: gone.nextKnown,
      freshWorktrees: [{ id: "a", path: "/a" }, { id: "b", path: "/b" }],
      // "b" was dropped from the store when it vanished, so its path is no
      // longer in knownPaths either — the recreate reads as external.
      knownPaths: new Set(["/a"]),
    });
    expect(back.adoptIds).toEqual(["b"]);
  });

  it("branch switch: new id at a known path is not adopted, but the id baseline still updates", () => {
    // `git checkout -b` inside an existing worktree changes its id
    // ({repo}::{branch}) while the path on disk stays the same.
    const d = computeDiscovery({
      known: new Set(["repo::main"]),
      freshWorktrees: [{ id: "repo::feature", path: "/repo-wt" }],
      knownPaths: new Set(["/repo-wt"]),
    });
    expect(d.adoptIds).toEqual([]);
    expect([...d.nextKnown]).toEqual(["repo::feature"]);
  });

  it("external `git worktree add` at a brand-new path is adopted", () => {
    const d = computeDiscovery({
      known: new Set(["repo::main"]),
      freshWorktrees: [
        { id: "repo::main", path: "/repo-wt" },
        { id: "repo::new-branch", path: "/repo-wt-new" },
      ],
      knownPaths: new Set(["/repo-wt"]),
    });
    expect(d.adoptIds).toEqual(["repo::new-branch"]);
  });

  it("delete-then-recreate at the same path is adopted once the path drops from knownPaths", () => {
    // Tick 1: the worktree is deleted — dropped from both the id baseline
    // (nextKnown) and, by the time tick 2 runs, from the store (and so from
    // knownPaths too).
    const afterDelete = computeDiscovery({
      known: new Set(["repo::main"]),
      freshWorktrees: [],
      knownPaths: new Set(["/repo-wt"]),
    });
    expect([...afterDelete.nextKnown]).toEqual([]);

    // Tick 2: recreated at the same path with the same id. Neither the id
    // baseline nor knownPaths (the store no longer has this path) still
    // contains it, so it reads as external and is adopted.
    const afterRecreate = computeDiscovery({
      known: afterDelete.nextKnown,
      freshWorktrees: [{ id: "repo::main", path: "/repo-wt" }],
      knownPaths: new Set(),
    });
    expect(afterRecreate.adoptIds).toEqual(["repo::main"]);
  });
});

describe("computeRemovals", () => {
  const freshIds = new Set(["repo::kept"]);
  const freshPaths = new Set(["/wt/kept"]);

  it("removes store worktrees missing from the fresh listing", () => {
    const removals = computeRemovals(
      [
        { id: "repo::kept", path: "/wt/kept" },
        { id: "repo::gone", path: "/wt/gone" },
      ],
      freshIds,
      freshPaths,
    );
    expect(removals).toEqual(["repo::gone"]);
  });

  it("never removes creating or createError placeholders (store-only, not on disk)", () => {
    const removals = computeRemovals(
      [
        { id: "repo::spinning", path: "/wt/spinning", creating: true },
        { id: "repo::failed", path: "/wt/failed", createError: "boom" },
      ],
      freshIds,
      freshPaths,
    );
    expect(removals).toEqual([]);
  });

  it("keeps a worktree whose id changed while its path stayed put", () => {
    // A `git rebase --onto X Y HEAD` that runs to completion leaves the
    // worktree on a non-rebase detached HEAD, so git_manager falls back to the
    // directory name for the branch token and the id flips from
    // `repo::chloe/feat` to `repo::chloe-feat`. The directory is still on disk;
    // reading that as an external delete force-removes live work.
    const removals = computeRemovals(
      [{ id: "repo::chloe/feat", path: "/wt/chloe-feat" }],
      new Set(["repo::chloe-feat"]),
      new Set(["/wt/chloe-feat"]),
    );
    expect(removals).toEqual([]);
  });
});

describe("autostartIfMarked", () => {
  const id = "/repo::autostart-test";
  const path = "/wt/autostart-test";

  function seedAdopted(setupInProgress: boolean) {
    const wt: Worktree = {
      id,
      name: "autostart-test",
      path,
      branch: "test/autostart",
      repoPath: "/repo",
      prStatus: null,
      agentStatus: "notRunning",
      column: "inProgress",
      isBranchMode: false,
      additions: null,
      deletions: null,
      setupInProgress,
    };
    useWorkspaceStore.setState({ worktrees: [wt], activeWorktreeId: null });
  }

  beforeEach(() => {
    vi.mocked(takeAutostartMarker).mockReset();
    vi.mocked(ensureAgentSession).mockReset();
    useTabStore.setState({ tabs: {} });
    useLayoutStore.setState({ panes: {} });
  });

  it("consumes the marker and starts the agent only after setup finishes", async () => {
    seedAdopted(true);
    vi.mocked(takeAutostartMarker).mockResolvedValue(true);

    const done = autostartIfMarked("/repo", id, path);
    await new Promise((r) => setTimeout(r, 0));
    expect(takeAutostartMarker).toHaveBeenCalledWith(path);
    expect(ensureAgentSession).not.toHaveBeenCalled();

    useWorkspaceStore.getState().updateWorktree(id, { setupInProgress: false });
    await done;
    expect(ensureAgentSession).toHaveBeenCalledWith(id, "/repo");
  });

  it.each([
    ["the agent tab is mounted", "agent", false],
    ["only a shell tab is mounted", "shell", true],
  ])("in the active worktree when %s", async (_label, activeTabId, spawns) => {
    seedAdopted(false);
    useWorkspaceStore.setState({ activeWorktreeId: id });
    useTabStore.setState({
      tabs: { [id]: [{ id: "agent", type: "claude", label: "Claude" }, { id: "shell", type: "shell", label: "Shell" }] },
    });
    useLayoutStore.setState({
      panes: { [id]: { p1: { tabIds: ["agent", "shell"], activeTabId, previewTabId: null } } },
    });
    vi.mocked(takeAutostartMarker).mockResolvedValue(true);

    await autostartIfMarked("/repo", id, path);
    expect(vi.mocked(ensureAgentSession).mock.calls.length > 0).toBe(spawns);
  });

  it("skips a worktree whose agent tab is not Claude", async () => {
    seedAdopted(false);
    useTabStore.setState({ tabs: { [id]: [{ id: "agent", type: "codex", label: "Codex" }] } });
    vi.mocked(takeAutostartMarker).mockResolvedValue(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await autostartIfMarked("/repo", id, path);
    warn.mockRestore();
    expect(ensureAgentSession).not.toHaveBeenCalled();
  });

  it("never starts an agent in an unmarked worktree", async () => {
    seedAdopted(false);
    vi.mocked(takeAutostartMarker).mockResolvedValue(false);

    await autostartIfMarked("/repo", id, path);
    expect(ensureAgentSession).not.toHaveBeenCalled();
  });
});
