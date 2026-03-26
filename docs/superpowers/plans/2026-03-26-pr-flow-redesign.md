# PR Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the PR tab into a merge readiness dashboard with blocker visibility, CI log extraction, review/comment awareness, and one-click "Ask Claude to fix" handoff.

**Architecture:** Extend the Rust backend with new GitHub API calls (reviews, comments, workflow logs, re-run). Expand `PrStatus` with summary fields for sidebar indicators. Redesign the PR tab frontend into collapsible sections (Checks, Reviews, Comments, Conflicts). Add inline comment indicators to the diff viewer. Wire "Ask Claude to fix" to send triage-then-fix prompts to the worktree's Claude session.

**Tech Stack:** Rust/Tauri (octocrab 0.41), React 19, Zustand 5, Lucide React, Tailwind CSS 4

**Spec:** `docs/superpowers/specs/2026-03-26-pr-flow-redesign-design.md`

---

## File Structure

### Rust Backend (src-tauri/src/)

| File | Action | Responsibility |
|------|--------|---------------|
| `types.rs` | Modify | Add `PrReview`, `PrComment`, `PrDetailedStatus`, `WorkflowRunLog` types; expand `PrStatus` with `head_sha` |
| `github_manager.rs` | Modify | Add methods: `get_pr_reviews`, `get_pr_comments`, `get_pr_issue_comments`, `download_workflow_log`, `rerun_failed_jobs`, `get_pr_detail`; extract `parse_github_owner_repo` here |
| `github_sync.rs` | Modify | Add summary fields to `PrStatusWithColumn` (failing_check_count, review_decision, unresolved_comment_count, mergeable); remove duplicate `parse_github_owner_repo` |
| `commands/github.rs` | Modify | Remove local `parse_github_owner_repo`, use shared one from `github_manager`; add `get_pr_detail` command |
| `commands/checks.rs` | Modify | Add `rerun_failed_checks` and `get_workflow_log` commands |
| `commands/mod.rs` | Modify | Export new commands |
| `lib.rs` | Modify | Register new commands |

### React Frontend (src/)

| File | Action | Responsibility |
|------|--------|---------------|
| `types.ts` | Modify | Add `PrReview`, `PrComment`, `PrDetailedStatus`, `WorkflowRunLog` types; expand `PrStatusWithColumn` with summary fields |
| `api.ts` | Modify | Add `getPrDetail`, `rerunFailedChecks`, `getWorkflowLog` invoke wrappers |
| `stores/workspaceStore.ts` | Modify | Add `prDetail` state, `prComments` state; update `applyPrUpdates` for new summary fields |
| `components/pr/PrDetailPanel.tsx` | Rewrite | Blocker dashboard with collapsible sections |
| `components/pr/PrHeader.tsx` | Modify | Add merge readiness summary line |
| `components/pr/CheckRunItem.tsx` | Modify | Add expandable log excerpt, "Re-run" and "Ask Claude to fix" buttons |
| `components/pr/PrChecksSection.tsx` | Create | Collapsible checks section with "Ask Claude to fix all" action |
| `components/pr/PrReviewsSection.tsx` | Create | Collapsible reviews section showing per-reviewer status |
| `components/pr/PrCommentsSection.tsx` | Create | Collapsible comments summary with jump-to-diff links |
| `components/pr/PrConflictsSection.tsx` | Create | Merge conflict warning section |
| `components/pr/CollapsibleSection.tsx` | Create | Reusable collapsible section wrapper with badge count |
| `components/sidebar/AgentItem.tsx` | Modify | Add PR status indicator icons on the right |
| `components/changes/DiffCommentIndicator.tsx` | Create | Comment indicator icon for diff gutter |
| `components/changes/DiffCommentThread.tsx` | Create | Inline expandable comment thread below code line |
| `components/changes/FileCard.tsx` | Modify | Integrate comment indicators and threads into diff lines |

---

## Task 1: Extract `parse_github_owner_repo` to Shared Location

**Files:**
- Modify: `src-tauri/src/github_manager.rs`
- Modify: `src-tauri/src/github_sync.rs`
- Modify: `src-tauri/src/commands/github.rs`

- [ ] **Step 1: Move `parse_github_owner_repo` to `github_manager.rs`**

Add to `src-tauri/src/github_manager.rs` after the `determine_column` function (line 229):

```rust
/// Extract owner and repo from a GitHub URL (HTTPS or SSH).
pub fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
    let path = url
        .strip_prefix("git@github.com:")
        .or_else(|| url.strip_prefix("https://github.com/"))?;

    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.splitn(2, '/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();

    if owner.is_empty() || repo.is_empty() {
        return None;
    }

    Some((owner, repo))
}

/// Resolve owner/repo from a repo path by reading the git remote URL.
pub async fn resolve_owner_repo(repo_path: &str) -> Result<(String, String), AppError> {
    let output = tokio::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::Github(format!("failed to get remote URL: {e}")))?;

    if !output.status.success() {
        return Err(AppError::Github("no origin remote found".into()));
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_github_owner_repo(&url)
        .ok_or_else(|| AppError::Github(format!("could not parse owner/repo from: {url}")))
}
```

- [ ] **Step 2: Update `commands/github.rs` to use shared function**

Replace the local `resolve_owner_repo` and `parse_github_owner_repo` functions in `src-tauri/src/commands/github.rs` (lines 8-43) with an import:

```rust
use crate::config_manager;
use crate::github_manager::{self, GithubManager};
use crate::types::{AppError, PrStatus};

type Result<T> = std::result::Result<T, AppError>;

/// Fetch all open PRs for the configured repository.
#[tauri::command]
pub async fn sync_pr_status(repo_path: String) -> Result<Vec<PrStatus>> {
    let config = config_manager::load_config(&repo_path).await?;
    let token = github_manager::resolve_token(config.github_token.as_deref()).await?;
    let (owner, repo) = github_manager::resolve_owner_repo(&repo_path).await?;
    let manager = GithubManager::new(&token)?;
    manager.sync_prs(&owner, &repo).await
}

/// Get the PR associated with a specific branch, if any.
#[tauri::command]
pub async fn get_pr_for_branch(
    owner: String,
    repo: String,
    branch: String,
) -> Result<Option<PrStatus>> {
    let token = std::env::var("GITHUB_TOKEN")
        .map_err(|_| AppError::Github("no GitHub token available".into()))?;
    let manager = GithubManager::new(&token)?;
    manager.get_pr_for_branch(&owner, &repo, &branch).await
}
```

- [ ] **Step 3: Update `commands/checks.rs` to use shared function**

Replace `src-tauri/src/commands/checks.rs` line 1 (`use crate::commands::github::resolve_owner_repo;`) with:

```rust
use crate::github_manager;
```

And update line 15 (`let (owner, repo) = resolve_owner_repo(&repo_path).await?;`) to:

```rust
let (owner, repo) = github_manager::resolve_owner_repo(&repo_path).await?;
```

- [ ] **Step 4: Update `github_sync.rs` to use shared function**

In `src-tauri/src/github_sync.rs`, remove the local `parse_github_owner_repo` function (lines 159-175) and its tests (lines 177-229). Import the shared one:

Add to the top imports:
```rust
use crate::github_manager::{determine_column, parse_github_owner_repo, GithubManager};
```

Remove the old single import:
```rust
use crate::github_manager::{determine_column, GithubManager};
```

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors.

- [ ] **Step 6: Run existing tests**

Run: `cd src-tauri && cargo test`
Expected: All existing tests pass. The URL parsing tests in `commands/github.rs` can be removed since they test the same function now in `github_manager.rs`. Add equivalent tests there if not already present.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/github_manager.rs src-tauri/src/github_sync.rs src-tauri/src/commands/github.rs src-tauri/src/commands/checks.rs
git commit -m "refactor: extract parse_github_owner_repo to shared location in github_manager"
```

---

## Task 2: Expand Backend Types

**Files:**
- Modify: `src-tauri/src/types.rs`
- Modify: `src/types.ts`

- [ ] **Step 1: Add new Rust types to `types.rs`**

Add after the `CheckRun` struct (after line 125):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrReview {
    pub reviewer: String,
    pub state: String,       // "approved", "changes_requested", "pending", "dismissed"
    pub submitted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrComment {
    pub id: u64,
    pub author: String,
    pub body: String,
    pub path: Option<String>,
    pub line: Option<u32>,
    pub resolved: bool,
    pub created_at: String,
    pub updated_at: String,
    pub html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRunLog {
    pub run_id: u64,
    pub job_name: String,
    pub step_name: String,
    pub log_excerpt: String,
}

/// Detailed PR info fetched on-demand when the PR tab is opened.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrDetailedStatus {
    pub reviews: Vec<PrReview>,
    pub comments: Vec<PrComment>,
    pub mergeable: Option<bool>,
    pub review_decision: Option<String>,
}
```

