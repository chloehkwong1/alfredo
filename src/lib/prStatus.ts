import type { PrStatus } from "../types";

/** A PR is terminal (merged or closed-unmerged) once it can no longer change
 *  state on its own — reopening is a distinct user action, not a poll result.
 *  Callers holding a hydrated (possibly stale) `prStatus` use this to decide
 *  whether it's still safe to trust for column/diff-stat purposes. */
export function isTerminalPr(pr: Pick<PrStatus, "merged" | "state">): boolean {
  return pr.merged || pr.state === "closed";
}

/** Label + color token for a PR's current state, terminal states first so a
 *  merged/closed PR is never mislabeled "Open". */
export function prStatusLabel(
  pr: Pick<PrStatus, "merged" | "state" | "draft">,
): { text: string; className: string } {
  if (pr.merged) return { text: "Merged", className: "text-accent-primary" };
  if (isTerminalPr(pr)) return { text: "Closed", className: "text-text-secondary" };
  if (pr.draft) return { text: "Draft", className: "text-status-busy" };
  return { text: "Open", className: "text-status-idle" };
}

/** The `{merged, closed}` summary shape the sidebar chips read — closed means
 *  closed-without-merge. Shared by prStore's live derivation and the
 *  hydrated-status fallback so restored cards can't render differently. */
export function toTerminalFlags(
  pr: Pick<PrStatus, "merged" | "state">,
): { merged: boolean; closed: boolean } {
  return { merged: pr.merged, closed: pr.state === "closed" && !pr.merged };
}
