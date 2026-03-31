# Smart Sorting for Worktree Creation Pickers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sort PRs, branches, and Linear issues in the Create Worktree dialog so the user's own recent items appear first.

**Architecture:** Backend sorting in Rust before returning data to the frontend. Each data source gets a sort function that partitions items into "mine" vs "others", then sorts each partition by recency. No frontend changes needed — sorting is transparent.

**Tech Stack:** Rust (git2, octocrab, reqwest/GraphQL), TypeScript types (read-only additions)

---

### Task 1: Add `requested_reviewers` to PrStatus

**Files:**
- Modify: `src-tauri/src/types.rs:107-132` (PrStatus struct)
- Modify: `src-tauri/src/github_manager.rs:7-29` (pr_status_from_octocrab)
- Modify: `src/types.ts:66-79` (frontend PrStatus interface)

- [ ] **Step 1: Add `requested_reviewers` field to Rust `PrStatus`**

In `src-tauri/src/types.rs`, add a new field after `author`:

```rust
    /// GitHub logins of users requested to review this PR.
    #[serde(default)]
    pub requested_reviewers: Vec<String>,
```

- [ ] **Step 2: Extract `requested_reviewers` in `pr_status_from_octocrab`**

In `src-tauri/src/github_manager.rs`, update `pr_status_from_octocrab` to populate the new field. The octocrab `PullRequest` model has `requested_reviewers: Option<Vec<Author>>`. Add this to the struct literal:

```rust
        requested_reviewers: pr
            .requested_reviewers
            .unwrap_or_default()
            .iter()
            .map(|r| r.login.clone())
            .collect(),
```

- [ ] **Step 3: Update all PrStatus struct literals in tests**

Every test that constructs a `PrStatus` needs the new field. Search for `PrStatus {` in `github_manager.rs` and `github_sync.rs` and add `requested_reviewers: vec![],` to each. There are instances at approximately:

- `src-tauri/src/github_manager.rs` lines 811-825, 831-845, 851-865, 871-885, 891-905 (5 test PrStatus literals)
- `src-tauri/src/github_sync.rs` lines 303-320, 324-340, 345-361, 366-382 (4 test PrStatus literals)

- [ ] **Step 4: Add field to frontend TypeScript type**

In `src/types.ts`, add to the `PrStatus` interface after `author`:

```typescript
  requestedReviewers?: string[];
```

- [ ] **Step 5: Verify it compiles**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: no errors

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 6: Run existing tests**

Run: `cd src-tauri && cargo test 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/types.rs src-tauri/src/github_manager.rs src/types.ts
git commit -m "feat: add requested_reviewers field to PrStatus"
```

---

### Task 2: Sort PRs — mine first, then by recency

**Files:**
- Modify: `src-tauri/src/commands/github.rs` (sort before returning)
- Modify: `src-tauri/src/github_sync.rs:280-294` (reuse resolve_github_username or make it pub)

- [ ] **Step 1: Write the sorting test**

In `src-tauri/src/commands/github.rs`, add a test module at the bottom of the file:

```rust
#[cfg(test)]
mod tests {
    use crate::types::PrStatus;

    fn make_pr(number: u64, author: &str, draft: bool, updated_at: &str, reviewers: Vec<&str>) -> PrStatus {
        PrStatus {
            number,
            state: "open".into(),
            title: format!("PR #{number}"),
            url: String::new(),
            draft,
            merged: false,
            branch: format!("branch-{number}"),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            body: None,
            updated_at: Some(updated_at.into()),
            author: Some(author.into()),
            requested_reviewers: reviewers.into_iter().map(String::from).collect(),
        }
    }

    #[test]
    fn test_sort_prs_mine_first() {
        let mut prs = vec![
            make_pr(1, "other", false, "2026-03-01T00:00:00Z", vec![]),       // other's PR
            make_pr(2, "chloe", false, "2026-03-02T00:00:00Z", vec![]),       // my PR
            make_pr(3, "other", false, "2026-03-03T00:00:00Z", vec!["chloe"]),// assigned to me for review
            make_pr(4, "chloe", true,  "2026-03-04T00:00:00Z", vec![]),       // my draft
            make_pr(5, "other", true,  "2026-03-05T00:00:00Z", vec![]),       // other's draft
            make_pr(6, "other", false, "2026-03-06T00:00:00Z", vec![]),       // other's PR (newer)
        ];

        super::sort_prs(&mut prs, Some("chloe"));

        let numbers: Vec<u64> = prs.iter().map(|p| p.number).collect();
        // Expected: review-assigned(3), my non-draft(2), my draft(4), others non-draft by recency(6,1), others draft(5)
        assert_eq!(numbers, vec![3, 2, 4, 6, 1, 5]);
    }

    #[test]
    fn test_sort_prs_no_username_falls_back_to_recency() {
        let mut prs = vec![
            make_pr(1, "a", false, "2026-03-01T00:00:00Z", vec![]),
            make_pr(2, "b", false, "2026-03-03T00:00:00Z", vec![]),
            make_pr(3, "c", false, "2026-03-02T00:00:00Z", vec![]),
        ];

        sort_prs(&mut prs, None);

        let numbers: Vec<u64> = prs.iter().map(|p| p.number).collect();
        // All non-draft, no username -> just sort by updated_at desc
        assert_eq!(numbers, vec![2, 3, 1]);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib commands::github::tests 2>&1 | tail -10`
