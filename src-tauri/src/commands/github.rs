use crate::types::{AppError, PrStatus};

type Result<T> = std::result::Result<T, AppError>;

/// Fetch all open PRs for the configured repository.
#[tauri::command]
pub async fn sync_pr_status(repo_path: String) -> Result<Vec<PrStatus>> {
    let _ = repo_path;
    Err(AppError::Github("not yet implemented".into()))
}

/// Get the PR associated with a specific branch, if any.
#[tauri::command]
pub async fn get_pr_for_branch(
    owner: String,
    repo: String,
    branch: String,
) -> Result<Option<PrStatus>> {
    let _ = (owner, repo, branch);
    Err(AppError::Github("not yet implemented".into()))
}
