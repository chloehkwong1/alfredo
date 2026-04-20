use crate::branch_manager;
use crate::git_manager;
use crate::types::{AppError, Worktree};

type Result<T> = std::result::Result<T, AppError>;

/// List local branches as Worktree structs (branch mode).
/// Returns a tuple of (branches, active_branch_name).
/// When `include_default_branches` is true, main/master are included (for base branch picker).
#[tauri::command]
pub async fn list_branches(repo_path: String, include_default_branches: Option<bool>) -> Result<Vec<Worktree>> {
    let include_defaults = include_default_branches.unwrap_or(false);

    // Refresh remote-tracking refs so branches pushed from another machine
    // show up in the picker. Throttled to 30s per repo.
    git_manager::fetch_all_for_branch_list(&repo_path).await;

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

