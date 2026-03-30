use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tokio::time;

use crate::config_manager;
use crate::github_manager::{determine_column, parse_github_owner_repo, GithubManager};
use crate::types::{PrStatus, CheckRun, PrReview, PrComment};

/// Payload emitted on the `github:pr-update` Tauri event.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrUpdatePayload {
    /// All PR statuses fetched from GitHub (matched to branches).
    pub prs: Vec<PrStatusWithColumn>,
}

/// A PR status annotated with the auto-determined kanban column.
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
    /// Number of check runs with a failing conclusion.
    pub failing_check_count: Option<u32>,
    /// Number of unresolved line-level review comments.
    pub unresolved_comment_count: Option<u32>,
    /// Derived review decision: "approved", "changes_requested", or "review_required".
    pub review_decision: Option<String>,
    /// Whether the PR is mergeable per GitHub's assessment.
    pub mergeable: Option<bool>,
    /// PR description body text.
    pub body: Option<String>,
    /// The repo path this PR belongs to, for multi-repo disambiguation.
    pub repo_path: String,
    /// Full check run objects for the PR panel.
    pub check_runs: Vec<CheckRun>,
    /// Full review objects for the PR panel.
    pub reviews: Vec<PrReview>,
    /// Line comments + issue comments merged, for the PR panel.
    pub comments: Vec<PrComment>,
    /// ISO 8601 timestamp of the last update to this PR.
    pub updated_at: Option<String>,
    /// GitHub login of the PR author.
    pub author: Option<String>,
}

impl PrStatusWithColumn {
    fn from_pr(pr: &PrStatus, repo_path: &str, github_username: Option<&str>) -> Self {
        let column = determine_column(Some(pr), github_username);
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
            body: pr.body.clone(),
            failing_check_count: None,
            unresolved_comment_count: None,
            review_decision: None,
            mergeable: None,
            repo_path: repo_path.to_string(),
            check_runs: Vec::new(),
            reviews: Vec::new(),
            comments: Vec::new(),
            updated_at: pr.updated_at.clone(),
            author: pr.author.clone(),
        }
    }
}

/// Start the background GitHub PR sync loop.
///
/// Polls every 30 seconds. Gracefully skips if:
/// - No repo path is managed yet
/// - No GitHub token is configured
/// - GitHub API calls fail (logs warning, continues polling)
pub fn start_sync_loop(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = time::interval(Duration::from_secs(30));

        loop {
            interval.tick().await;

            if let Err(e) = poll_once(&app_handle).await {
                // Log but don't crash — token may not be configured yet
                eprintln!("[github_sync] poll error: {e}");
            }
        }
    });
}

/// Resolve the repo paths from managed state.
fn get_sync_state(app_handle: &AppHandle) -> (Vec<String>, std::collections::HashSet<String>) {
    let Some(state) = app_handle.try_state::<SyncState>() else {
        return (Vec::new(), std::collections::HashSet::new());
    };
    let paths = state.repo_paths.lock().map(|p| p.clone()).unwrap_or_default();
    let branches = state.active_branches.lock().map(|b| b.clone()).unwrap_or_default();
    (paths, branches)
}

/// Managed state to hold the repo paths and active worktree branches for the sync loop.
pub struct SyncState {
    pub repo_paths: std::sync::Mutex<Vec<String>>,
    /// Branches that have active worktrees — only these PRs get full enrichment.
    pub active_branches: std::sync::Mutex<std::collections::HashSet<String>>,
}

/// Set the repo paths and active branches so the sync loop knows what to poll and enrich.
/// Also triggers an immediate poll so worktrees get correct PR status on startup
/// without waiting for the next 30-second tick.
#[tauri::command]
pub async fn set_sync_repo_paths(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, SyncState>,
    repo_paths: Vec<String>,
    active_branches: Vec<String>,
) -> Result<(), String> {
    {
        let mut paths = state.repo_paths.lock().map_err(|e| e.to_string())?;
        *paths = repo_paths;
    }
    {
        let mut branches = state.active_branches.lock().map_err(|e| e.to_string())?;
        *branches = active_branches.into_iter().collect();
    }
    // Fire an immediate poll so the frontend doesn't wait 30s for PR status
    if let Err(e) = poll_once(&app_handle).await {
        eprintln!("[github_sync] immediate poll after set_sync_repo_paths: {e}");
    }
    Ok(())
}

