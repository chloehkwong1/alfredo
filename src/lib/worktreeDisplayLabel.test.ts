import { describe, expect, it } from "vitest";
import type { Worktree } from "../types";
import { worktreeDisplayLabel } from "./worktreeDisplayLabel";

const wt = { branch: "feature", name: "feature-dir" };

describe("worktreeDisplayLabel", () => {
  it("prefers the user's rename override", () => {
    expect(worktreeDisplayLabel(wt, "My Feature")).toBe("My Feature");
  });

  it("falls back to the branch when there is no override", () => {
    expect(worktreeDisplayLabel(wt, undefined)).toBe("feature");
    expect(worktreeDisplayLabel(wt, null)).toBe("feature");
  });

  it("orders the name: hand-set label, then the note's label, then the branch, then the name", () => {
    const noted = { ...wt, note: { label: "PR 2 · Document scopes" } };
    expect(worktreeDisplayLabel(noted, "My Feature")).toBe("My Feature");
    expect(worktreeDisplayLabel(noted, null)).toBe("PR 2 · Document scopes");
    expect(worktreeDisplayLabel({ ...wt, note: { orchestration: "Documents" } }, null)).toBe(
      "feature",
    );
    const noBranch = { name: "feature-dir" } as Pick<Worktree, "branch" | "name" | "note">;
    expect(worktreeDisplayLabel(noBranch, null)).toBe("feature-dir");
  });

  it("uses the override even when the branch has flipped to HEAD mid-rebase", () => {
    expect(worktreeDisplayLabel({ branch: "HEAD", name: "feature-dir" }, "My Feature")).toBe(
      "My Feature",
    );
  });
});
