use crate::config_manager;
use crate::github_manager::{self, GithubManager};
use crate::types::{AppError, CheckRun};

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