- [ ] **Step 2: Add `head_sha` to `PrStatus`**

In `src-tauri/src/types.rs`, add to the `PrStatus` struct (after `merged_at` field, line 112):

```rust
    #[serde(default)]
    pub head_sha: Option<String>,
```

- [ ] **Step 3: Add corresponding TypeScript types to `src/types.ts`**

Add after the `CheckRun` interface (after line 205):

```typescript
export interface PrReview {
  reviewer: string;
  state: string; // "approved" | "changes_requested" | "pending" | "dismissed"
  submittedAt: string | null;
}

export interface PrComment {
  id: number;
  author: string;
  body: string;
  path: string | null;
  line: number | null;
  resolved: boolean;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
}

export interface WorkflowRunLog {
  runId: number;
  jobName: string;
  stepName: string;
  logExcerpt: string;
}

export interface PrDetailedStatus {
  reviews: PrReview[];
  comments: PrComment[];
  mergeable: boolean | null;
  reviewDecision: string | null;
}
```

- [ ] **Step 4: Add `headSha` to TypeScript `PrStatus`**

In `src/types.ts`, add to the `PrStatus` interface (after `mergedAt`, line 68):

```typescript
  headSha?: string;
```

Also add to `PrStatusWithColumn` (after `mergedAt`, line 87):

```typescript
  headSha?: string;
```

- [ ] **Step 5: Add summary fields to `PrStatusWithColumn` in TypeScript**

In `src/types.ts`, add to the `PrStatusWithColumn` interface (after `headSha`):

```typescript
  failingCheckCount?: number;
  unresolvedCommentCount?: number;
  reviewDecision?: string | null;
  mergeable?: boolean | null;
```