Expected: FAIL — `sort_prs` not found

- [ ] **Step 3: Implement `sort_prs`**

In `src-tauri/src/commands/github.rs`, add above the test module:

```rust
/// Sort priority bucket for a PR relative to the current user.
fn pr_sort_bucket(pr: &PrStatus, username: Option<&str>) -> u8 {
    let is_mine = match (pr.author.as_deref(), username) {
        (Some(author), Some(user)) => author.eq_ignore_ascii_case(user),
        _ => false,
    };
    let assigned_to_review = username
        .map(|u| pr.requested_reviewers.iter().any(|r| r.eq_ignore_ascii_case(u)))
        .unwrap_or(false);

    match (assigned_to_review, is_mine, pr.draft) {
        (true, _, _)      => 0, // Assigned to me for review
        (_, true, false)   => 1, // My non-draft PR
        (_, true, true)    => 2, // My draft PR
        (_, false, false)  => 3, // Others' non-draft PR
        (_, false, true)   => 4, // Others' draft PR
    }
}

/// Sort PRs: mine first (review-assigned → my open → my draft → others' open → others' draft),
/// then by `updated_at` descending within each group.
pub fn sort_prs(prs: &mut [PrStatus], username: Option<&str>) {
    prs.sort_by(|a, b| {
        let bucket_a = pr_sort_bucket(a, username);
        let bucket_b = pr_sort_bucket(b, username);
        bucket_a.cmp(&bucket_b).then_with(|| {
            // Within same bucket, sort by updated_at descending
            b.updated_at.cmp(&a.updated_at)
        })
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib commands::github::tests 2>&1 | tail -10`
Expected: both tests PASS

- [ ] **Step 5: Make `resolve_github_username` public**

In `src-tauri/src/github_sync.rs`, change line 281 from:

```rust
async fn resolve_github_username() -> Option<String> {
```

to:

```rust
pub async fn resolve_github_username() -> Option<String> {
```

- [ ] **Step 6: Wire sorting into `sync_pr_status` command**

In `src-tauri/src/commands/github.rs`, update the `sync_pr_status` command to sort before returning:

```rust
use crate::github_manager::{self, GithubManager};
use crate::github_sync;
use crate::types::{AppError, PrStatus};

type Result<T> = std::result::Result<T, AppError>;

/// Fetch all open PRs for the configured repository.
#[tauri::command]
pub async fn sync_pr_status(repo_path: String) -> Result<Vec<PrStatus>> {
    let (manager, owner, repo) = github_manager::github_context(&repo_path).await?;
    let mut prs = manager.sync_prs(&owner, &repo).await?;
    let username = github_sync::resolve_github_username().await;
    sort_prs(&mut prs, username.as_deref());
    Ok(prs)
}
```

- [ ] **Step 7: Verify it compiles and all tests pass**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: no errors

Run: `cd src-tauri && cargo test 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/commands/github.rs src-tauri/src/github_sync.rs
git commit -m "feat: sort PRs by ownership and recency in worktree picker"
```

---

### Task 3: Sort branches — mine first, then by recency, filter main/master

