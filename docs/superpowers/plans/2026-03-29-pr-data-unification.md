# PR Data Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate two PR data fetching systems into one — the Rust background sync becomes the single source of truth for all PR data (sidebar stats + PR panel detail).

**Architecture:** Extend `github_sync.rs` to fetch comments alongside existing enrichment, add full data to the event payload, update the store handler to populate `checkRuns` and `prDetail`, delete `usePrData`.

**Tech Stack:** Rust (Tauri, tokio, serde), TypeScript (React, Zustand)

**Spec:** `docs/superpowers/specs/2026-03-29-pr-data-unification-design.md`

---

### Task 1: Extend Rust `PrStatusWithColumn` with Full PR Data Fields

**Files:**
- Modify: `src-tauri/src/github_sync.rs:18-44`
- Modify: `src-tauri/src/github_sync.rs:46-70` (the `from_pr` impl)

- [ ] **Step 1: Add imports for the full data types**

At the top of `github_sync.rs`, add the missing type imports:

```rust
use crate::types::{PrStatus, CheckRun, PrReview, PrComment};
```

(Replace the existing `use crate::types::PrStatus;` line.)

- [ ] **Step 2: Add full data fields to `PrStatusWithColumn`**

Add these three fields to the struct (after the existing `repo_path` field):

```rust
    /// Full check run objects for the PR panel.
    pub check_runs: Vec<CheckRun>,
    /// Full review objects for the PR panel.
    pub reviews: Vec<PrReview>,
    /// Line comments + issue comments merged, for the PR panel.
    pub comments: Vec<PrComment>,
```

- [ ] **Step 3: Initialize the new fields in `from_pr`**

In the `from_pr` method, add the new fields initialized to empty:

```rust
            repo_path: repo_path.to_string(),
            check_runs: Vec::new(),
            reviews: Vec::new(),
            comments: Vec::new(),
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles (the fields are set but not yet populated from the API)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/github_sync.rs
git commit -m "refactor: add full PR data fields to PrStatusWithColumn"
```

---

### Task 2: Extend Enrichment to Fetch Comments and Store Full Data

**Files:**
- Modify: `src-tauri/src/github_sync.rs:199-255` (enrichment loop)

- [ ] **Step 1: Add comments to the `tokio::join!` call**

Replace the enrichment loop. The key changes: add `get_pr_comments` and `get_pr_issue_comments` to the `tokio::join!`, and store the full objects (reviews, check_runs, comments) on the struct instead of just summary counts.

Replace the entire enrichment section (from `// Enrich non-merged PRs` through the closing `}` of the for loop):

```rust
    // Enrich non-merged PRs with full data (sidebar summaries + PR panel detail).
    // Per-PR API calls run concurrently via tokio::join! (5 calls in parallel per PR).
    for pr_with_col in payload_prs.iter_mut() {
        if pr_with_col.merged {
            continue;
        }

        let pr_number = pr_with_col.number;

        let (mergeable_result, reviews_result, checks_result, line_comments_result, issue_comments_result) = tokio::join!(
            manager.get_pr_mergeable(&owner, &repo, pr_number),
            manager.get_pr_reviews(&owner, &repo, pr_number),
            async {
                if let Some(ref sha) = pr_with_col.head_sha {
                    manager.get_check_runs(&owner, &repo, sha).await
                } else {
                    Ok(Vec::new())
                }
            },
            manager.get_pr_comments(&owner, &repo, pr_number),
            manager.get_pr_issue_comments(&owner, &repo, pr_number),
        );

        if let Ok(mergeable) = mergeable_result {
            pr_with_col.mergeable = mergeable;
        }

        if let Ok(reviews) = reviews_result {
            // Deduplicate: keep latest review per reviewer for the summary decision
            let mut latest: std::collections::HashMap<String, PrReview> =
                std::collections::HashMap::new();
            for review in &reviews {
                latest
                    .entry(review.reviewer.clone())
                    .and_modify(|existing| {
                        if review.submitted_at > existing.submitted_at {
                            *existing = review.clone();
                        }
                    })
                    .or_insert(review.clone());
            }
            pr_with_col.review_decision = if latest.values().any(|r| r.state == "changes_requested") {
                Some("changes_requested".to_string())
            } else if latest.values().any(|r| r.state == "approved") {
                Some("approved".to_string())
            } else {
                Some("review_required".to_string())
            };
            // Store full review objects (deduplicated) for the PR panel
            pr_with_col.reviews = latest.into_values().collect();
        }

        if let Ok(check_runs) = checks_result {
            let failing = check_runs.iter().filter(|cr| {
                matches!(
                    cr.conclusion.as_deref(),
                    Some("failure") | Some("timed_out") | Some("action_required")
                )
            }).count() as u32;
            pr_with_col.failing_check_count = Some(failing);
            // Store full check run objects for the PR panel
            pr_with_col.check_runs = check_runs;
        }

        // Merge line comments and issue comments
        let mut all_comments = line_comments_result.unwrap_or_default();
        all_comments.extend(issue_comments_result.unwrap_or_default());
        pr_with_col.unresolved_comment_count = Some(
            all_comments.iter().filter(|c| !c.resolved).count() as u32
        );
        pr_with_col.comments = all_comments;
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles clean

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/github_sync.rs
git commit -m "feat: fetch comments and store full PR data in background sync enrichment"
```

