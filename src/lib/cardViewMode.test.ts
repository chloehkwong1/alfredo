import { describe, it, expect } from "vitest";
import {
  shouldShowSimplifiedMainView,
  type MainViewContext,
} from "./cardViewMode";

describe("shouldShowSimplifiedMainView", () => {
  it("returns true for pinned main on default branch with no PR", () => {
    const ctx: MainViewContext = {
      worktree: { isPinnedMainCard: true, branch: "main" },
      defaultBranch: "main",
      hasPr: false,
    };
    expect(shouldShowSimplifiedMainView(ctx)).toBe(true);
  });

  it("returns false for pinned main on a feature branch (branch mismatch)", () => {
    const ctx: MainViewContext = {
      worktree: { isPinnedMainCard: true, branch: "feature/x" },
      defaultBranch: "main",
      hasPr: false,
    };
    expect(shouldShowSimplifiedMainView(ctx)).toBe(false);
  });

  it("returns false for pinned main on default branch with an open PR", () => {
    const ctx: MainViewContext = {
      worktree: { isPinnedMainCard: true, branch: "main" },
      defaultBranch: "main",
      hasPr: true,
    };
    expect(shouldShowSimplifiedMainView(ctx)).toBe(false);
  });

  it("returns false for pinned main during defaultBranch=null fetch window", () => {
    const ctx: MainViewContext = {
      worktree: { isPinnedMainCard: true, branch: "main" },
      defaultBranch: null,
      hasPr: false,
    };
    expect(shouldShowSimplifiedMainView(ctx)).toBe(false);
  });

  it("returns false for pinned main with branch=null (detached HEAD)", () => {
    // Worktree.branch is typed string but runtime data can be null on detached HEAD.
    const ctx: MainViewContext = {
      worktree: { isPinnedMainCard: true, branch: null as unknown as string },
      defaultBranch: "main",
      hasPr: false,
    };
    expect(shouldShowSimplifiedMainView(ctx)).toBe(false);
  });

  it("returns false for non-pinned synthetic main (no isPinnedMainCard)", () => {
    const ctx: MainViewContext = {
      worktree: { branch: "main" },
      defaultBranch: "main",
      hasPr: false,
    };
    expect(shouldShowSimplifiedMainView(ctx)).toBe(false);
  });

  it("returns false for a regular feature-branch worktree (no isPinnedMainCard)", () => {
    const ctx: MainViewContext = {
      worktree: { branch: "feature/y" },
      defaultBranch: "main",
      hasPr: false,
    };
    expect(shouldShowSimplifiedMainView(ctx)).toBe(false);
  });

  it("returns true for pinned main on master with custom defaultBranch=master", () => {
    const ctx: MainViewContext = {
      worktree: { isPinnedMainCard: true, branch: "master" },
      defaultBranch: "master",
      hasPr: false,
    };
    expect(shouldShowSimplifiedMainView(ctx)).toBe(true);
  });
});