**Files:**
- Modify: `src-tauri/src/branch_manager.rs:8-57` (list_branches)

- [ ] **Step 1: Write the sorting test**

In `src-tauri/src/branch_manager.rs`, add a new test to the existing `tests` module:

```rust
    #[test]
    fn test_sort_branches_mine_first_and_filters_default() -> Result<(), Box<dyn std::error::Error>> {
        let dir = init_test_repo()?;
        let path = dir.path().to_str().ok_or("non-UTF-8 temp path")?;

        // Create additional branches with commits
        StdCommand::new("git")
            .args(["checkout", "-b", "feat-old"])
            .current_dir(path)
            .output()?;
        StdCommand::new("git")
            .args(["commit", "--allow-empty", "-m", "old work"])
            .current_dir(path)
            .output()?;

        StdCommand::new("git")
            .args(["checkout", "-b", "feat-new"])
            .current_dir(path)
            .output()?;
        StdCommand::new("git")
            .args(["commit", "--allow-empty", "-m", "new work"])
            .current_dir(path)
            .output()?;

        let (branches, _) = list_branches(path)?;

        // main/master should be filtered out
        assert!(branches.iter().all(|b| b.branch != "main" && b.branch != "master"));

        // Should be sorted by recency (feat-new before feat-old)
        let names: Vec<&str> = branches.iter().map(|b| b.branch.as_str()).collect();
        let new_idx = names.iter().position(|n| *n == "feat-new");
        let old_idx = names.iter().position(|n| *n == "feat-old");
        assert!(new_idx < old_idx, "feat-new should appear before feat-old");

        Ok(())
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib branch_manager::tests::test_sort_branches 2>&1 | tail -10`
Expected: FAIL — main/master is not filtered, order is wrong

- [ ] **Step 3: Implement sorting and filtering in `list_branches`**

In `src-tauri/src/branch_manager.rs`, update the `list_branches` function. After the `for` loop that builds the `worktrees` vec, and before the `Ok(...)` return, add:

```rust
    // Read the local git user name for "my branches" prioritization
    let git_user = repo
        .config()
        .ok()
        .and_then(|c| c.get_string("user.name").ok());

    // Filter out default branches (main/master) — not useful as worktree sources
    worktrees.retain(|w| w.branch != "main" && w.branch != "master");

    // Sort: my branches first (by last commit author), then by recency
    worktrees.sort_by(|a, b| {
        let a_mine = is_my_branch(a, git_user.as_deref());
        let b_mine = is_my_branch(b, git_user.as_deref());
        b_mine.cmp(&a_mine).then_with(|| {
            // Within same group, sort by last_commit_epoch descending
            b.last_commit_epoch.cmp(&a.last_commit_epoch)
        })
    });
```

Also add a `last_commit_author` field to the `Worktree` push inside the loop. Change the existing block to:

```rust
        let (last_commit_epoch, last_commit_author) = branch
            .get()
            .peel_to_commit()
            .ok()
            .map(|c| (Some(c.time().seconds() * 1000), c.author().name().map(String::from)))
            .unwrap_or((None, None));

        worktrees.push(Worktree {
            id: format!("branch-{name}"),
            name: name.clone(),
            path: repo_path.to_string(),
            branch: name,
            repo_path: repo_path.to_string(),
            pr_status: None,
            agent_status: AgentState::NotRunning,
            column: KanbanColumn::InProgress,
            is_branch_mode: true,
            additions: None,
            deletions: None,
            last_commit_epoch,
            last_commit_author,
        });
```

Add the helper function above `list_branches`:

```rust
/// Check if a branch's last commit was authored by the local git user.
fn is_my_branch(worktree: &Worktree, git_user: Option<&str>) -> bool {
    match (worktree.last_commit_author.as_deref(), git_user) {
        (Some(author), Some(user)) => author.eq_ignore_ascii_case(user),
        _ => false,
    }
}
```

- [ ] **Step 4: Add `last_commit_author` to `Worktree` struct**

In `src-tauri/src/types.rs`, add to the `Worktree` struct after `last_commit_epoch`:

```rust
    /// Name of the author of the latest commit on this branch (for sorting).
    #[serde(default)]
    pub last_commit_author: Option<String>,
```

- [ ] **Step 5: Update all other `Worktree` struct literals**

