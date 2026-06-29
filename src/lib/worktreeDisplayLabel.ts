import type { Worktree } from "../types";

/**
 * A worktree's human-facing name: the user's rename override if present,
 * otherwise the git branch, otherwise the worktree directory name.
 *
 * Callers resolve the override themselves — it's keyed by `worktree.path`, which
 * stays stable even when the branch-derived `id` momentarily flips to "HEAD"
 * mid-rebase, which is why a rename survives that flip. Centralising the
 * fallback chain keeps the sidebar and the OS-notification path in agreement so
 * a rename shows up in both, not just the sidebar.
 */
export function worktreeDisplayLabel(
  worktree: Pick<Worktree, "branch" | "name">,
  label: string | null | undefined,
): string {
  return label ?? worktree.branch ?? worktree.name;
}
