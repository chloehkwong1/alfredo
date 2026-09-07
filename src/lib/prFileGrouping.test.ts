import { describe, expect, it } from "vitest";
import { groupPrFilesByCategory } from "./prFileGrouping";
import type { DiffFile } from "../types";

function file(partial: Partial<DiffFile> & { path: string }): DiffFile {
  return {
    status: "modified",
    additions: 0,
    deletions: 0,
    hunks: [],
    ...partial,
  } as DiffFile;
}

describe("groupPrFilesByCategory", () => {
  it("splits implementation files from test files", () => {
    const files = [
      file({ path: "src/components/Foo.tsx" }),
      file({ path: "src/components/Foo.test.tsx" }),
    ];
    const groups = groupPrFilesByCategory(files);
    expect(groups.map((g) => g.label)).toEqual(["Implementation", "Tests"]);
    expect(groups[0].files).toEqual([files[0]]);
    expect(groups[1].files).toEqual([files[1]]);
  });

  it("recognizes non-JS test conventions (spec dirs, _spec.rb)", () => {
    const files = [
      file({ path: "app/models/user.rb" }),
      file({ path: "spec/models/user_spec.rb" }),
      file({ path: "src-tauri/src/github_manager.rs" }),
      file({ path: "test/fixtures/sample.json" }),
    ];
    const groups = groupPrFilesByCategory(files);
    const testGroup = groups.find((g) => g.label === "Tests")!;
    expect(testGroup.files.map((f) => f.path)).toEqual([
      "spec/models/user_spec.rb",
      "test/fixtures/sample.json",
    ]);
  });

  it("sums additions/deletions per group", () => {
    const files = [
      file({ path: "src/a.ts", additions: 10, deletions: 2 }),
      file({ path: "src/b.ts", additions: 3, deletions: 1 }),
      file({ path: "src/a.test.ts", additions: 20, deletions: 0 }),
    ];
    const groups = groupPrFilesByCategory(files);
    expect(groups.find((g) => g.label === "Implementation")).toMatchObject({ additions: 13, deletions: 3 });
    expect(groups.find((g) => g.label === "Tests")).toMatchObject({ additions: 20, deletions: 0 });
  });

  it("omits an empty group instead of returning it with zero files", () => {
    const groups = groupPrFilesByCategory([file({ path: "src/a.ts" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Implementation");
  });

  it("preserves input order within a group", () => {
    const files = [
      file({ path: "src/z.ts" }),
      file({ path: "src/a.ts" }),
    ];
    const groups = groupPrFilesByCategory(files);
    expect(groups[0].files.map((f) => f.path)).toEqual(["src/z.ts", "src/a.ts"]);
  });
});
