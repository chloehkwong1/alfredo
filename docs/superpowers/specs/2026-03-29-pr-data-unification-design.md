# PR Data Unification — Design Spec

**Date:** 2026-03-29
**Scope:** Consolidate two PR data fetching systems into one

---

## Problem

Two independent systems fetch overlapping GitHub PR data:

1. **`github_sync.rs`** (Rust background loop, 30s) — fetches all PRs, enriches with check runs, reviews, mergeable. Emits `github:pr-update` → populates `prSummary` in store (sidebar).

2. **`usePrData.ts`** (frontend hook per worktree, 30s) — fetches check runs, reviews, comments, mergeable. Populates `checkRuns` and `prDetail` in store (PR panel).

This causes: double API calls, data flickering when the two systems race, and slow initial load (PR panel waits for its own fetch cycle after the background sync provides basic PR info).

## Solution

Extend `github_sync.rs` to fetch all PR data (including comments) and populate both sidebar and PR panel store slices from a single event. Delete `usePrData`.

## Rust Changes

### `github_sync.rs` — Extend enrichment

In the per-PR enrichment `tokio::join!`, add two more concurrent calls:
- `manager.get_pr_comments(owner, repo, pr_number)` — line-level review comments
- `manager.get_pr_issue_comments(owner, repo, pr_number)` — issue-level comments

### `PrStatusWithColumn` — Add full data fields

Add new fields alongside the existing summary fields:

```rust
pub reviews: Vec<PrReview>,        // full review objects
pub comments: Vec<PrComment>,      // line comments + issue comments merged
pub check_runs: Vec<CheckRun>,     // full check run objects
```

Keep the existing summary fields (`failing_check_count`, `review_decision`, `unresolved_comment_count`, `mergeable`) so the sidebar doesn't need to recompute them.

### `PrUpdatePayload` serialization

The payload grows larger since it now includes full review/comment/check run objects. This is fine — it's an in-process Tauri event, not a network call. The data is already in memory from the API responses.

## Frontend Store Changes

### `prStore.ts` — `applyPrUpdates`

Currently populates `prSummary` only. Extend to also populate:

- `checkRuns[worktreeId]` — from `pr.check_runs`
- `prDetail[worktreeId]` — construct `PrDetailedStatus` from `pr.reviews`, `pr.comments`, `pr.mergeable`, and derive `reviewDecision` from reviews

This means the PR panel's data arrives at the same moment as the sidebar's data, from the same event.

## Frontend Types

### `PrUpdatePayload` / `PrStatusWithColumn` TypeScript types

Add the new fields to match the Rust struct:
- `reviews: PrReview[]`
- `comments: PrComment[]`
- `checkRuns: CheckRun[]`

These types (`PrReview`, `PrComment`, `CheckRun`) already exist in `types.ts`.

## Frontend Cleanup

### Delete `usePrData.ts`

No longer needed — the background sync provides all the data.

### Update `PaneView.tsx`

Remove the `usePrData` import and call. `PrPanel` reads from the store which is now populated by the background sync event.

### `PrPanel.tsx`

No changes needed to rendering — it already reads `checkRuns` and `prDetail` from `usePrStore`. The `repoPath` prop can be removed from the interface since it was only needed for `usePrData`.

## Data Flow After Refactor

```
github_sync.rs (30s background loop)
  → fetches all PRs per repo
  → enriches each open PR concurrently:
      tokio::join!(mergeable, reviews, line_comments, issue_comments, check_runs)
  → returns Vec<PrStatusWithColumn> with full data
  → poll_once emits github:pr-update

useGithubSync.ts (frontend listener)
  → receives github:pr-update event
  → calls prStore.applyPrUpdates which populates:
      - prSummary (sidebar: pass/fail/pending badges)
      - checkRuns (PR panel: check run list with durations)
      - prDetail (PR panel: reviews, comments, mergeable)
  → calls workspaceStore.applyWorktreePatches (kanban columns)
```

## What Gets Deleted

- `src/hooks/usePrData.ts` — entire file
- `usePrData` import and call in `src/components/layout/PaneView.tsx`
- `repoPath` prop from `PrPanel` interface (no longer needed)
- `repoPath` prop passthrough in `PaneView.tsx` for `PrPanel`

## What Stays the Same

- `PrPanel` rendering logic — reads from same store keys
- Sidebar `AgentItem` rendering — reads from same `prSummary` store key
- `useGithubSync.ts` listener — just processes a richer payload
- All GitHub API functions in `github_manager.rs` — unchanged, just called from sync instead of from frontend
- `get_check_runs` and `get_pr_detail` Tauri commands — keep for now (other features may use them), but they're no longer called by the polling hook
