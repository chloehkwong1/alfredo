use tauri::Manager;

use crate::github_manager;
use crate::types::{AppError, PrDetailedStatus};

type Result<T> = std::result::Result<T, AppError>;

/// Fetch detailed PR info (reviews, comments, mergeable status).
/// Called on-demand when the PR tab is opened.
#[tauri::command]
pub async fn get_pr_detail(
    app: tauri::AppHandle,
    repo_path: String,
    pr_number: u64,
) -> Result<PrDetailedStatus> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let (manager, owner, repo) = github_manager::github_context(&app_data_dir, &repo_path).await?;
    manager.get_pr_detail(&owner, &repo, pr_number).await
}

/// Fetch PR file diffs from GitHub API.
#[tauri::command]
pub async fn get_pr_files(
    app: tauri::AppHandle,
    repo_path: String,
    pr_number: u64,
) -> Result<Vec<crate::commands::diff::DiffFile>> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let (manager, owner, repo) = github_manager::github_context(&app_data_dir, &repo_path).await?;
    manager.get_pr_files(&owner, &repo, pr_number).await
}

/// Fetch PR commits from GitHub API.
#[tauri::command]
pub async fn get_pr_commits(
    app: tauri::AppHandle,
    repo_path: String,
    pr_number: u64,
) -> Result<Vec<crate::commands::diff::CommitInfo>> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let (manager, owner, repo) = github_manager::github_context(&app_data_dir, &repo_path).await?;
    manager.get_pr_commits(&owner, &repo, pr_number).await
}