---

### Task 3: Extend TypeScript `PrStatusWithColumn` Type

**Files:**
- Modify: `src/types.ts:83-91`

- [ ] **Step 1: Add full data fields to the TypeScript interface**

Add the new fields to the `PrStatusWithColumn` interface:

```typescript
/** A PR status annotated with the auto-determined kanban column. */
export interface PrStatusWithColumn extends PrStatus {
  autoColumn: KanbanColumn;
  failingCheckCount?: number;
  unresolvedCommentCount?: number;
  reviewDecision?: string | null;
  mergeable?: boolean | null;
  /** The repo path this PR belongs to, for multi-repo disambiguation. */
  repoPath: string;
  /** Full check run objects for the PR panel. */
  checkRuns: CheckRun[];
  /** Full review objects (deduplicated, latest per reviewer). */
  reviews: PrReview[];
  /** Line comments + issue comments merged. */
  comments: PrComment[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "refactor: add full PR data fields to PrStatusWithColumn TypeScript type"
```

---

### Task 4: Update `applyPrUpdates` to Populate `checkRuns` and `prDetail`

**Files:**
- Modify: `src/stores/prStore.ts:142-212`

- [ ] **Step 1: Extend `applyPrUpdates` to populate `checkRuns` and `prDetail`**

In `applyPrUpdates`, after the existing `newSummary[wt.id] = { ... }` block (around line 197-202), add code to populate the PR panel store slices. Also declare `newCheckRuns` and `newPrDetail` at the top of the function and include them in the `set()` call.

Replace the entire `applyPrUpdates` method:

