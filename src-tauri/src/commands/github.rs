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
