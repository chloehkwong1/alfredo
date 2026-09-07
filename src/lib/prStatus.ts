import type { PrStatus } from "../types";

/** A PR is terminal (merged or closed-unmerged) once it can no longer change
 *  state on its own — reopening is a distinct user action, not a poll result.
 *  Callers holding a hydrated (possibly stale) `prStatus` use this to decide
 *  whether it's still safe to trust for column/diff-stat purposes. */
export function isTerminalPr(pr: Pick<PrStatus, "merged" | "state">): boolean {
  return pr.merged || pr.state === "closed";
}

export type PrStateKind = "merged" | "closed" | "draft" | "open";

/** A PR's display state, terminal states first so a merged/closed PR is never
 *  misclassified "open". Callers needing more than the label (e.g. an icon)
 *  key off this instead of re-deriving the precedence. */
export function prStateKind(pr: Pick<PrStatus, "merged" | "state" | "draft">): PrStateKind {
  if (pr.merged) return "merged";
  if (isTerminalPr(pr)) return "closed";
  if (pr.draft) return "draft";
  return "open";
}

/** Label + color token for a PR's current state — the single source for PR
 *  state colors, so the same PR can't render differently across panes. */
export function prStatusLabel(
  pr: Pick<PrStatus, "merged" | "state" | "draft">,
): { text: string; className: string } {
  switch (prStateKind(pr)) {
    case "merged": return { text: "Merged", className: "text-accent-primary" };
    case "closed": return { text: "Closed", className: "text-text-secondary" };
    case "draft": return { text: "Draft", className: "text-status-busy" };
    case "open": return { text: "Open", className: "text-status-idle" };
  }
}

/** The `{merged, closed}` summary shape the sidebar chips read — closed means
 *  closed-without-merge. Shared by prStore's live derivation and the
 *  hydrated-status fallback so restored cards can't render differently. */
export function toTerminalFlags(
  pr: Pick<PrStatus, "merged" | "state">,
): { merged: boolean; closed: boolean } {
  return { merged: pr.merged, closed: pr.state === "closed" && !pr.merged };
}
