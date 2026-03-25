use crate::commands::github::resolve_owner_repo;
use crate::config_manager;
use crate::github_manager::GithubManager;
use crate::types::{AppError, CheckRun};

type Result<T> = std::result::Result<T, AppError>;

/// Fetch GitHub Actions check runs for a given branch.
#[tauri::command]
pub async fn get_check_runs(repo_path: String, branch: String) -> Result<Vec<CheckRun>> {
    let config = config_manager::load_config(&repo_path).await?;
    let token = config
        .github_token
        .filter(|t| !t.is_empty())
        .ok_or_else(|| AppError::Github("no GitHub token configured".into()))?;

    let manager = GithubManager::new(&token)?;
    let (owner, repo) = resolve_owner_repo(&repo_path).await?;
    manager.get_check_runs(&owner, &repo, &branch).await
}
