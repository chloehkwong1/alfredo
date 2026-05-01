// Predicate for the simplified pinned-main-card view: shown only when parked
// on the repo's default branch with no associated PR.
import type { Worktree } from "../types";

export interface MainViewContext {
  worktree: Pick<Worktree, "isPinnedMainCard" | "branch">;
  defaultBranch: string | null;
  hasPr: boolean;
}

export function shouldShowSimplifiedMainView(ctx: MainViewContext): boolean {
  const { worktree, defaultBranch, hasPr } = ctx;
  return (
    worktree.isPinnedMainCard === true &&
    defaultBranch !== null &&
    worktree.branch === defaultBranch &&
    !hasPr
  );
}
