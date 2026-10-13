import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Worktree } from "../types";

vi.mock("../api", () => ({
  setWorktreeColumns: vi.fn().mockResolvedValue(undefined),
  runArchiveScript: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("./portReclaim", () => ({
  stopServerAndReleasePort: vi.fn().mockResolvedValue(undefined),
}));

import { groupByRepo, bulkMoveToColumn, bulkArchive, undoBulkMove } from "./bulkWorktreeActions";
import { setWorktreeColumns, runArchiveScript } from "../api";
import { stopServerAndReleasePort } from "./portReclaim";
import { usePrStore } from "../stores/prStore";
import { useWorkspaceStore } from "../stores/workspaceStore";

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
  // setManualColumn's unpin-on-entering-done rule reads the row's current
  // column out of the store, so pin assertions need the rows actually seeded.
  useWorkspaceStore.getState().clearStore();
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

    // Both start at "toDo" (the wt() helper's default column) with no override.
    await bulkMoveToColumn([wt("a", "/r1"), wt("c", "/r2")], "done");

    // /r1 failed to persist, so its row must end up exactly as it started —
    // including with no override at all. Rewriting one pointing at "toDo" would
    // pin the row there against every later PR sync.
    expect(usePrStore.getState().columnOverrides["a"]).toBeUndefined();
    // /r2 succeeded — its row stays moved.
    expect(usePrStore.getState().columnOverrides["c"].column).toBe("done");
  });

  it("restores the exact override a rolled-back row already had", async () => {
    // A row the user had previously placed by hand, whose autoColumn has since
    // been recorded as something else.
    usePrStore.setState({
      columnOverrides: { a: { column: "toDo", autoColumnWhenSet: "needsReview" } },
    });
    vi.mocked(setWorktreeColumns).mockRejectedValueOnce(new Error("disk full"));

    await bulkMoveToColumn([wt("a", "/r1")], "done");

    expect(usePrStore.getState().columnOverrides["a"]).toEqual({
      column: "toDo",
      autoColumnWhenSet: "needsReview",
    });
  });

  it("re-pins a rolled-back row that the move-into-done rule unpinned", async () => {
    useWorkspaceStore.setState({
      worktrees: [wt("a", "/r1")],
      pinnedWorktrees: new Set(["a"]),
    });
    vi.mocked(setWorktreeColumns).mockRejectedValueOnce(new Error("disk full"));

    const result = await bulkMoveToColumn([wt("a", "/r1")], "done");

    expect(useWorkspaceStore.getState().pinnedWorktrees.has("a")).toBe(true);
    // Already back where it started, so there is nothing for Undo to restore.
    expect(result.undo.pinnedBefore).toEqual([]);
    expect(result.undo.byPriorColumn.size).toBe(0);
  });

  it("unpins a row entering done from the origin the caller passes, not the store's column", async () => {
    // The drag path previews the drop in the store before calling, so the
    // store already says "done" and setManualColumn's own transition check
    // never fires. The caller-supplied origin is what decides it.
    useWorkspaceStore.setState({
      worktrees: [{ ...wt("a", "/r1"), column: "done" }],
      pinnedWorktrees: new Set(["a"]),
    });

    const result = await bulkMoveToColumn([wt("a", "/r1")], "done");

    expect(useWorkspaceStore.getState().pinnedWorktrees.has("a")).toBe(false);
    // Snapshotted before the unpin, so a rollback or Undo can put it back.
    expect(result.undo.pinnedBefore).toEqual(["a"]);
  });
});

