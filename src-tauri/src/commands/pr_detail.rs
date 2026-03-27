use crate::github_manager;
use crate::types::{AppError, PrDetailedStatus};

type Result<T> = std::result::Result<T, AppError>;

/// Fetch detailed PR info (reviews, comments, mergeable status).
/// Called on-demand when the PR tab is opened.
#[tauri::command]
pub async fn get_pr_detail(
    repo_path: String,
    pr_number: u64,
) -> Result<PrDetailedStatus> {
    let (manager, owner, repo) = github_manager::github_context(&repo_path).await?;
    manager.get_pr_detail(&owner, &repo, pr_number).await
}
