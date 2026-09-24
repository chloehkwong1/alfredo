import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Worktree } from "../types";

vi.mock("../api", () => ({
  setWorktreeColumns: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./portReclaim", () => ({
  stopServerAndReleasePort: vi.fn().mockResolvedValue(undefined),
}));

import { groupByRepo, bulkMoveToColumn } from "./bulkWorktreeActions";
import { setWorktreeColumns } from "../api";
import { stopServerAndReleasePort } from "./portReclaim";

function wt(id: string, repoPath: string): Worktree {
  return {
    id, name: id, path: `/p/${id}`, branch: id, repoPath,
    prStatus: null, agentStatus: "notRunning", column: "toDo",
    isBranchMode: false, additions: null, deletions: null,
  };
}

beforeEach(() => vi.clearAllMocks());

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
});
