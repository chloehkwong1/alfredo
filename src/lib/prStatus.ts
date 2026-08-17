import type { PrStatus } from "../types";

/** A PR is terminal (merged or closed-unmerged) once it can no longer change
 *  state on its own — reopening is a distinct user action, not a poll result.
 *  Callers holding a hydrated (possibly stale) `prStatus` use this to decide
 *  whether it's still safe to trust for column/diff-stat purposes. */
export function isTerminalPr(pr: Pick<PrStatus, "merged" | "state">): boolean {
  return pr.merged || pr.state === "closed";
}