Search for `Worktree {` across the codebase to find any other construction sites. Add `last_commit_author: None,` to each. Key locations:

- `src-tauri/src/commands/worktree.rs` — search for `Worktree {` literals
- `src-tauri/src/git_manager.rs` — search for `Worktree {` literals

Run: `cd src-tauri && grep -rn "Worktree {" src/ | grep -v test | grep -v "^src/types.rs"`

Add `last_commit_author: None,` to every hit that doesn't already have it.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib branch_manager::tests 2>&1 | tail -15`
Expected: all tests pass (including the new one)

- [ ] **Step 7: Run full test suite**

Run: `cd src-tauri && cargo test 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/branch_manager.rs src-tauri/src/types.rs src-tauri/src/commands/worktree.rs src-tauri/src/git_manager.rs
git commit -m "feat: sort branches by ownership and recency, filter main/master"
```

---

### Task 4: Add `updated_at` to Linear tickets and fetch viewer name

**Files:**
- Modify: `src-tauri/src/types.rs:354-365` (LinearTicket struct)
- Modify: `src-tauri/src/linear_manager.rs` (GraphQL queries + viewer function)
- Modify: `src/types.ts:161-170` (frontend LinearTicket interface)

- [ ] **Step 1: Write the viewer query test**

In `src-tauri/src/linear_manager.rs`, add to the existing `tests` module:

```rust
    #[test]
    fn test_parse_viewer_response() {
        let json: serde_json::Value = serde_json::json!({
            "data": {
                "viewer": {
                    "id": "abc-123",
                    "name": "Chloe",
                    "email": "chloe@example.com"
                }
            }
        });

        let name = json
            .pointer("/data/viewer/name")
            .and_then(|v| v.as_str())
            .map(String::from);

        assert_eq!(name, Some("Chloe".into()));
    }

    #[test]
    fn test_parse_issue_with_updated_at() {
        let node = serde_json::json!({
            "id": "issue-1",
            "identifier": "ALF-1",
            "title": "Test issue",
            "description": null,
            "url": "https://linear.app/test/issue/ALF-1",
            "state": { "name": "In Progress" },
            "labels": { "nodes": [] },
            "assignee": { "name": "Chloe" },
            "updatedAt": "2026-03-31T12:00:00.000Z"
        });

        let ticket = parse_issue_node(&node).unwrap();
        assert_eq!(ticket.updated_at, Some("2026-03-31T12:00:00.000Z".into()));
        assert_eq!(ticket.assignee, Some("Chloe".into()));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib linear_manager::tests::test_parse_issue_with_updated_at 2>&1 | tail -10`
Expected: FAIL — `updated_at` field doesn't exist on `LinearTicket`

- [ ] **Step 3: Add `updated_at` to `LinearTicket` struct**

In `src-tauri/src/types.rs`, add to `LinearTicket` after `assignee`:

```rust
    #[serde(default)]
    pub updated_at: Option<String>,
```

In `src/types.ts`, add to the `LinearTicket` interface after `assignee`:

```typescript
  updatedAt?: string | null;
```

- [ ] **Step 4: Add `updatedAt` to GraphQL queries and parse it**

In `src-tauri/src/linear_manager.rs`, update the `search_issues` GraphQL query (around line 36-57) to include `updatedAt` in the fields:

```rust
    let graphql_query = format!(
        r#"{{
  searchIssues(term: "{query}"{team_filter}, first: 25) {{
    nodes {{
      id
      identifier
      title
      description
      url
      updatedAt
      state {{
        name
      }}
      labels {{
        nodes {{
          name
        }}
      }}
      assignee {{
        name
      }}
    }}
  }}
}}"#
    );
```

Also update the `get_issue` GraphQL query (around line 101-122) to include `updatedAt`:

```rust
    let graphql_query = format!(
        r#"{{
  issue(id: "{issue_id}") {{
    id
    identifier
    title
    description
    url
    updatedAt
    state {{
      name
    }}
    labels {{
      nodes {{
        name
      }}
    }}
    assignee {{
      name
    }}
  }}
}}"#
    );
```

- [ ] **Step 5: Parse `updatedAt` in `parse_issue_node`**

