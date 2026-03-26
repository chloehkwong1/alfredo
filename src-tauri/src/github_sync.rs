use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tokio::time;

use crate::config_manager;
use crate::github_manager::{determine_column, GithubManager};
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
#[tauri::command]
pub async fn set_sync_repo_path(
    state: tauri::State<'_, SyncState>,
    repo_path: String,
) -> Result<(), String> {
    let mut path = state.repo_path.lock().map_err(|e| e.to_string())?;
    *path = Some(repo_path);
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

    // Prefer a fresh token from gh CLI; fall back to stored config token
    let token = match get_gh_token().await {
        Some(t) => t,
        None => match config.github_token {
            Some(t) => t,
            None => return Ok(()), // No token — silently skip
        },
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

    let payload = PrUpdatePayload {
        prs: prs.iter().map(PrStatusWithColumn::from).collect(),
    };

    app_handle
        .emit("github:pr-update", &payload)
        .map_err(|e| format!("failed to emit event: {e}"))?;

    Ok(())
}

/// Get a fresh token from `gh auth token`, if available.
async fn get_gh_token() -> Option<String> {
    let output = tokio::process::Command::new("gh")
        .args(["auth", "token"])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let token = String::from_utf8(output.stdout).ok()?;
    let token = token.trim().to_string();
    if token.is_empty() { None } else { Some(token) }
}

/// Extract owner and repo from a GitHub URL (HTTPS or SSH).
fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
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
        };
        let with_col = PrStatusWithColumn::from(&pr);
        assert_eq!(with_col.auto_column, "done");
    }
}