```typescript
  applyPrUpdates: (prs, worktrees) => {
    const state = get();

    // Index PRs by repoPath+branch for multi-repo disambiguation
    const prByKey = new Map<string, PrStatusWithColumn>();
    for (const pr of prs) {
      prByKey.set(`${pr.repoPath}::${pr.branch}`, pr);
    }

    const newOverrides = { ...state.columnOverrides };
    const newLastPrState = { ...state.lastPrState };
    const newSummary = { ...state.prSummary };
    const newCheckRuns = { ...state.checkRuns };
    const newPrDetail = { ...state.prDetail };
    const patches = new Map<string, Partial<Worktree>>();

    for (const wt of worktrees) {
      const pr = prByKey.get(`${wt.repoPath}::${wt.branch}`);
      if (!pr) continue;

      const currentStateKey = prStateKey(pr);
      const previousStateKey = state.lastPrState[wt.id];

      // If PR state changed, clear any manual override
      if (previousStateKey && previousStateKey !== currentStateKey) {
        delete newOverrides[wt.id];
      }

      newLastPrState[wt.id] = currentStateKey;

      // Build updated PR status (without autoColumn, which is store-only)
      const prStatus = {
        number: pr.number,
        state: pr.state,
        title: pr.title,
        url: pr.url,
        draft: pr.draft,
        merged: pr.merged,
        branch: pr.branch,
        mergedAt: pr.mergedAt,
        headSha: pr.headSha,
        body: pr.body,
      };

      // Use manual override if still active, otherwise auto-assign
      const column = newOverrides[wt.id] ?? pr.autoColumn;

      const prChanged =
        wt.prStatus?.number !== prStatus.number ||
        wt.prStatus?.state !== prStatus.state;

      patches.set(wt.id, {
        prStatus,
        column,
        lastActivityAt: prChanged ? Date.now() : (wt.lastActivityAt ?? Date.now()),
      });

      // Sidebar summary data
      newSummary[wt.id] = {
        failingCheckCount: pr.failingCheckCount,
        unresolvedCommentCount: pr.unresolvedCommentCount,
        reviewDecision: pr.reviewDecision,
        mergeable: pr.mergeable,
      };

      // PR panel full data (only update if enrichment data is present)
      if (pr.checkRuns && pr.checkRuns.length > 0) {
        newCheckRuns[wt.id] = pr.checkRuns;
      }

      if (pr.reviews || pr.comments) {
        newPrDetail[wt.id] = {
          reviews: pr.reviews ?? [],
          comments: pr.comments ?? [],
          mergeable: pr.mergeable ?? null,
          reviewDecision: pr.reviewDecision ?? null,
        };
      }
    }

    set({
      columnOverrides: newOverrides,
      lastPrState: newLastPrState,
      prSummary: newSummary,
      checkRuns: newCheckRuns,
      prDetail: newPrDetail,
    });

    return patches;
  },
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no type errors

- [ ] **Step 3: Commit**

```bash
git add src/stores/prStore.ts
git commit -m "feat: populate checkRuns and prDetail from background sync event"
```

---

### Task 5: Delete `usePrData` and Clean Up References

**Files:**
- Delete: `src/hooks/usePrData.ts`
- Modify: `src/components/layout/PaneView.tsx:1-49`
- Modify: `src/components/changes/PrPanel.tsx:15-31`

- [ ] **Step 1: Delete `usePrData.ts`**

```bash
rm src/hooks/usePrData.ts
```

- [ ] **Step 2: Remove `usePrData` from `PaneView.tsx`**

Remove the import line:
```typescript
// DELETE this line:
import { usePrData } from "../../hooks/usePrData";
```

Remove the hook call:
```typescript
// DELETE this line:
usePrData(worktreeId, repoPath, pr?.number ?? 0, pr?.headSha ?? pr?.branch ?? "", !!pr);
```

- [ ] **Step 3: Remove `repoPath` prop from `PrPanel` interface**

In `PrPanel.tsx`, remove `repoPath` from the interface and destructured props:

```typescript
interface PrPanelProps {
  worktreeId: string;
  pr: PrStatus;
  panelState: PrPanelState;
  onTogglePanel: () => void;
  onJumpToComment: (filePath: string, line: number) => void;
}

export function PrPanel({
  worktreeId,
  pr,
  panelState,
  onTogglePanel,
  onJumpToComment,
}: PrPanelProps) {
```

- [ ] **Step 4: Remove `repoPath` prop from PrPanel call sites in `PaneView.tsx`**

There are two `<PrPanel>` usages in PaneView (one in the resizable Group, one in the collapsed fallback). Remove `repoPath={repoPath}` from both:

```tsx
// In the Group branch (around line 142):
<PrPanel
  worktreeId={worktreeId}
  pr={pr}
  panelState={effectivePrPanelState}
  onTogglePanel={handleTogglePrPanel}
  onJumpToComment={handleJumpToComment}
/>

// In the collapsed fallback (around line 170):
<PrPanel
  worktreeId={worktreeId}
  pr={pr}
  panelState={effectivePrPanelState}
  onTogglePanel={handleTogglePrPanel}
  onJumpToComment={handleJumpToComment}
/>
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no type errors. If `repoPath` is still used elsewhere in PaneView (for ChangesView), keep it — just remove it from PrPanel props.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete usePrData hook — background sync is now the single data source"
```

---

### Task 6: Verify End-to-End

- [ ] **Step 1: Restart the app and verify**

Run the app. Check:
1. **Sidebar**: PR stats (pass/pending/fail badges) appear and stay stable — no flickering
2. **PR panel**: Checks, reviews, and comments load without a separate delay
3. **Both update together**: sidebar and PR panel data arrive at the same moment
4. **Console**: No `[usePrData]` logs (hook is deleted), no API errors
5. **Multiple repos**: Both florence and florence_client_worker_app PRs work

- [ ] **Step 2: Verify no duplicate API calls**

Check the Rust stderr output for the sync loop. You should see one set of API calls per PR per 30s cycle, not two.

- [ ] **Step 3: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues from PR data unification verification"
```