describe("undoBulkMove", () => {
  it("puts the rows back in the columns they came from, batched per column", async () => {
    const rows: Worktree[] = [
      wt("a", "/r1"),
      wt("b", "/r1"),
      { ...wt("c", "/r1"), column: "blocked" },
    ];
    useWorkspaceStore.setState({ worktrees: rows });

    const { undo } = await bulkMoveToColumn(rows, "done");
    vi.mocked(setWorktreeColumns).mockClear();
    await undoBulkMove(undo);

    // Two prior columns ("toDo" for a/b, "blocked" for c) → two calls, not one
    // per row.
    expect(setWorktreeColumns).toHaveBeenCalledTimes(2);
    expect(setWorktreeColumns).toHaveBeenCalledWith("/r1", { a: "toDo", b: "toDo" });
    expect(setWorktreeColumns).toHaveBeenCalledWith("/r1", { c: "blocked" });
  });

  it("leaves a row without an override that never had one", async () => {
    // Replaying setManualColumn re-derives autoColumnWhenSet, so undoing a
    // move that way invents an override the user never made — which then holds
    // the row against every later PR sync. restoreColumnOverride exists for
    // exactly this, and bulkMoveToColumn's own rollback path already uses it.
    const rows = [wt("a", "/r1"), wt("b", "/r1")];
    useWorkspaceStore.setState({ worktrees: rows });
    expect(usePrStore.getState().columnOverrides.a).toBeUndefined();

    const { undo } = await bulkMoveToColumn(rows, "blocked");
    expect(usePrStore.getState().columnOverrides.a).toBeDefined();

    await undoBulkMove(undo);

    expect(usePrStore.getState().columnOverrides.a).toBeUndefined();
    expect(usePrStore.getState().columnOverrides.b).toBeUndefined();
  });

  it("puts back the override a row did have, rather than a re-derived one", async () => {
    const rows = [wt("a", "/r1")];
    useWorkspaceStore.setState({ worktrees: rows });
    usePrStore.getState().setManualColumn("a", "toDo", "openPr");
    const before = usePrStore.getState().columnOverrides.a;

    const { undo } = await bulkMoveToColumn(rows, "blocked");
    await undoBulkMove(undo);

    expect(usePrStore.getState().columnOverrides.a).toEqual(before);
  });

  it("does not stop dev servers when undoing a move out of done", async () => {
    // byPriorColumn is keyed by prior column, so undoing a move *out of* Done
    // targets Done — and a move into Done stops servers and frees ports.
    // Undo must not destroy state the move itself never touched.
    const rows = [{ ...wt("a", "/r1"), column: "done" as const }];
    useWorkspaceStore.setState({ worktrees: rows });

    const { undo } = await bulkMoveToColumn(rows, "inProgress");
    expect(undo.byPriorColumn.has("done")).toBe(true);
    vi.mocked(stopServerAndReleasePort).mockClear();

    await undoBulkMove(undo);

    expect(stopServerAndReleasePort).not.toHaveBeenCalled();
  });

  it("restores the pins that the move into done dropped", async () => {
    useWorkspaceStore.setState({
      worktrees: [wt("a", "/r1"), wt("b", "/r1")],
      pinnedWorktrees: new Set(["a"]),
    });

    const { undo } = await bulkMoveToColumn([wt("a", "/r1"), wt("b", "/r1")], "done");
    // The move unpinned "a" — Undo has to know that, or the column comes back
    // and the pin silently does not.
    expect(undo.pinnedBefore).toEqual(["a"]);
    expect(useWorkspaceStore.getState().pinnedWorktrees.has("a")).toBe(false);

    await undoBulkMove(undo);

    expect(useWorkspaceStore.getState().pinnedWorktrees.has("a")).toBe(true);
    expect(useWorkspaceStore.getState().pinnedWorktrees.has("b")).toBe(false);
  });

  it("keeps the pin on a row undone back into done", async () => {
    // Moving a pinned row *out of* Done drops nothing, but undoing it targets
    // Done, and that replay hits the unpin rule. Undo is an inverse: the row
    // was pinned in Done before, so it is pinned in Done after.
    useWorkspaceStore.setState({
      worktrees: [{ ...wt("a", "/r1"), column: "done" }],
      pinnedWorktrees: new Set(["a"]),
    });

    const { undo } = await bulkMoveToColumn([{ ...wt("a", "/r1"), column: "done" }], "inProgress");
    expect(useWorkspaceStore.getState().pinnedWorktrees.has("a")).toBe(true);

    await undoBulkMove(undo);

    expect(useWorkspaceStore.getState().worktrees[0].column).toBe("done");
    expect(useWorkspaceStore.getState().pinnedWorktrees.has("a")).toBe(true);
  });

  it("rolls a failed undo back to the column the row is actually in", async () => {
    const rows = [wt("a", "/r1")];
    useWorkspaceStore.setState({ worktrees: rows });

    const { undo } = await bulkMoveToColumn(rows, "done");
    expect(useWorkspaceStore.getState().worktrees[0].column).toBe("done");

    vi.mocked(setWorktreeColumns).mockRejectedValueOnce(new Error("disk full"));
    await undoBulkMove(undo);

    // The undo never persisted, so the row must still show the column the
    // backend holds — not the column the undo was trying to reach.
    expect(useWorkspaceStore.getState().worktrees[0].column).toBe("done");
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
    expect(result.failures).toEqual(["a"]);
    expect(stopServerAndReleasePort).toHaveBeenCalledTimes(2);
  });

  it("reports no failures on the happy path", async () => {
    const result = await bulkArchive([wt("a", "/r1")]);
    expect(result.failures).toEqual([]);
    expect(result.archived).toBe(1);
  });

  it("still stops the server and reports one failure when the port-release step throws", async () => {
    vi.mocked(stopServerAndReleasePort).mockRejectedValueOnce(new Error("port stuck"));

    const result = await bulkArchive([wt("a", "/r1")]);

    expect(result.archived).toBe(1);
    expect(result.failures).toEqual(["a"]);
  });
});
