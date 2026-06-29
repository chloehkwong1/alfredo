import { describe, expect, it } from "vitest";
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

  it("uses the override even when the branch has flipped to HEAD mid-rebase", () => {
    expect(worktreeDisplayLabel({ branch: "HEAD", name: "feature-dir" }, "My Feature")).toBe(
      "My Feature",
    );
  });
});
