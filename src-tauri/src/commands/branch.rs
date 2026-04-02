use crate::branch_manager;
use crate::types::{AppError, Worktree};

type Result<T> = std::result::Result<T, AppError>;

/// List local branches as Worktree structs (branch mode).
/// Returns a tuple of (branches, active_branch_name).
/// When `include_default_branches` is true, main/master are included (for base branch picker).
#[tauri::command]
pub async fn list_branches(repo_path: String, include_default_branches: Option<bool>) -> Result<Vec<Worktree>> {
    let include_defaults = include_default_branches.unwrap_or(false);
    let (worktrees, _active) =
        tokio::task::spawn_blocking(move || branch_manager::list_branches(&repo_path, include_defaults))
            .await
            .map_err(|e| AppError::Git(format!("task join error: {e}")))?
            ?;

    Ok(worktrees)
}

/// Get the currently checked-out branch name.
#[tauri::command]
pub async fn get_active_branch(repo_path: String) -> Result<Option<String>> {
    let (_, active) =
        tokio::task::spawn_blocking(move || branch_manager::list_branches(&repo_path, false))
            .await
            .map_err(|e| AppError::Git(format!("task join error: {e}")))?
            ?;

    Ok(active)
}

/// Create a new branch and check it out.
#[tauri::command]
pub async fn create_branch(
    repo_path: String,
    branch_name: String,
    base_branch: String,
) -> Result<Worktree> {
    branch_manager::create_branch(&repo_path, &branch_name, &base_branch).await
}

/// Switch to an existing branch (checks for dirty state first).
#[tauri::command]
pub async fn switch_branch(repo_path: String, branch_name: String) -> Result<()> {
    branch_manager::switch_branch(&repo_path, &branch_name).await
}

/// Delete a local branch.
#[tauri::command]
pub async fn delete_branch(repo_path: String, branch_name: String) -> Result<()> {
    branch_manager::delete_branch(&repo_path, &branch_name).await
}
