use std::collections::HashSet;

use tauri::Manager;

use crate::github_manager;
use crate::types::{AppError, PrDetailedStatus};

type Result<T> = std::result::Result<T, AppError>;

/// The PR's GraphQL node id (needed by `mark_pr_file_viewed`), every changed
/// file path in the PR on GitHub (the universe viewed toggles are valid
/// against — the local diff can diverge on unpushed work), and the subset the
/// viewer has already marked as viewed.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrFileViewedStates {
    pub pr_node_id: String,
    pub pr_paths: HashSet<String>,
    pub viewed_paths: HashSet<String>,
}

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

/// Fetch each changed file's viewed state for a PR, plus the PR's GraphQL
/// node id (needed to submit a viewed/unviewed toggle).
#[tauri::command]
pub async fn get_pr_file_viewed_states(
    app: tauri::AppHandle,
    repo_path: String,
    pr_number: u64,
) -> Result<PrFileViewedStates> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let (manager, owner, repo) = github_manager::github_context(&app_data_dir, &repo_path).await?;
    let (pr_node_id, pr_paths, viewed_paths) = manager.get_pr_file_viewed_states(&owner, &repo, pr_number).await?;
    Ok(PrFileViewedStates { pr_node_id, pr_paths, viewed_paths })
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
