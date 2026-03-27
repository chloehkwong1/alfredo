use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tokio::time;

use crate::config_manager;
use crate::github_manager::{determine_column, parse_github_owner_repo, GithubManager};
use crate::types::PrStatus;

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
}

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
            failing_check_count: None,
            unresolved_comment_count: None,
            review_decision: None,
            mergeable: None,
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

/// Resolve the repo path from managed state or a well-known location.
/// For now, we read it from the config by checking the first worktree's parent.
/// The app stores the repo path when the user opens a project.
fn get_repo_path(app_handle: &AppHandle) -> Option<String> {
    // The repo path is stored in Tauri managed state if set
    let state = app_handle.try_state::<SyncState>()?;
    let path = state.repo_path.lock().ok()?;
    path.clone()
}

/// Managed state to hold the current repo path for the sync loop.
pub struct SyncState {
    pub repo_path: std::sync::Mutex<Option<String>>,
}

/// Set the repo path so the sync loop knows what to poll.
/// Also triggers an immediate poll so worktrees get correct PR status on startup
/// without waiting for the next 30-second tick.
#[tauri::command]
pub async fn set_sync_repo_path(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, SyncState>,
    repo_path: String,
) -> Result<(), String> {
    {
        let mut path = state.repo_path.lock().map_err(|e| e.to_string())?;
        *path = Some(repo_path);
    }
    // Fire an immediate poll so the frontend doesn't wait 30s for PR status
    if let Err(e) = poll_once(&app_handle).await {
        eprintln!("[github_sync] immediate poll after set_sync_repo_path: {e}");
    }
    Ok(())
}

/// Single poll iteration: fetch PRs and emit event.
async fn poll_once(app_handle: &AppHandle) -> Result<(), String> {
    let repo_path = match get_repo_path(app_handle) {
        Some(p) => p,
        None => return Ok(()), // No repo configured yet — silently skip
    };

    let config = config_manager::load_config(&repo_path)
        .await
        .map_err(|e| format!("{e}"))?;

    let token = match crate::github_manager::resolve_token(config.github_token.as_deref()).await {
        Ok(t) => t,
        Err(_) => return Ok(()), // No token available — silently skip
    };

    let manager = GithubManager::new(&token).map_err(|e| format!("{e}"))?;

    // Resolve owner/repo from git remote
    let output = tokio::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(&repo_path)
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

    // Build the initial payload from PrStatus, then enrich open PRs with summary data.
    let mut payload_prs: Vec<PrStatusWithColumn> = prs.iter().map(PrStatusWithColumn::from).collect();

    // Enrich non-merged PRs with sidebar indicator data (best-effort; errors are silently skipped).
    for pr_with_col in payload_prs.iter_mut() {
        if pr_with_col.merged {
            continue;
        }

        let pr_number = pr_with_col.number;

        // Fetch mergeable status and review decision from the single-PR endpoint.
        if let Some(detail) = manager.get_pr_detail(&owner, &repo, pr_number).await.ok() {
            pr_with_col.mergeable = detail.mergeable;
            pr_with_col.review_decision = detail.review_decision;
            pr_with_col.unresolved_comment_count = Some(detail.comments.len() as u32);
        }

        // Fetch check runs using head_sha for precise results.
        if let Some(ref sha) = pr_with_col.head_sha.clone() {
            if let Some(check_runs) = manager.get_check_runs(&owner, &repo, sha).await.ok() {
                let failing = check_runs.iter().filter(|cr| {
                    matches!(
                        cr.conclusion.as_deref(),
                        Some("failure") | Some("timed_out") | Some("action_required")
                    )
                }).count() as u32;
                pr_with_col.failing_check_count = Some(failing);
            }
        }
    }

    let payload = PrUpdatePayload {
        prs: payload_prs,
    };

    app_handle
        .emit("github:pr-update", &payload)
        .map_err(|e| format!("failed to emit event: {e}"))?;

    Ok(())
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
            url: "".into(),
            draft: true,
            merged: false,
            branch: "feat/test".into(),
            merged_at: None,
            head_sha: None,
        };
        let with_col = PrStatusWithColumn::from(&pr);
        assert_eq!(with_col.auto_column, "draftPr");
    }

    #[test]
    fn test_pr_status_with_column_open() {
        let pr = PrStatus {
            number: 2,
            state: "open".into(),
            title: "test".into(),
            url: "".into(),
            draft: false,
            merged: false,
            branch: "feat/open".into(),
            merged_at: None,
            head_sha: None,
        };
        let with_col = PrStatusWithColumn::from(&pr);
        assert_eq!(with_col.auto_column, "openPr");
    }

    #[test]
    fn test_pr_status_with_column_merged() {
        let pr = PrStatus {
            number: 3,
            state: "closed".into(),
            title: "test".into(),
            url: "".into(),
            draft: false,
            merged: true,
            branch: "feat/done".into(),
            merged_at: None,
            head_sha: None,
        };
        let with_col = PrStatusWithColumn::from(&pr);
        assert_eq!(with_col.auto_column, "done");
    }
}
