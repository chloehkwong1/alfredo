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
