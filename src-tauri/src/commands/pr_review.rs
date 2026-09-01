use tauri::Manager;

use crate::github_manager::{self, ReviewDraftComment};
use crate::github_sync;
use crate::types::AppError;

type Result<T> = std::result::Result<T, AppError>;

fn app_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))
}

/// Submit a full review (verdict + summary + drafted line comments) in one shot.
#[tauri::command]
pub async fn submit_pr_review(
    app: tauri::AppHandle,
    repo_path: String,
    pr_number: u64,
    event: String,
    body: String,
    comments: Vec<ReviewDraftComment>,
) -> Result<()> {
    let (manager, owner, repo) = github_manager::github_context(&app_data_dir(&app)?, &repo_path).await?;
    manager
        .submit_pr_review(&owner, &repo, pr_number, &event, &body, &comments)
        .await?;
    github_sync::trigger_sync(&app);
    Ok(())
}

#[tauri::command]
pub async fn reply_to_pr_comment(
    app: tauri::AppHandle,
    repo_path: String,
    pr_number: u64,
    comment_id: u64,
    body: String,
) -> Result<()> {
    let (manager, owner, repo) = github_manager::github_context(&app_data_dir(&app)?, &repo_path).await?;
    manager
        .reply_to_pr_comment(&owner, &repo, pr_number, comment_id, &body)
        .await?;
    github_sync::trigger_sync(&app);
    Ok(())
}

#[tauri::command]
pub async fn set_pr_thread_resolved(
    app: tauri::AppHandle,
    repo_path: String,
    thread_id: String,
    resolved: bool,
) -> Result<()> {
    let (manager, _owner, _repo) = github_manager::github_context(&app_data_dir(&app)?, &repo_path).await?;
    manager.set_thread_resolved(&thread_id, resolved).await?;
    github_sync::trigger_sync(&app);
    Ok(())
}
