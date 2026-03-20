use crate::types::{AppError, KanbanColumn, Worktree, WorktreeSource};

type Result<T> = std::result::Result<T, AppError>;

/// Create a worktree from any supported source (branch, PR, Linear ticket).
#[tauri::command]
pub async fn create_worktree_from(
    repo_path: String,
    source: WorktreeSource,
) -> Result<Worktree> {
    let _ = (repo_path, source);
    Err(AppError::Git("not yet implemented".into()))
}

/// Create a worktree with an explicit branch name and base.
#[tauri::command]
pub async fn create_worktree(
    repo_path: String,
    branch_name: String,
    base_branch: String,
) -> Result<Worktree> {
    let _ = (repo_path, branch_name, base_branch);
    Err(AppError::Git("not yet implemented".into()))
}

/// Delete a worktree by name.
#[tauri::command]
pub async fn delete_worktree(repo_path: String, worktree_name: String) -> Result<()> {
    let _ = (repo_path, worktree_name);
    Err(AppError::Git("not yet implemented".into()))
}

/// List all worktrees for a repository.
#[tauri::command]
pub async fn list_worktrees(repo_path: String) -> Result<Vec<Worktree>> {
    let _ = repo_path;
    Err(AppError::Git("not yet implemented".into()))
}

/// Get the current status of a specific worktree.
#[tauri::command]
pub async fn get_worktree_status(
    repo_path: String,
    worktree_name: String,
) -> Result<Worktree> {
    let _ = (repo_path, worktree_name);
    Err(AppError::Git("not yet implemented".into()))
}

/// Manually override a worktree's kanban column (e.g. drag to "Blocked").
#[tauri::command]
pub async fn set_worktree_column(
    repo_path: String,
    worktree_name: String,
    column: KanbanColumn,
) -> Result<()> {
    let _ = (repo_path, worktree_name, column);
    Err(AppError::Git("not yet implemented".into()))
}