- [ ] **Step 6: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles (new types are defined but not yet used).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/types.rs src/types.ts
git commit -m "feat(types): add PrReview, PrComment, PrDetailedStatus, WorkflowRunLog types"
```

---

## Task 3: Backend — PR Reviews and Comments API

**Files:**
- Modify: `src-tauri/src/github_manager.rs`

- [ ] **Step 1: Add `get_pr_reviews` method**

Add to `impl GithubManager` in `src-tauri/src/github_manager.rs`:

```rust
    /// Fetch reviews for a PR.
    pub async fn get_pr_reviews(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<PrReview>, AppError> {
        let url = format!("/repos/{owner}/{repo}/pulls/{pr_number}/reviews");
        let response: serde_json::Value = self
            .client
            .get(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch PR reviews", e))?;

        let reviews = response
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|review| {
                        Some(PrReview {
                            reviewer: review
                                .get("user")?
                                .get("login")?
                                .as_str()?
                                .to_string(),
                            state: review
                                .get("state")?
                                .as_str()?
                                .to_lowercase(),
                            submitted_at: review
                                .get("submitted_at")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(reviews)
    }
```

- [ ] **Step 2: Add `get_pr_comments` method (line-level review comments)**

```rust
    /// Fetch line-level review comments for a PR.
    pub async fn get_pr_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<PrComment>, AppError> {
        let url = format!("/repos/{owner}/{repo}/pulls/{pr_number}/comments");
        let response: serde_json::Value = self
            .client
            .get(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch PR comments", e))?;

        let comments = response
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| {
                        Some(PrComment {
                            id: c.get("id")?.as_u64()?,
                            author: c.get("user")?.get("login")?.as_str()?.to_string(),
                            body: c.get("body")?.as_str()?.to_string(),
                            path: c.get("path").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            line: c.get("line").and_then(|v| v.as_u64()).map(|n| n as u32),
                            resolved: false, // GitHub doesn't return this directly on the comment — we check via review threads
                            created_at: c.get("created_at")?.as_str()?.to_string(),
                            updated_at: c.get("updated_at")?.as_str()?.to_string(),
                            html_url: c.get("html_url")?.as_str()?.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(comments)
    }
```

- [ ] **Step 3: Add `get_pr_issue_comments` method (general comments)**

```rust
    /// Fetch general (non-line-level) comments on a PR.
    pub async fn get_pr_issue_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<PrComment>, AppError> {
        let url = format!("/repos/{owner}/{repo}/issues/{pr_number}/comments");
        let response: serde_json::Value = self
            .client
            .get(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch issue comments", e))?;

        let comments = response
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| {
                        Some(PrComment {
                            id: c.get("id")?.as_u64()?,
                            author: c.get("user")?.get("login")?.as_str()?.to_string(),
                            body: c.get("body")?.as_str()?.to_string(),
                            path: None,
                            line: None,
                            resolved: false,
                            created_at: c.get("created_at")?.as_str()?.to_string(),
                            updated_at: c.get("updated_at")?.as_str()?.to_string(),
                            html_url: c.get("html_url")?.as_str()?.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(comments)
    }
```

- [ ] **Step 4: Add `get_pr_detail` method that combines reviews + comments + mergeable**

```rust
    /// Fetch detailed PR info: reviews, comments, and mergeable status.
    pub async fn get_pr_detail(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<PrDetailedStatus, AppError> {
        // Fetch PR for mergeable status
        let pr_url = format!("/repos/{owner}/{repo}/pulls/{pr_number}");
        let pr_response: serde_json::Value = self
            .client
            .get(pr_url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch PR detail", e))?;

        let mergeable = pr_response.get("mergeable").and_then(|v| v.as_bool());

        // Fetch reviews, line comments, and issue comments concurrently
        let (reviews, line_comments, issue_comments) = tokio::join!(
            self.get_pr_reviews(owner, repo, pr_number),
            self.get_pr_comments(owner, repo, pr_number),
            self.get_pr_issue_comments(owner, repo, pr_number),
        );

        let reviews = reviews?;
        let mut comments = line_comments?;
        comments.extend(issue_comments?);

        // Deduplicate reviews: keep only the latest review per reviewer
        let mut latest_reviews: std::collections::HashMap<String, PrReview> =
            std::collections::HashMap::new();
        for review in reviews {
            latest_reviews
                .entry(review.reviewer.clone())
                .and_modify(|existing| {
                    if review.submitted_at > existing.submitted_at {
                        *existing = review.clone();
                    }
                })
                .or_insert(review);
        }
        let deduped_reviews: Vec<PrReview> = latest_reviews.into_values().collect();

        // Derive review decision from individual reviews
        let review_decision = if deduped_reviews.iter().any(|r| r.state == "changes_requested") {
            Some("changes_requested".to_string())
        } else if deduped_reviews.iter().any(|r| r.state == "approved") {
            Some("approved".to_string())
        } else {
            Some("review_required".to_string())
        };

        Ok(PrDetailedStatus {
            reviews: deduped_reviews,
            comments,
            mergeable,
            review_decision,
        })
    }
```

- [ ] **Step 5: Update imports at top of `github_manager.rs`**

Add the new types to the import line:

```rust
use crate::types::{AppError, CheckRun, KanbanColumn, PrComment, PrDetailedStatus, PrReview, PrStatus};
```

- [ ] **Step 6: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/github_manager.rs
git commit -m "feat(github): add PR reviews, comments, and detail API methods"
```

---

## Task 4: Backend — Workflow Logs and Re-run API

**Files:**
- Modify: `src-tauri/src/github_manager.rs`
- Modify: `src-tauri/src/commands/checks.rs`
- Modify: `src-tauri/src/commands/mod.rs` (if needed)
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `rerun_failed_jobs` method to `GithubManager`**

```rust
    /// Re-run only the failed jobs in a workflow run.
    pub async fn rerun_failed_jobs(
        &self,
        owner: &str,
        repo: &str,
        run_id: u64,
    ) -> Result<(), AppError> {
        let url = format!("/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs");
        self.client
            .post::<_, serde_json::Value>(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to re-run failed jobs", e))?;
        Ok(())
    }
```

- [ ] **Step 2: Add `download_workflow_log` method to `GithubManager`**

```rust
    /// Download and extract the failure log excerpt for a workflow run.
    /// Returns log excerpts for each failing step.
    pub async fn download_workflow_log(
        &self,
        owner: &str,
        repo: &str,
        run_id: u64,
    ) -> Result<Vec<WorkflowRunLog>, AppError> {
        let url = format!("/repos/{owner}/{repo}/actions/runs/{run_id}/logs");

        // GitHub returns a 302 redirect to a zip download URL
        let response = self
            .client
            .get::<Vec<u8>>(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to download workflow logs", e))?;

        Self::parse_workflow_logs(run_id, &response)
    }

    /// Parse a zip of workflow logs and extract failure excerpts.
    fn parse_workflow_logs(run_id: u64, zip_bytes: &[u8]) -> Result<Vec<WorkflowRunLog>, AppError> {
        use std::io::Read;

        let reader = std::io::Cursor::new(zip_bytes);
        let mut archive = zip::ZipArchive::new(reader)
            .map_err(|e| AppError::Github(format!("failed to read log zip: {e}")))?;

        let mut logs = Vec::new();

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| AppError::Github(format!("failed to read zip entry: {e}")))?;

            let name = file.name().to_string();

            // Log files are named like "job-name/step-number_step-name.txt"
            let parts: Vec<&str> = name.splitn(2, '/').collect();
            if parts.len() != 2 || !parts[1].ends_with(".txt") {
                continue;
            }

            let job_name = parts[0].to_string();
            let step_name = parts[1]
                .trim_end_matches(".txt")
                .split('_')
                .skip(1)
                .collect::<Vec<&str>>()
                .join("_");

            let mut content = String::new();
            file.read_to_string(&mut content).ok();

            // Check if this step contains failure indicators
            let has_failure = content.contains("FAIL")
                || content.contains("Error:")
                || content.contains("error[")
                || content.contains("FAILED")
                || content.contains("AssertionError")
                || content.contains("Process completed with exit code 1");

            if has_failure {
                // Extract the last 80 lines as the failure excerpt
                let lines: Vec<&str> = content.lines().collect();
                let start = lines.len().saturating_sub(80);
                let excerpt = lines[start..].join("\n");

                logs.push(WorkflowRunLog {
                    run_id,
                    job_name,
                    step_name,
                    log_excerpt: excerpt,
                });
            }
        }

        Ok(logs)
    }
```

- [ ] **Step 3: Add `zip` crate dependency**

In `src-tauri/Cargo.toml`, add to `[dependencies]`:

```toml
zip = { version = "2", default-features = false, features = ["deflate"] }
```

- [ ] **Step 4: Add `WorkflowRunLog` to `github_manager.rs` imports**

Update the imports line:

```rust
use crate::types::{AppError, CheckRun, KanbanColumn, PrComment, PrDetailedStatus, PrReview, PrStatus, WorkflowRunLog};
```

- [ ] **Step 5: Add `get_check_run_for_rerun` method to resolve run_id from check_run_id**

GitHub check runs have a `check_suite` with a `workflow_run` that has the `run_id` we need for re-running. We need to extract this.

Add to `get_check_runs` — modify the method to also capture `run_id` from check run data. First, add `run_id` to the `CheckRun` type in `types.rs`:

In `src-tauri/src/types.rs`, add to `CheckRun` struct after `completed_at`:

```rust
    #[serde(default)]
    pub run_id: Option<u64>,
```

And in `src/types.ts`, add to `CheckRun` interface after `completedAt`:

```typescript
  runId?: number;
```

Then update `get_check_runs` in `github_manager.rs` to extract it. In the `filter_map` closure, after `completed_at`, add:

```rust
                            run_id: run
                                .pointer("/check_suite/id")
                                .and_then(|v| v.as_u64()),
```

Wait — we actually need the *workflow run ID*, not the check suite ID. The check run response doesn't include `workflow_run_id` directly. The proper approach: use the check suite ID to find the workflow run.

Simpler approach: The `html_url` of a check run contains the run ID in the URL pattern. But the most reliable way is to use the GitHub API to list workflow runs for the branch and match by name/status.

Actually, the simplest approach: the check run's `details_url` or the `check_suite` object in the response includes reference info. Let's use the check suite API instead.

Revised approach — extract the check_suite_id from the check run, then use `GET /repos/{owner}/{repo}/actions/runs?check_suite_id={id}` to get the workflow run ID:

```rust
    /// Get the workflow run ID for a check run (needed for re-run/log download).
    pub async fn get_workflow_run_id_for_check_suite(
        &self,
        owner: &str,
        repo: &str,
        check_suite_id: u64,
    ) -> Result<Option<u64>, AppError> {
        let url = format!(
            "/repos/{owner}/{repo}/actions/runs?check_suite_id={check_suite_id}"
        );
        let response: serde_json::Value = self
            .client
            .get(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch workflow runs", e))?;

        let run_id = response
            .get("workflow_runs")
            .and_then(|v| v.as_array())
            .and_then(|runs| runs.first())
            .and_then(|run| run.get("id"))
            .and_then(|v| v.as_u64());

        Ok(run_id)
    }
```

Update `CheckRun` in `types.rs` to include `check_suite_id` instead of `run_id`:

```rust
    #[serde(default)]
    pub check_suite_id: Option<u64>,
```

And in `src/types.ts`:

```typescript
  checkSuiteId?: number;
```

Update `get_check_runs` in `github_manager.rs` to extract it:

```rust
                            check_suite_id: run
                                .pointer("/check_suite/id")
                                .and_then(|v| v.as_u64()),
```

- [ ] **Step 6: Add Tauri commands for re-run and log download**

Update `src-tauri/src/commands/checks.rs`:

```rust
use crate::github_manager;
use crate::config_manager;
use crate::github_manager::GithubManager;
use crate::types::{AppError, CheckRun, WorkflowRunLog};

type Result<T> = std::result::Result<T, AppError>;

/// Fetch GitHub Actions check runs for a given branch.
#[tauri::command]
pub async fn get_check_runs(repo_path: String, branch: String) -> Result<Vec<CheckRun>> {
    let config = config_manager::load_config(&repo_path).await?;
    let token = github_manager::resolve_token(config.github_token.as_deref()).await?;
    let manager = GithubManager::new(&token)?;
    let (owner, repo) = github_manager::resolve_owner_repo(&repo_path).await?;
    manager.get_check_runs(&owner, &repo, &branch).await
}

/// Re-run failed jobs for a workflow run (identified via check suite ID).
#[tauri::command]
pub async fn rerun_failed_checks(repo_path: String, check_suite_id: u64) -> Result<()> {
    let config = config_manager::load_config(&repo_path).await?;
    let token = github_manager::resolve_token(config.github_token.as_deref()).await?;
    let manager = GithubManager::new(&token)?;
    let (owner, repo) = github_manager::resolve_owner_repo(&repo_path).await?;

    let run_id = manager
        .get_workflow_run_id_for_check_suite(&owner, &repo, check_suite_id)
        .await?
        .ok_or_else(|| AppError::Github("no workflow run found for check suite".into()))?;

    manager.rerun_failed_jobs(&owner, &repo, run_id).await
}

/// Download and extract failure log excerpts for a workflow run.
#[tauri::command]
pub async fn get_workflow_log(repo_path: String, check_suite_id: u64) -> Result<Vec<WorkflowRunLog>> {
    let config = config_manager::load_config(&repo_path).await?;
    let token = github_manager::resolve_token(config.github_token.as_deref()).await?;
    let manager = GithubManager::new(&token)?;
    let (owner, repo) = github_manager::resolve_owner_repo(&repo_path).await?;

    let run_id = manager
        .get_workflow_run_id_for_check_suite(&owner, &repo, check_suite_id)
        .await?
        .ok_or_else(|| AppError::Github("no workflow run found for check suite".into()))?;

    manager.download_workflow_log(&owner, &repo, run_id).await
}
```

- [ ] **Step 7: Register new commands in `lib.rs`**

In `src-tauri/src/lib.rs`, add after `checks::get_check_runs` (line 78):

```rust
            checks::rerun_failed_checks,
            checks::get_workflow_log,
```

- [ ] **Step 8: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/github_manager.rs src-tauri/src/commands/checks.rs src-tauri/src/lib.rs src-tauri/src/types.rs src/types.ts src-tauri/Cargo.toml
git commit -m "feat(github): add workflow log download, re-run failed checks, and check suite ID tracking"
```

---

## Task 5: Backend — PR Detail Command and Sync Loop Expansion

**Files:**
- Create: `src-tauri/src/commands/pr_detail.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/github_sync.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create `commands/pr_detail.rs`**

```rust
use crate::config_manager;
use crate::github_manager::{self, GithubManager};
use crate::types::{AppError, PrDetailedStatus};

type Result<T> = std::result::Result<T, AppError>;

/// Fetch detailed PR info (reviews, comments, mergeable status).
/// Called on-demand when the PR tab is opened.
#[tauri::command]
pub async fn get_pr_detail(
    repo_path: String,
    pr_number: u64,
) -> Result<PrDetailedStatus> {
    let config = config_manager::load_config(&repo_path).await?;
    let token = github_manager::resolve_token(config.github_token.as_deref()).await?;
    let manager = GithubManager::new(&token)?;
    let (owner, repo) = github_manager::resolve_owner_repo(&repo_path).await?;
    manager.get_pr_detail(&owner, &repo, pr_number).await
}
```

- [ ] **Step 2: Export from `commands/mod.rs`**

Add to `src-tauri/src/commands/mod.rs`:

```rust
pub mod pr_detail;
```

- [ ] **Step 3: Register in `lib.rs`**

Add the import at the top (update the `use commands::` line to include `pr_detail`):

```rust
use commands::{app_config, branch, checks, config, diff, github, github_auth, linear, pr_detail, pty, repo, session, worktree};
```

Add after the GitHub commands section:

```rust
            pr_detail::get_pr_detail,
```

- [ ] **Step 4: Expand `PrStatusWithColumn` in `github_sync.rs` with summary fields**

In `src-tauri/src/github_sync.rs`, add fields to `PrStatusWithColumn`:

```rust
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusWithColumn {
    pub number: u64,
    pub state: String,
    pub title: String,
    pub url: String,
    pub draft: bool,
    pub merged: bool,
    pub branch: String,
    pub auto_column: String,
    pub merged_at: Option<String>,
    pub head_sha: Option<String>,
    // Summary fields for sidebar indicators (populated during sync)
    pub failing_check_count: Option<u32>,
    pub unresolved_comment_count: Option<u32>,
    pub review_decision: Option<String>,
    pub mergeable: Option<bool>,
}
```

- [ ] **Step 5: Update `PrStatusWithColumn::from` to populate `head_sha`**

We need to capture `head_sha` from the PR API response. Update `sync_prs` in `github_manager.rs` to extract it.

In `github_manager.rs`, update the `PrStatus` construction in `sync_prs` to include `head_sha`:

In the open PRs mapping (around line 71), add:
```rust
                head_sha: Some(pr.head.sha),
```

In the merged PRs mapping (around line 105), add:
```rust
                head_sha: Some(pr.head.sha),
```

In `get_pr_for_branch` (around line 156), add:
```rust
                head_sha: Some(pr.head.sha.clone()),
```

Then update the `From` impl in `github_sync.rs`:

```rust
impl From<&PrStatus> for PrStatusWithColumn {
    fn from(pr: &PrStatus) -> Self {
        let column = determine_column(Some(pr));
        Self {
            number: pr.number,
            state: pr.state.clone(),
            title: pr.title.clone(),
            url: pr.url.clone(),
            draft: pr.draft,
            merged: pr.merged,
            branch: pr.branch.clone(),
            auto_column: serde_json::to_value(&column)
                .ok()
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_else(|| "inProgress".to_string()),
            merged_at: pr.merged_at.clone(),
            head_sha: pr.head_sha.clone(),
            // Summary fields populated later in poll_once
            failing_check_count: None,
            unresolved_comment_count: None,
            review_decision: None,
            mergeable: None,
        }
    }
}
```

- [ ] **Step 6: Enrich sync payload with lightweight summary data**

Update `poll_once` in `github_sync.rs` to fetch check run counts and review decisions for open PRs. This adds a few extra API calls per poll but keeps the sidebar indicators current.

Replace the payload construction section in `poll_once` (around lines 148-154):

```rust
    let mut payload_prs: Vec<PrStatusWithColumn> =
        prs.iter().map(PrStatusWithColumn::from).collect();

    // Enrich open (non-merged) PRs with summary data for sidebar indicators.
    // This adds lightweight API calls — only counts, not full content.
    for pr_with_col in &mut payload_prs {
        if pr_with_col.merged {
            continue;
        }

        // Fetch check runs to count failures
        if let Some(ref sha) = pr_with_col.head_sha {
            if let Ok(checks) = manager.get_check_runs(&owner, &repo, sha).await {
                let failing = checks
                    .iter()
                    .filter(|c| {
                        c.conclusion.as_deref() == Some("failure")
                            || c.conclusion.as_deref() == Some("timed_out")
                    })
                    .count() as u32;
                pr_with_col.failing_check_count = Some(failing);
            }
        }

        // Fetch PR detail for review decision, comment count, mergeable
        let pr_url = format!("/repos/{owner}/{repo}/pulls/{}", pr_with_col.number);
        if let Ok(pr_detail) = manager.client_get_json::<serde_json::Value>(&pr_url).await {
            pr_with_col.mergeable = pr_detail.get("mergeable").and_then(|v| v.as_bool());
        }

        // Fetch reviews for decision
        if let Ok(reviews) = manager.get_pr_reviews(&owner, &repo, pr_with_col.number).await {
            if reviews.iter().any(|r| r.state == "changes_requested") {
                pr_with_col.review_decision = Some("changes_requested".to_string());
            } else if reviews.iter().any(|r| r.state == "approved") {
                pr_with_col.review_decision = Some("approved".to_string());
            }
        }

        // Fetch comment count (line comments only — lightweight)
        let comments_url = format!(
            "/repos/{owner}/{repo}/pulls/{}/comments",
            pr_with_col.number
        );
        if let Ok(comments) = manager.client_get_json::<serde_json::Value>(&comments_url).await {
            if let Some(arr) = comments.as_array() {
                pr_with_col.unresolved_comment_count = Some(arr.len() as u32);
            }
        }
    }

    let payload = PrUpdatePayload { prs: payload_prs };
```

Wait — we need `client_get_json` which doesn't exist. Let's add a helper to `GithubManager`:

Add to `impl GithubManager` in `github_manager.rs`:

```rust
    /// Generic GET returning parsed JSON. Used by sync loop for lightweight queries.
    pub async fn client_get_json<T: serde::de::DeserializeOwned>(
        &self,
        url: &str,
    ) -> Result<T, AppError> {
        self.client
            .get(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("GitHub API request failed", e))
    }
```

Also, the sync loop currently doesn't have direct access to `manager.client` for raw requests. But `client_get_json` is a method on `GithubManager`, so we access it through `manager`.

- [ ] **Step 7: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: Compiles with no errors.

- [ ] **Step 8: Run tests**

Run: `cd src-tauri && cargo test`
Expected: Existing tests pass. The `PrStatusWithColumn` serialization tests will need updating for the new fields.

Update the tests in `github_sync.rs` to include the new fields in assertions. The existing tests check `auto_column` — they should still pass since `From` impl initializes new fields as `None`.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/commands/pr_detail.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs src-tauri/src/github_sync.rs src-tauri/src/github_manager.rs
git commit -m "feat(github): add PR detail command, enrich sync loop with summary data for sidebar indicators"
```

---

## Task 6: Frontend — API Layer and Store Updates

**Files:**
- Modify: `src/api.ts`
- Modify: `src/stores/workspaceStore.ts`

- [ ] **Step 1: Add new API functions to `src/api.ts`**

Add after the existing `getCheckRuns` function:

```typescript
export function getPrDetail(
  repoPath: string,
  prNumber: number,
): Promise<PrDetailedStatus> {
  return invoke("get_pr_detail", { repoPath, prNumber });
}

export function rerunFailedChecks(
  repoPath: string,
  checkSuiteId: number,
): Promise<void> {
  return invoke("rerun_failed_checks", { repoPath, checkSuiteId });
}

export function getWorkflowLog(
  repoPath: string,
  checkSuiteId: number,
): Promise<WorkflowRunLog[]> {
  return invoke("get_workflow_log", { repoPath, checkSuiteId });
}
```

Update the imports at the top of `api.ts` to include the new types:

```typescript
import type {
  AppConfig,
  CheckRun,
  CommitInfo,
  DiffFile,
  GlobalAppConfig,
  KanbanColumn,
  LinearTeam,
  LinearTicket,
  PrDetailedStatus,
  PrStatus,
  PtyEvent,
  RepoMode,
  Session,
  SetupScript,
  WorkflowRunLog,
  Worktree,
  WorktreeSource,
} from "./types";
```

- [ ] **Step 2: Add PR detail state to workspace store**

In `src/stores/workspaceStore.ts`, add to the store state type and initial state:

Add to the state interface (find where `checkRuns` is defined):

```typescript
  prDetail: Record<string, PrDetailedStatus>;
  setPrDetail: (worktreeId: string, detail: PrDetailedStatus) => void;
```

Add to the store creation (next to `checkRuns` initial value):

```typescript
  prDetail: {},
  setPrDetail: (worktreeId, detail) =>
    set((s) => ({ prDetail: { ...s.prDetail, [worktreeId]: detail } })),
```

- [ ] **Step 3: Update `applyPrUpdates` to store new summary fields**

The `PrStatusWithColumn` type now includes `failingCheckCount`, `unresolvedCommentCount`, `reviewDecision`, and `mergeable`. These need to be accessible from the store for sidebar indicators.

Add a new state field for PR summary data:

```typescript
  prSummary: Record<string, {
    failingCheckCount?: number;
    unresolvedCommentCount?: number;
    reviewDecision?: string | null;
    mergeable?: boolean | null;
  }>;
```

Initialize it:
```typescript
  prSummary: {},
```

In `applyPrUpdates`, after matching PRs to worktrees and updating `prStatus`, also store the summary:

```typescript
  // Store summary data for sidebar indicators
  const newSummary = { ...get().prSummary };
  for (const pr of prs) {
    // Find the worktree that matches this PR's branch
    const wt = updated.find((w) => w.branch === pr.branch);
    if (wt) {
      newSummary[wt.id] = {
        failingCheckCount: pr.failingCheckCount,
        unresolvedCommentCount: pr.unresolvedCommentCount,
        reviewDecision: pr.reviewDecision,
        mergeable: pr.mergeable,
      };
    }
  }
```

Add `prSummary: newSummary` to the `set()` call.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/api.ts src/stores/workspaceStore.ts
git commit -m "feat(store): add PR detail state, summary data for sidebar, and new API functions"
```

---

## Task 7: Frontend — CollapsibleSection Component

**Files:**
- Create: `src/components/pr/CollapsibleSection.tsx`

- [ ] **Step 1: Create the reusable collapsible section**

```tsx
import { useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";

interface CollapsibleSectionProps {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

function CollapsibleSection({
  title,
  badge,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2 hover:bg-bg-hover transition-colors"
      >
        <ChevronRight
          className={[
            "h-3.5 w-3.5 text-text-tertiary transition-transform",
            open ? "rotate-90" : "",
          ].join(" ")}
        />
        <span className="text-xs font-semibold text-text-tertiary uppercase tracking-wider">
          {title}
        </span>
        {badge && <span className="ml-auto">{badge}</span>}
      </button>
      {open && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

export { CollapsibleSection };
```

- [ ] **Step 2: Commit**

```bash
git add src/components/pr/CollapsibleSection.tsx
git commit -m "feat(pr): add CollapsibleSection component"
```

---

## Task 8: Frontend — PR Checks Section with Log Excerpts

**Files:**
- Create: `src/components/pr/PrChecksSection.tsx`
- Modify: `src/components/pr/CheckRunItem.tsx`

- [ ] **Step 1: Update `CheckRunItem` to support expandable logs and actions**

Rewrite `src/components/pr/CheckRunItem.tsx`:

```tsx
import { useState } from "react";
import {
  CheckCircle,
  XCircle,
  Loader,
  MinusCircle,
  SkipForward,
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Wrench,
  ExternalLink,
} from "lucide-react";
import type { CheckRun, WorkflowRunLog } from "../../types";
import { getWorkflowLog, rerunFailedChecks } from "../../api";

interface CheckRunItemProps {
  run: CheckRun;
  repoPath: string;
  onAskClaudeFix?: (logs: WorkflowRunLog[]) => void;
}

function statusIcon(run: CheckRun) {
  if (run.status !== "completed") {
    return <Loader className="h-3.5 w-3.5 text-status-busy animate-spin" />;
  }
  switch (run.conclusion) {
    case "success":
      return <CheckCircle className="h-3.5 w-3.5 text-diff-added" />;
    case "failure":
    case "timed_out":
      return <XCircle className="h-3.5 w-3.5 text-status-error" />;
    case "cancelled":
      return <MinusCircle className="h-3.5 w-3.5 text-text-tertiary" />;
    case "skipped":
      return <SkipForward className="h-3.5 w-3.5 text-text-tertiary" />;
    default:
      return <MinusCircle className="h-3.5 w-3.5 text-text-tertiary" />;
  }
}

function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
  if (!startedAt || !completedAt) return null;
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

const isFailed = (run: CheckRun) =>
  run.conclusion === "failure" || run.conclusion === "timed_out";

function CheckRunItem({ run, repoPath, onAskClaudeFix }: CheckRunItemProps) {
  const failed = isFailed(run);
  const [expanded, setExpanded] = useState(failed);
  const [logs, setLogs] = useState<WorkflowRunLog[] | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const duration = formatDuration(run.startedAt, run.completedAt);

  const handleExpand = async () => {
    const willExpand = !expanded;
    setExpanded(willExpand);

    if (willExpand && !logs && run.checkSuiteId && failed) {
      setLoadingLogs(true);
      try {
        const result = await getWorkflowLog(repoPath, run.checkSuiteId);
        setLogs(result);
      } catch (err) {
        console.error("Failed to fetch logs:", err);
        setLogs([]);
      } finally {
        setLoadingLogs(false);
      }
    }
  };

  const handleRerun = async () => {
    if (!run.checkSuiteId) return;
    setRerunning(true);
    try {
      await rerunFailedChecks(repoPath, run.checkSuiteId);
    } catch (err) {
      console.error("Failed to re-run:", err);
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        {failed ? (
          <button
            type="button"
            onClick={handleExpand}
            className="flex items-center gap-1 text-text-tertiary hover:text-text-secondary"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            {statusIcon(run)}
          </button>
        ) : (
          <span className="ml-4">{statusIcon(run)}</span>
        )}

        <a
          href={run.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-text-secondary hover:text-text-primary truncate flex-1"
        >
          {run.name}
        </a>

        {duration && (
          <span className="text-2xs text-text-tertiary flex-shrink-0">
            {duration}
          </span>
        )}

        <a
          href={run.htmlUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-tertiary hover:text-text-secondary"
        >
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {expanded && failed && (
        <div className="ml-8 mt-2">
          {loadingLogs && (
            <div className="text-xs text-text-tertiary flex items-center gap-1">
              <Loader className="h-3 w-3 animate-spin" /> Loading logs...
            </div>
          )}

          {logs && logs.length > 0 && (
            <div className="bg-bg-surface border border-border-subtle rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto p-2 mb-2">
              {logs.map((log, i) => (
                <div key={i}>
                  <div className="text-text-tertiary mb-1">
                    {log.jobName} / {log.stepName}
                  </div>
                  <pre className="text-status-error whitespace-pre-wrap break-words">
                    {log.logExcerpt}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {logs && logs.length === 0 && (
            <div className="text-xs text-text-tertiary mb-2">
              No failure details found in logs
            </div>
          )}

          <div className="flex items-center gap-3">
            {run.checkSuiteId && (
              <button
                type="button"
                onClick={handleRerun}
                disabled={rerunning}
                className="flex items-center gap-1 text-xs text-accent-primary hover:text-accent-hover disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                {rerunning ? "Re-running..." : "Re-run"}
              </button>
            )}
            {onAskClaudeFix && logs && logs.length > 0 && (
              <button
                type="button"
                onClick={() => onAskClaudeFix(logs)}
                className="flex items-center gap-1 text-xs text-status-busy hover:text-yellow-300"
              >
                <Wrench className="h-3 w-3" />
                Ask Claude to fix
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { CheckRunItem };
```

- [ ] **Step 2: Create `PrChecksSection.tsx`**

```tsx
import { CollapsibleSection } from "./CollapsibleSection";
import { CheckRunItem } from "./CheckRunItem";
import { Wrench } from "lucide-react";
import type { CheckRun, WorkflowRunLog } from "../../types";

interface PrChecksSectionProps {
  checkRuns: CheckRun[];
  repoPath: string;
  onAskClaudeFix: (logs: WorkflowRunLog[]) => void;
}

function PrChecksSection({ checkRuns, repoPath, onAskClaudeFix }: PrChecksSectionProps) {
  const successCount = checkRuns.filter((r) => r.conclusion === "success").length;
  const failureCount = checkRuns.filter(
    (r) => r.conclusion === "failure" || r.conclusion === "timed_out",
  ).length;
  const pendingCount = checkRuns.filter((r) => r.status !== "completed").length;

  const hasFailures = failureCount > 0;

  const badge = checkRuns.length > 0 ? (
    <span className="text-2xs text-text-tertiary">
      {successCount} passed
      {failureCount > 0 && <span className="text-status-error">, {failureCount} failed</span>}
      {pendingCount > 0 && `, ${pendingCount} pending`}
    </span>
  ) : null;

  return (
    <CollapsibleSection title="Checks" badge={badge} defaultOpen={hasFailures}>
      {checkRuns.length === 0 ? (
        <div className="text-sm text-text-tertiary py-2">No checks found</div>
      ) : (
        <>
          {checkRuns.map((run) => (
            <CheckRunItem
              key={run.id}
              run={run}
              repoPath={repoPath}
              onAskClaudeFix={onAskClaudeFix}
            />
          ))}
          {hasFailures && (
            <button
              type="button"
              onClick={() => {
                // Collect all logs from failed checks — they'll be fetched in the flow
                onAskClaudeFix([]);
              }}
              className="flex items-center gap-1 text-xs text-status-busy hover:text-yellow-300 mt-2"
            >
              <Wrench className="h-3 w-3" />
              Ask Claude to fix all failures
            </button>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}

export { PrChecksSection };
```

- [ ] **Step 3: Commit**

```bash
git add src/components/pr/CheckRunItem.tsx src/components/pr/PrChecksSection.tsx
git commit -m "feat(pr): add expandable check run logs, re-run button, and Ask Claude to fix action"
```

---

## Task 9: Frontend — Reviews, Comments, and Conflicts Sections

**Files:**
- Create: `src/components/pr/PrReviewsSection.tsx`
- Create: `src/components/pr/PrCommentsSection.tsx`
- Create: `src/components/pr/PrConflictsSection.tsx`

- [ ] **Step 1: Create `PrReviewsSection.tsx`**

```tsx
import { CheckCircle, XCircle, Clock, XOctagon } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import type { PrReview } from "../../types";

interface PrReviewsSectionProps {
  reviews: PrReview[];
}

const stateIcon: Record<string, JSX.Element> = {
  approved: <CheckCircle className="h-3.5 w-3.5 text-diff-added" />,
  changes_requested: <XCircle className="h-3.5 w-3.5 text-status-error" />,
  pending: <Clock className="h-3.5 w-3.5 text-text-tertiary" />,
  dismissed: <XOctagon className="h-3.5 w-3.5 text-text-tertiary" />,
};

const stateLabel: Record<string, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  pending: "Pending",
  dismissed: "Dismissed",
};

function PrReviewsSection({ reviews }: PrReviewsSectionProps) {
  // Sort: changes_requested first, then pending, then approved, then dismissed
  const sortOrder: Record<string, number> = {
    changes_requested: 0,
    pending: 1,
    approved: 2,
    dismissed: 3,
  };
  const sorted = [...reviews].sort(
    (a, b) => (sortOrder[a.state] ?? 4) - (sortOrder[b.state] ?? 4),
  );

  const hasChangesRequested = reviews.some((r) => r.state === "changes_requested");

  const badge = reviews.length > 0 ? (
    <span className="text-2xs text-text-tertiary">{reviews.length} reviewers</span>
  ) : null;

  return (
    <CollapsibleSection title="Reviews" badge={badge} defaultOpen={hasChangesRequested}>
      {sorted.length === 0 ? (
        <div className="text-sm text-text-tertiary py-2">No reviews yet</div>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((review) => (
            <div key={review.reviewer} className="flex items-center gap-2">
              {stateIcon[review.state] ?? <Clock className="h-3.5 w-3.5 text-text-tertiary" />}
              <span className="text-sm text-text-secondary font-medium">
                @{review.reviewer}
              </span>
              <span
                className={[
                  "text-xs",
                  review.state === "changes_requested"
                    ? "text-status-error"
                    : review.state === "approved"
                      ? "text-diff-added"
                      : "text-text-tertiary",
                ].join(" ")}
              >
                {stateLabel[review.state] ?? review.state}
              </span>
            </div>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

export { PrReviewsSection };
```

- [ ] **Step 2: Create `PrCommentsSection.tsx`**

```tsx
import { MessageCircle, ExternalLink } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";
import type { PrComment } from "../../types";

interface PrCommentsSectionProps {
  comments: PrComment[];
  onJumpToComment?: (comment: PrComment) => void;
}

function PrCommentsSection({ comments, onJumpToComment }: PrCommentsSectionProps) {
  // Separate general comments (no path) from line comments
  const generalComments = comments.filter((c) => !c.path);
  const lineComments = comments.filter((c) => c.path);

  const badge = comments.length > 0 ? (
    <span className="text-2xs text-text-tertiary">{comments.length} unresolved</span>
  ) : null;

  return (
    <CollapsibleSection title="Comments" badge={badge} defaultOpen={comments.length > 0}>
      {comments.length === 0 ? (
        <div className="text-sm text-text-tertiary py-2">No comments</div>
      ) : (
        <div className="space-y-3">
          {generalComments.length > 0 && (
            <div className="space-y-2">
              {generalComments.map((comment) => (
                <div
                  key={comment.id}
                  className="border-l-2 border-border-subtle pl-3"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-secondary font-medium">
                      @{comment.author}
                    </span>
                  </div>
                  <p className="text-xs text-text-tertiary mt-0.5 line-clamp-2">
                    {comment.body}
                  </p>
                  <a
                    href={comment.htmlUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-2xs text-accent-primary hover:text-accent-hover flex items-center gap-1 mt-0.5"
                  >
                    Open on GitHub <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </div>
              ))}
            </div>
          )}

          {lineComments.length > 0 && (
            <div className="space-y-2">
              {lineComments.map((comment) => (
                <div
                  key={comment.id}
                  className="border-l-2 border-border-subtle pl-3 cursor-pointer hover:border-accent-primary transition-colors"
                  onClick={() => onJumpToComment?.(comment)}
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-text-secondary font-medium">
                      @{comment.author}
                    </span>
                    <span className="text-text-tertiary">
                      {comment.path}
                      {comment.line != null && `:${comment.line}`}
                    </span>
                  </div>
                  <p className="text-xs text-text-tertiary mt-0.5 line-clamp-2">
                    {comment.body}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-2xs text-accent-primary flex items-center gap-1">
                      <MessageCircle className="h-2.5 w-2.5" /> Jump to diff
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </CollapsibleSection>
  );
}

export { PrCommentsSection };
```

- [ ] **Step 3: Create `PrConflictsSection.tsx`**

```tsx
import { AlertTriangle } from "lucide-react";
import { CollapsibleSection } from "./CollapsibleSection";

interface PrConflictsSectionProps {
  mergeable: boolean | null;
}

function PrConflictsSection({ mergeable }: PrConflictsSectionProps) {
  // null means GitHub hasn't computed it yet, true means no conflicts
  if (mergeable !== false) return null;

  return (
    <CollapsibleSection title="Conflicts" defaultOpen>
      <div className="flex items-center gap-2 py-1">
        <AlertTriangle className="h-4 w-4 text-status-error flex-shrink-0" />
        <span className="text-sm text-status-error">
          This branch has merge conflicts that must be resolved
        </span>
      </div>
    </CollapsibleSection>
  );
}

export { PrConflictsSection };
```

- [ ] **Step 4: Commit**

```bash
git add src/components/pr/PrReviewsSection.tsx src/components/pr/PrCommentsSection.tsx src/components/pr/PrConflictsSection.tsx
git commit -m "feat(pr): add Reviews, Comments, and Conflicts sections"
```

---

## Task 10: Frontend — Redesign PrDetailPanel as Blocker Dashboard

**Files:**
- Modify: `src/components/pr/PrDetailPanel.tsx`
- Modify: `src/components/pr/PrHeader.tsx`

- [ ] **Step 1: Update `PrHeader` with merge readiness summary**

```tsx
import { GitPullRequest, GitPullRequestDraft, ExternalLink } from "lucide-react";
import type { PrStatus } from "../../types";
import { openUrl } from "../../utils/openUrl";
import { Badge, IconButton } from "../ui";

interface PrHeaderProps {
  pr: PrStatus;
  blockerCount?: number;
  resolvedCount?: number;
}

function PrHeader({ pr, blockerCount, resolvedCount }: PrHeaderProps) {
  const Icon = pr.draft ? GitPullRequestDraft : GitPullRequest;
  const stateVariant = pr.merged
    ? "idle"
    : pr.draft
      ? "busy"
      : ("waiting" as const);
  const stateLabel = pr.merged ? "Merged" : pr.draft ? "Draft" : "Open";

  return (
    <div className="px-4 py-3 border-b border-border-subtle">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-text-tertiary flex-shrink-0" />
        <span className="text-sm font-medium text-text-primary truncate flex-1">
          {pr.title}
        </span>
        <Badge variant={stateVariant}>{stateLabel}</Badge>
        <span className="text-2xs text-text-tertiary">#{pr.number}</span>
        <IconButton
          size="sm"
          label="Open on GitHub"
          onClick={() => openUrl(pr.url)}
        >
          <ExternalLink />
        </IconButton>
      </div>
      {blockerCount != null && resolvedCount != null && blockerCount > 0 && (
        <div className="text-xs text-text-tertiary mt-1">
          {resolvedCount} of {blockerCount} blockers resolved
        </div>
      )}
    </div>
  );
}

export { PrHeader };
```

- [ ] **Step 2: Rewrite `PrDetailPanel` as blocker dashboard**

```tsx
import { useEffect, useCallback, useState } from "react";
import { RefreshCw } from "lucide-react";
import { PrHeader } from "./PrHeader";
import { PrChecksSection } from "./PrChecksSection";
import { PrReviewsSection } from "./PrReviewsSection";
import { PrCommentsSection } from "./PrCommentsSection";
import { PrConflictsSection } from "./PrConflictsSection";
import { getCheckRuns, getPrDetail } from "../../api";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { IconButton } from "../ui";
import type { Worktree, WorkflowRunLog, PrComment } from "../../types";

interface PrDetailPanelProps {
  worktree: Worktree;
  repoPath: string;
}

function PrDetailPanel({ worktree, repoPath }: PrDetailPanelProps) {
  const checkRuns = useWorkspaceStore((s) => s.checkRuns[worktree.id]) ?? [];
  const setCheckRuns = useWorkspaceStore((s) => s.setCheckRuns);
  const prDetail = useWorkspaceStore((s) => s.prDetail[worktree.id]);
  const setPrDetail = useWorkspaceStore((s) => s.setPrDetail);
  const [refreshing, setRefreshing] = useState(false);

  const fetchChecks = useCallback(async () => {
    try {
      const runs = await getCheckRuns(repoPath, worktree.branch);
      setCheckRuns(worktree.id, runs);
    } catch (err) {
      console.error("Failed to fetch check runs:", err);
    }
  }, [repoPath, worktree.branch, worktree.id, setCheckRuns]);

  const fetchDetail = useCallback(async () => {
    if (!worktree.prStatus) return;
    try {
      const detail = await getPrDetail(repoPath, worktree.prStatus.number);
      setPrDetail(worktree.id, detail);
    } catch (err) {
      console.error("Failed to fetch PR detail:", err);
    }
  }, [repoPath, worktree.prStatus, worktree.id, setPrDetail]);

  const hasPr = !!worktree.prStatus;

  useEffect(() => {
    if (!hasPr) return;
    fetchChecks();
    fetchDetail();
    const interval = setInterval(() => {
      fetchChecks();
      fetchDetail();
    }, 30_000);
    return () => clearInterval(interval);
  }, [hasPr, fetchChecks, fetchDetail]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchChecks(), fetchDetail()]);
    setRefreshing(false);
  };

  if (!worktree.prStatus) {
    return (
      <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
        No pull request for this branch
      </div>
    );
  }

  // Calculate blocker counts
  const failingChecks = checkRuns.filter(
    (r) => r.conclusion === "failure" || r.conclusion === "timed_out",
  ).length;
  const hasChangesRequested = prDetail?.reviews?.some(
    (r) => r.state === "changes_requested",
  );
  const unresolvedComments = prDetail?.comments?.length ?? 0;
  const hasConflicts = prDetail?.mergeable === false;

  const blockerCount =
    (failingChecks > 0 ? 1 : 0) +
    (hasChangesRequested ? 1 : 0) +
    (unresolvedComments > 0 ? 1 : 0) +
    (hasConflicts ? 1 : 0);

  const resolvedCount =
    (failingChecks === 0 ? 1 : 0) +
    (!hasChangesRequested ? 1 : 0) +
    (unresolvedComments === 0 ? 1 : 0) +
    (!hasConflicts ? 1 : 0);

  const handleAskClaudeFix = (_logs: WorkflowRunLog[]) => {
    // TODO: Wire to Claude session — implemented in Task 12
    console.log("Ask Claude to fix:", _logs);
  };

  const handleJumpToComment = (_comment: PrComment) => {
    // TODO: Wire to diff viewer — implemented in Task 13
    console.log("Jump to comment:", _comment);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center">
        <div className="flex-1">
          <PrHeader
            pr={worktree.prStatus}
            blockerCount={blockerCount}
            resolvedCount={resolvedCount}
          />
        </div>
        <div className="px-2 border-b border-border-subtle">
          <IconButton
            size="sm"
            label="Refresh"
            onClick={handleRefresh}
          >
            <RefreshCw className={refreshing ? "animate-spin" : ""} />
          </IconButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <PrChecksSection
          checkRuns={checkRuns}
          repoPath={repoPath}
          onAskClaudeFix={handleAskClaudeFix}
        />
        <PrReviewsSection reviews={prDetail?.reviews ?? []} />
        <PrCommentsSection
          comments={prDetail?.comments ?? []}
          onJumpToComment={handleJumpToComment}
        />
        <PrConflictsSection mergeable={prDetail?.mergeable ?? null} />
      </div>
    </div>
  );
}

export { PrDetailPanel };
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/pr/PrDetailPanel.tsx src/components/pr/PrHeader.tsx
git commit -m "feat(pr): redesign PrDetailPanel as blocker dashboard with collapsible sections"
```

---

## Task 11: Frontend — Sidebar PR Status Indicators

**Files:**
- Modify: `src/components/sidebar/AgentItem.tsx`

- [ ] **Step 1: Add PR indicator icons to `AgentItem`**

Import the icons and store hook, then add the indicator badges to the right side of the worktree name row.

Add imports:
```tsx
import {
  Archive,
  Trash2,
  CheckCircle,
  XCircle,
  Loader,
  RefreshCw,
  MessageCircle,
  Eye,
} from "lucide-react";
```

Add store hook inside the component:
```tsx
const prSummary = useWorkspaceStore((s) => s.prSummary[worktree.id]);
```

Replace the current PR number display (lines 104-108) and add the indicator icons. Replace the inner `<div className="flex items-center justify-between gap-2">` block:

```tsx
<div className="flex items-center justify-between gap-2">
  <span className="text-sm font-medium text-text-primary truncate">
    {worktree.name}
  </span>
  {worktree.prStatus && (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {/* Check status indicator */}
      {prSummary?.failingCheckCount != null && prSummary.failingCheckCount > 0 ? (
        <span className="flex items-center gap-0.5">
          <XCircle className="h-3 w-3 text-status-error" />
          <span className="text-2xs text-status-error">{prSummary.failingCheckCount}</span>
        </span>
      ) : prSummary?.failingCheckCount === 0 ? (
        <CheckCircle className="h-3 w-3 text-diff-added" />
      ) : null}
      {/* Review status indicator */}
      {prSummary?.reviewDecision === "changes_requested" && (
        <RefreshCw className="h-3 w-3 text-status-busy" />
      )}
      {prSummary?.reviewDecision == null && worktree.prStatus && !worktree.prStatus.draft && (
        <Eye className="h-3 w-3 text-text-tertiary" />
      )}
      {/* Comment count */}
      {prSummary?.unresolvedCommentCount != null && prSummary.unresolvedCommentCount > 0 && (
        <span className="flex items-center gap-0.5">
          <MessageCircle className="h-3 w-3 text-text-tertiary" />
          <span className="text-2xs text-text-tertiary">{prSummary.unresolvedCommentCount}</span>
        </span>
      )}
      {/* PR number */}
      <span className="text-2xs text-text-tertiary">
        #{worktree.prStatus.number}
      </span>
    </div>
  )}
</div>
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/AgentItem.tsx
git commit -m "feat(sidebar): add PR status indicator icons (checks, reviews, comments) to worktree items"
```

---

## Task 12: Frontend — "Ask Claude to Fix" Integration

**Files:**
- Modify: `src/components/pr/PrDetailPanel.tsx`
- Modify: `src/api.ts` (if needed)

This task wires the "Ask Claude to fix" button to actually send a prompt to the worktree's Claude session.

- [ ] **Step 1: Understand the session write flow**

The app writes to Claude sessions via `writePty(sessionId, data)` which sends raw bytes to the terminal. We need to:
1. Find the active Claude session for the worktree
2. Compose the triage-then-fix prompt
3. Write it to the session

- [ ] **Step 2: Add a helper to find or create a Claude session for a worktree**

In `PrDetailPanel.tsx`, add a helper function:

```tsx
import { writePty, spawnPty } from "../../api";
import { Channel } from "@tauri-apps/api/core";
import type { PtyEvent } from "../../types";

async function sendToClaudeSession(
  worktreeId: string,
  worktreePath: string,
  prompt: string,
) {
  const store = useWorkspaceStore.getState();
  const tabs = store.tabs[worktreeId] ?? [];

  // Find the first claude tab's session
  const claudeTab = tabs.find((t) => t.type === "claude");
  if (!claudeTab) {
    // No claude tab — could create one, but for now just warn
    console.warn("No Claude session found for worktree", worktreeId);
    return;
  }

  // Find the session for this tab
  const sessions = store.sessions[worktreeId] ?? {};
  const sessionId = sessions[claudeTab.id];

  if (!sessionId) {
    console.warn("No active session for Claude tab", claudeTab.id);
    return;
  }

  // Write the prompt to the PTY (as if the user typed it)
  const encoder = new TextEncoder();
  const bytes = Array.from(encoder.encode(prompt + "\n"));
  await writePty(sessionId, bytes);

  // Switch to the Claude tab
  store.setActiveTab(worktreeId, claudeTab.id);
}
```

- [ ] **Step 3: Compose the triage-then-fix prompt**

Update `handleAskClaudeFix` in `PrDetailPanel.tsx`:

```tsx
const handleAskClaudeFix = async (logs: WorkflowRunLog[]) => {
  // If no logs provided (from "fix all" button), fetch them for all failing checks
  let allLogs = logs;
  if (allLogs.length === 0) {
    const failingRuns = checkRuns.filter(
      (r) =>
        (r.conclusion === "failure" || r.conclusion === "timed_out") &&
        r.checkSuiteId,
    );
    const logPromises = failingRuns.map((r) =>
      getWorkflowLog(repoPath, r.checkSuiteId!).catch(() => []),
    );
    const results = await Promise.all(logPromises);
    allLogs = results.flat();
  }

  if (allLogs.length === 0) {
    console.warn("No failure logs to send to Claude");
    return;
  }

  const logSection = allLogs
    .map(
      (log) =>
        `### ${log.jobName} / ${log.stepName}\n\`\`\`\n${log.logExcerpt}\n\`\`\``,
    )
    .join("\n\n");

  const prompt = `CI is failing on this branch. Here are the failure logs:

${logSection}

Please triage each failure:
1. Is this a real bug in my code, a flaky test, or a test that needs updating?
2. Skip flaky tests (timing issues, network flakes) — just flag them
3. If the test is correct and code is wrong, fix the code. If code is correct and test is wrong, fix the test.
4. Report back what you found and what you're fixing before pushing`;

  await sendToClaudeSession(worktree.id, worktree.path, prompt);
};
```

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit`
Expected: No type errors. The `sendToClaudeSession` function depends on the store shape — verify `sessions` and `setActiveTab` exist by reading the store.

Note: The store may need a `sessions` field mapping `worktreeId -> { tabId -> sessionId }`. Check the existing store structure and adapt accordingly. The exact shape depends on how sessions are currently tracked — this may need adjustment during implementation.

- [ ] **Step 5: Commit**

```bash
git add src/components/pr/PrDetailPanel.tsx
git commit -m "feat(pr): wire Ask Claude to Fix to send triage prompt to worktree's Claude session"
```

---

## Task 13: Frontend — Inline Comment Indicators on Diff

**Files:**
- Create: `src/components/changes/DiffCommentIndicator.tsx`
- Create: `src/components/changes/DiffCommentThread.tsx`
- Modify: `src/components/changes/FileCard.tsx`

- [ ] **Step 1: Create `DiffCommentIndicator.tsx`**

```tsx
import { MessageCircle } from "lucide-react";

interface DiffCommentIndicatorProps {
  count: number;
  onClick: () => void;
}

function DiffCommentIndicator({ count, onClick }: DiffCommentIndicatorProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-0.5 text-accent-primary hover:text-accent-hover"
      title={`${count} comment${count > 1 ? "s" : ""}`}
    >
      <MessageCircle className="h-3 w-3" />
      {count > 1 && <span className="text-2xs">{count}</span>}
    </button>
  );
}

export { DiffCommentIndicator };
```

- [ ] **Step 2: Create `DiffCommentThread.tsx`**

```tsx
import { ExternalLink } from "lucide-react";
import type { PrComment } from "../../types";

interface DiffCommentThreadProps {
  comments: PrComment[];
}

function DiffCommentThread({ comments }: DiffCommentThreadProps) {
  return (
    <div className="bg-bg-surface border border-border-subtle rounded mx-2 my-1 p-3">
      {comments.map((comment) => (
        <div key={comment.id} className="mb-2 last:mb-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-text-secondary font-medium">
              @{comment.author}
            </span>
            <span className="text-text-tertiary">
              {new Date(comment.createdAt).toLocaleDateString()}
            </span>
            <a
              href={comment.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ml-auto text-text-tertiary hover:text-accent-primary"
            >
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
          </div>
          <p className="text-xs text-text-secondary mt-1 whitespace-pre-wrap">
            {comment.body}
          </p>
        </div>
      ))}
    </div>
  );
}

export { DiffCommentThread };
```

- [ ] **Step 3: Integrate into `FileCard.tsx`**

This step requires reading `FileCard.tsx` to understand the diff line rendering. The comment indicators need to be placed in the line number gutter, and the thread needs to expand below the line.

Read `FileCard.tsx` during implementation to determine the exact integration point. The general approach:

1. Accept a `comments` prop: `comments?: PrComment[]`
2. Group comments by line number: `commentsByLine = groupBy(comments, c => c.line)`
3. For each diff line that has comments, render a `DiffCommentIndicator` in the gutter
4. Track which lines have expanded threads in local state: `expandedLines: Set<number>`
5. When indicator is clicked, toggle the line in `expandedLines`
6. After the diff line row, if expanded, render `<DiffCommentThread comments={commentsByLine[line]} />`

The `comments` prop comes from the PR detail state in the store, filtered to the file's path.

- [ ] **Step 4: Add a comment count badge to the Changes tab**

In `AppShell.tsx`, the tab bar renders tab labels. Add a badge for unresolved comment count when the Changes tab is shown and the worktree has PR comments.

Read the tab rendering section of `AppShell.tsx` during implementation to find the exact integration point. Add a small count badge next to the "Changes" tab label.

- [ ] **Step 5: Verify it compiles**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/changes/DiffCommentIndicator.tsx src/components/changes/DiffCommentThread.tsx src/components/changes/FileCard.tsx src/components/layout/AppShell.tsx
git commit -m "feat(changes): add inline PR comment indicators and expandable threads on diff lines"
```

---

## Task 14: Visual Verification and Polish

- [ ] **Step 1: Build and run the app**

Run: `cd /Users/chloe/dev/alfredo && npm run tauri dev`

- [ ] **Step 2: Verify PR tab blocker dashboard**

Open a worktree with an existing PR. Check that:
- PR header shows title, state, and merge readiness count
- Checks section is collapsible and shows check runs
- Failed checks are expanded by default with log excerpts
- Reviews section shows reviewer status
- Comments section shows unresolved comments
- Conflicts section appears only when `mergeable === false`

- [ ] **Step 3: Verify sidebar indicators**

Check that worktrees with PRs show:
- Check status icon (green check or red X with count)
- Review status icon (refresh for changes requested, eye for awaiting)
- Comment count badge
- PR number

- [ ] **Step 4: Verify "Ask Claude to fix" flow**

Click "Ask Claude to fix" on a failing check run. Verify:
- Switches to the Claude tab
- Prompt appears in the terminal with failure logs
- Triage instructions are included

- [ ] **Step 5: Fix any visual issues**

Address spacing, alignment, color, or layout issues found during manual testing.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "fix(pr): visual polish and fixes from manual testing"
```