In `src-tauri/src/linear_manager.rs`, update `parse_issue_node` to extract the new field. Add before the `Ok(LinearTicket { ... })` return:

```rust
    let updated_at = node
        .get("updatedAt")
        .and_then(|v| v.as_str())
        .map(std::string::ToString::to_string);
```

And add `updated_at,` to the `LinearTicket` struct literal.

- [ ] **Step 6: Add `get_viewer` function**

In `src-tauri/src/linear_manager.rs`, add after `list_teams`:

```rust
/// Fetch the authenticated Linear user's display name via the `viewer` query.
pub async fn get_viewer_name(api_key: &str) -> Result<Option<String>, AppError> {
    let graphql_query = r#"{ viewer { id name } }"#;
    let body = serde_json::json!({ "query": graphql_query });

    let resp = client(api_key)?
        .post(GRAPHQL_ENDPOINT)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Linear(format!("viewer request failed: {e}")))?;

    if !resp.status().is_success() {
        return Ok(None); // Gracefully degrade — sorting still works by recency
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Linear(format!("failed to parse viewer response: {e}")))?;

    Ok(json
        .pointer("/data/viewer/name")
        .and_then(|v| v.as_str())
        .map(String::from))
}
```

- [ ] **Step 7: Update the existing `test_generate_context_md` test**

In `src-tauri/src/linear_manager.rs`, update the `LinearTicket` literal in `test_generate_context_md` (around line 373) to include the new field:

```rust
            assignee: Some("Chloe".into()),
            updated_at: Some("2026-03-31T12:00:00.000Z".into()),
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd src-tauri && cargo test --lib linear_manager::tests 2>&1 | tail -15`
Expected: all tests pass

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/types.rs src-tauri/src/linear_manager.rs src/types.ts
git commit -m "feat: add updatedAt to Linear tickets and viewer query"
```

---

### Task 5: Sort Linear issues — assigned to me first, then by recency

**Files:**
- Modify: `src-tauri/src/commands/linear.rs` (sort before returning)

- [ ] **Step 1: Write the sorting test**

In `src-tauri/src/commands/linear.rs`, add a test module:

```rust
#[cfg(test)]
mod tests {
    use crate::types::LinearTicket;

    fn make_ticket(id: &str, assignee: Option<&str>, updated_at: &str) -> LinearTicket {
        LinearTicket {
            id: id.into(),
            identifier: format!("ALF-{id}"),
            title: format!("Ticket {id}"),
            description: None,
            url: String::new(),
            state: "In Progress".into(),
            labels: vec![],
            assignee: assignee.map(String::from),
            updated_at: Some(updated_at.into()),
        }
    }

    #[test]
    fn test_sort_linear_issues_assigned_first() {
        let mut tickets = vec![
            make_ticket("1", None, "2026-03-01T00:00:00Z"),
            make_ticket("2", Some("Chloe"), "2026-03-02T00:00:00Z"),
            make_ticket("3", Some("Other"), "2026-03-03T00:00:00Z"),
            make_ticket("4", Some("Chloe"), "2026-03-04T00:00:00Z"),
        ];

        super::sort_linear_issues(&mut tickets, Some("Chloe"));

        let ids: Vec<&str> = tickets.iter().map(|t| t.id.as_str()).collect();
        // Mine by recency first (4, 2), then others by recency (3, 1)
        assert_eq!(ids, vec!["4", "2", "3", "1"]);
    }