/// Single poll iteration: fetch PRs for all repos and emit event.
async fn poll_once(app_handle: &AppHandle) -> Result<(), String> {
    let (repo_paths, active_branches) = get_sync_state(app_handle);
    if repo_paths.is_empty() {
        return Ok(()); // No repos configured yet — silently skip
    }

    let mut all_prs: Vec<PrStatusWithColumn> = Vec::new();

    for repo_path in &repo_paths {
        match poll_repo(app_handle, repo_path, &active_branches).await {
            Ok(prs) => all_prs.extend(prs),
            Err(e) => {
                eprintln!("[github_sync] error syncing {repo_path}: {e}");
                // Continue with other repos
            }
        }
    }

    if !all_prs.is_empty() {
        app_handle
            .emit("github:pr-update", &PrUpdatePayload { prs: all_prs })
            .map_err(|e| format!("failed to emit event: {e}"))?;
    }

    Ok(())
}

/// Fetch and enrich PRs for a single repo. Returns the enriched PR list.
async fn poll_repo(
    _app_handle: &AppHandle,
    repo_path: &str,
    active_branches: &std::collections::HashSet<String>,
) -> Result<Vec<PrStatusWithColumn>, String> {
    let config = config_manager::load_config(repo_path)
        .await
        .map_err(|e| format!("{e}"))?;

    let token = match crate::github_manager::resolve_token(config.github_token.as_deref()).await {
        Ok(t) => t,
        Err(_) => return Ok(Vec::new()), // No token available — silently skip
    };

    let manager = GithubManager::new(&token).map_err(|e| format!("{e}"))?;

    // Resolve owner/repo from git remote
    let output = tokio::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| format!("failed to get remote URL: {e}"))?;

    if !output.status.success() {
        return Err("no origin remote found".into());
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let (owner, repo) = parse_github_owner_repo(&url)
        .ok_or_else(|| format!("could not parse owner/repo from: {url}"))?;

    let prs = manager
        .sync_prs(&owner, &repo)
        .await
        .map_err(|e| format!("{e}"))?;

    // Resolve the authenticated GitHub username so we can distinguish
    // "In Review" (own PRs) from "Needs Review" (others' PRs).
    let github_username = resolve_github_username().await;

    // Build the initial payload from PrStatus, then enrich open PRs with summary data.
    let mut payload_prs: Vec<PrStatusWithColumn> =
        prs.iter().map(|pr| PrStatusWithColumn::from_pr(pr, repo_path, github_username.as_deref())).collect();

    // Only enrich PRs that have active worktrees — no point fetching details
    // for PRs the user isn't looking at. This keeps API usage proportional to
    // the number of worktrees (typically 2-5), not the total open PRs (can be 80+).
    for pr_with_col in payload_prs.iter_mut() {
        if pr_with_col.merged {
            continue;
        }
        if !active_branches.contains(&pr_with_col.branch) {
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

    Ok(payload_prs)
}

/// Resolve the authenticated GitHub username via `gh api user`.
async fn resolve_github_username() -> Option<String> {
    tokio::process::Command::new("gh")
        .args(["api", "user", "--jq", ".login"])
        .output()
        .await
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
            } else {
                None
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::PrStatus;

    #[test]
    fn test_pr_status_with_column_draft() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: true,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            body: None,
            updated_at: None,
            author: Some("chloe".into()),
        };
        let with_col = PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe"));
        assert_eq!(with_col.auto_column, "draftPr");
    }

    #[test]
    fn test_pr_status_with_column_own_pr() {
        let pr = PrStatus {
            number: 2,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/open".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            body: None,
            updated_at: None,
            author: Some("chloe".into()),
        };
        let with_col = PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe"));
        assert_eq!(with_col.auto_column, "openPr");
    }

    #[test]
    fn test_pr_status_with_column_needs_review() {
        let pr = PrStatus {
            number: 2,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/review".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            body: None,
            updated_at: None,
            author: Some("teammate".into()),
        };
        let with_col = PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe"));
        assert_eq!(with_col.auto_column, "needsReview");
    }

    #[test]
    fn test_pr_status_with_column_merged() {
        let pr = PrStatus {
            number: 3,
            state: "closed".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: true,
            branch: "feat/done".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            body: None,
            updated_at: None,
            author: Some("chloe".into()),
        };
        let with_col = PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe"));
        assert_eq!(with_col.auto_column, "done");
    }
}
