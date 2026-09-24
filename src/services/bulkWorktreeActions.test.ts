import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Worktree } from "../types";

vi.mock("../api", () => ({
  setWorktreeColumns: vi.fn().mockResolvedValue(undefined),
  runArchiveScript: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./portReclaim", () => ({
  stopServerAndReleasePort: vi.fn().mockResolvedValue(undefined),
}));

import { groupByRepo, bulkMoveToColumn, bulkArchive } from "./bulkWorktreeActions";
import { setWorktreeColumns, runArchiveScript } from "../api";
import { stopServerAndReleasePort } from "./portReclaim";
import { usePrStore } from "../stores/prStore";

function wt(id: string, repoPath: string): Worktree {
  return {
    id, name: id, path: `/p/${id}`, branch: id, repoPath,
    prStatus: null, agentStatus: "notRunning", column: "toDo",
    isBranchMode: false, additions: null, deletions: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  usePrStore.getState().clearStore();
});

describe("groupByRepo", () => {
  it("buckets worktrees by repoPath", () => {
    const grouped = groupByRepo([wt("a", "/r1"), wt("b", "/r2"), wt("c", "/r1")]);
    expect([...grouped.keys()].sort()).toEqual(["/r1", "/r2"]);
    expect(grouped.get("/r1")!.map((w) => w.id)).toEqual(["a", "c"]);
  });
});

describe("bulkMoveToColumn", () => {
  it("issues exactly one backend call per repo", async () => {
    await bulkMoveToColumn([wt("a", "/r1"), wt("b", "/r1"), wt("c", "/r2")], "done");
    expect(setWorktreeColumns).toHaveBeenCalledTimes(2);
    expect(setWorktreeColumns).toHaveBeenCalledWith("/r1", { a: "done", b: "done" });
    expect(setWorktreeColumns).toHaveBeenCalledWith("/r2", { c: "done" });
  });

  it("releases ports only when the target column is done", async () => {
    await bulkMoveToColumn([wt("a", "/r1")], "blocked");
    expect(stopServerAndReleasePort).not.toHaveBeenCalled();

    await bulkMoveToColumn([wt("a", "/r1")], "done");
    expect(stopServerAndReleasePort).toHaveBeenCalledTimes(1);
  });

  it("reports a failing repo without aborting the others", async () => {
    vi.mocked(setWorktreeColumns)
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);

    const result = await bulkMoveToColumn([wt("a", "/r1"), wt("c", "/r2")], "done");
    expect(result.failedRepos).toEqual(["/r1"]);
    expect(result.moved).toBe(1);
    expect(setWorktreeColumns).toHaveBeenCalledTimes(2);
  });

  it("rolls back the optimistic store write for a repo that failed to persist", async () => {
    vi.mocked(setWorktreeColumns)
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);

    // Both start at "toDo" (the wt() helper's default column).
    await bulkMoveToColumn([wt("a", "/r1"), wt("c", "/r2")], "done");

    // /r1 failed to persist — its row must snap back to the prior column,
    // not keep showing the optimistic "done" the backend never agreed to.
    expect(usePrStore.getState().columnOverrides["a"].column).toBe("toDo");
    // /r2 succeeded — its row stays moved.
    expect(usePrStore.getState().columnOverrides["c"].column).toBe("done");
  });

  it("reclaims ports only for the repo that actually persisted, not a rolled-back one", async () => {
    vi.mocked(setWorktreeColumns)
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);

    await bulkMoveToColumn([wt("a", "/r1"), wt("c", "/r2")], "done");

    // /r1 failed and was rolled back — its server/port must be left alone.
    expect(stopServerAndReleasePort).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: "a" }),
      "bulk-move",
    );
    // /r2 persisted — its port is reclaimed.
    expect(stopServerAndReleasePort).toHaveBeenCalledTimes(1);
    expect(stopServerAndReleasePort).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c" }),
      "bulk-move",
    );
  });
});

describe("bulkArchive", () => {
  it("archives every worktree even when one archive script fails", async () => {
    vi.mocked(runArchiveScript).mockRejectedValueOnce(new Error("script exploded"));

    const result = await bulkArchive([wt("a", "/r1"), wt("b", "/r1")]);

    expect(result.archived).toBe(2);
    expect(result.scriptFailures).toEqual(["a"]);
    expect(stopServerAndReleasePort).toHaveBeenCalledTimes(2);
  });

  it("reports no failures on the happy path", async () => {
    const result = await bulkArchive([wt("a", "/r1")]);
    expect(result.scriptFailures).toEqual([]);
    expect(result.archived).toBe(1);
  });
});