    #[test]
    fn test_sort_linear_issues_no_viewer_falls_back_to_recency() {
        let mut tickets = vec![
            make_ticket("1", Some("A"), "2026-03-01T00:00:00Z"),
            make_ticket("2", Some("B"), "2026-03-03T00:00:00Z"),
            make_ticket("3", None,      "2026-03-02T00:00:00Z"),
        ];

        super::sort_linear_issues(&mut tickets, None);

        let ids: Vec<&str> = tickets.iter().map(|t| t.id.as_str()).collect();
        // No viewer -> just recency
        assert_eq!(ids, vec!["2", "3", "1"]);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test --lib commands::linear::tests 2>&1 | tail -10`
Expected: FAIL — `sort_linear_issues` not found

- [ ] **Step 3: Implement `sort_linear_issues`**

In `src-tauri/src/commands/linear.rs`, add above the test module:

```rust
/// Sort Linear issues: assigned-to-me first, then by `updated_at` descending.
pub fn sort_linear_issues(tickets: &mut [LinearTicket], viewer_name: Option<&str>) {
    tickets.sort_by(|a, b| {
        let a_mine = is_my_ticket(a, viewer_name);
        let b_mine = is_my_ticket(b, viewer_name);
        b_mine.cmp(&a_mine).then_with(|| {
            b.updated_at.cmp(&a.updated_at)
        })
    });
}

fn is_my_ticket(ticket: &LinearTicket, viewer_name: Option<&str>) -> bool {
    match (ticket.assignee.as_deref(), viewer_name) {
        (Some(assignee), Some(viewer)) => assignee.eq_ignore_ascii_case(viewer),
        _ => false,
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test --lib commands::linear::tests 2>&1 | tail -10`
Expected: both tests PASS

- [ ] **Step 5: Wire sorting into `search_linear_issues` command**

Update the `search_linear_issues` command in `src-tauri/src/commands/linear.rs`:

```rust
/// Search Linear issues by query text, optionally filtered by team.
#[tauri::command]
pub async fn search_linear_issues(
    query: String,
    team_id: Option<String>,
) -> Result<Vec<LinearTicket>> {
    let api_key = get_api_key(".").await?;
    let mut tickets = linear_manager::search_issues(&api_key, &query, team_id.as_deref()).await?;
    let viewer_name = linear_manager::get_viewer_name(&api_key).await.unwrap_or(None);
    sort_linear_issues(&mut tickets, viewer_name.as_deref());
    Ok(tickets)
}
```

- [ ] **Step 6: Verify it compiles and all tests pass**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: no errors

Run: `cd src-tauri && cargo test 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/linear.rs
git commit -m "feat: sort Linear issues by assignment and recency in worktree picker"
```

---

### Task 6: Cache Linear viewer name to avoid repeated API calls

**Files:**
- Modify: `src-tauri/src/commands/linear.rs` (add caching)

- [ ] **Step 1: Add a static cache for viewer name**

In `src-tauri/src/commands/linear.rs`, add at the top after imports:

```rust
use std::sync::OnceLock;

/// Cached Linear viewer name, fetched once per app session.
static LINEAR_VIEWER_NAME: OnceLock<Option<String>> = OnceLock::new();

async fn get_viewer_name_cached(api_key: &str) -> Option<String> {
    LINEAR_VIEWER_NAME
        .get_or_init(|| {
            // OnceLock::get_or_init is sync, so we can't await here.
            // Instead, we'll use a different pattern.
            None
        })
        .clone()
}
```

Actually, since `OnceLock` doesn't support async init, use `tokio::sync::OnceCell` instead:

```rust
use tokio::sync::OnceCell;

/// Cached Linear viewer name, fetched once per app session.
static LINEAR_VIEWER_NAME: OnceCell<Option<String>> = OnceCell::const_new();

async fn get_viewer_name_cached(api_key: &str) -> Option<String> {
    LINEAR_VIEWER_NAME
        .get_or_init(|| async {
            linear_manager::get_viewer_name(api_key).await.unwrap_or(None)
        })
        .await
        .clone()
}
```

- [ ] **Step 2: Update `search_linear_issues` to use cache**

Replace the `get_viewer_name` call with:

```rust
    let viewer_name = get_viewer_name_cached(&api_key).await;
```

- [ ] **Step 3: Verify it compiles and all tests pass**

Run: `cd src-tauri && cargo check 2>&1 | tail -5`
Expected: no errors

Run: `cd src-tauri && cargo test 2>&1 | tail -20`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/commands/linear.rs
git commit -m "feat: cache Linear viewer name for session lifetime"
```

---

### Task 7: Final integration verification

**Files:** None (verification only)

- [ ] **Step 1: Run full Rust test suite**

Run: `cd src-tauri && cargo test 2>&1 | tail -30`
Expected: all tests pass

- [ ] **Step 2: Run TypeScript type check**

Run: `cd /Users/chloe/dev/alfredo && npx tsc --noEmit 2>&1 | tail -10`
Expected: no errors

- [ ] **Step 3: Run clippy**

Run: `cd src-tauri && cargo clippy 2>&1 | tail -20`
Expected: no warnings
