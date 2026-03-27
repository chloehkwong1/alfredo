use crate::config_manager;
use crate::github_manager::{self, GithubManager};
use crate::types::{AppError, CheckRun, WorkflowRunLog};

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

/// Re-run failed jobs for a workflow run (identified via check suite ID).
#[tauri::command]
pub async fn rerun_failed_checks(repo_path: String, check_suite_id: u64) -> Result<()> {
    let config = config_manager::load_config(&repo_path).await?;
    let token = github_manager::resolve_token(config.github_token.as_deref()).await?;
    let manager = GithubManager::new(&token)?;
    let (owner, repo) = github_manager::resolve_owner_repo(&repo_path).await?;

    let run_id = manager
        .get_workflow_run_id_for_check_suite(&owner, &repo, check_suite_id)
        .await?
        .ok_or_else(|| AppError::Github("no workflow run found for check suite".into()))?;

    manager.rerun_failed_jobs(&owner, &repo, run_id).await
}

/// Download and extract failure log excerpts for a workflow run.
#[tauri::command]
pub async fn get_workflow_log(repo_path: String, check_suite_id: u64) -> Result<Vec<WorkflowRunLog>> {
    let config = config_manager::load_config(&repo_path).await?;
    let token = github_manager::resolve_token(config.github_token.as_deref()).await?;
    let manager = GithubManager::new(&token)?;
    let (owner, repo) = github_manager::resolve_owner_repo(&repo_path).await?;

    let run_id = manager
        .get_workflow_run_id_for_check_suite(&owner, &repo, check_suite_id)
        .await?
        .ok_or_else(|| AppError::Github("no workflow run found for check suite".into()))?;

    manager.download_workflow_log(&owner, &repo, run_id).await
}
