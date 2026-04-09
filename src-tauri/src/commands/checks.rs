use tauri::Manager;

use crate::github_manager;
use crate::types::{AppError, CheckRun, WorkflowRunLog};

type Result<T> = std::result::Result<T, AppError>;

/// Fetch GitHub Actions check runs for a given branch.
#[tauri::command]
pub async fn get_check_runs(app: tauri::AppHandle, repo_path: String, branch: String) -> Result<Vec<CheckRun>> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let (manager, owner, repo) = github_manager::github_context(&app_data_dir, &repo_path).await?;
    manager.get_check_runs(&owner, &repo, &branch).await
}

/// Re-run failed jobs for a workflow run (identified via check suite ID).
#[tauri::command]
pub async fn rerun_failed_checks(app: tauri::AppHandle, repo_path: String, check_suite_id: u64) -> Result<()> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let (manager, owner, repo) = github_manager::github_context(&app_data_dir, &repo_path).await?;

    let run_id = manager
        .get_workflow_run_id_for_check_suite(&owner, &repo, check_suite_id)
        .await?
        .ok_or_else(|| AppError::Github("no workflow run found for check suite".into()))?;

    manager.rerun_failed_jobs(&owner, &repo, run_id).await
}

/// Download and extract failure log excerpt for a single job (check run).
///
/// For GitHub Actions, check run IDs are job IDs, so we can download the log
/// directly without the check_suite → workflow_run → jobs lookup chain.
#[tauri::command]
pub async fn get_job_log(app: tauri::AppHandle, repo_path: String, job_id: u64, job_name: String) -> Result<Option<WorkflowRunLog>> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let (manager, owner, repo) = github_manager::github_context(&app_data_dir, &repo_path).await?;
    manager.download_job_log(&owner, &repo, job_id, &job_name).await
}
