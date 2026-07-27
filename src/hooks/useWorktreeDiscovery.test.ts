import { describe, it, expect } from "vitest";
import { computeDiscovery } from "./useWorktreeDiscovery";

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
