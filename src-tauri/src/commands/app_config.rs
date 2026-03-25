use tauri::AppHandle;
use tauri::Manager;

use crate::app_config_manager;
use crate::types::{AppError, GlobalAppConfig, RepoMode};
use crate::pty_manager::PtyManager;

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))
}

#[tauri::command]
pub async fn get_app_config(app: AppHandle) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    app_config_manager::load(&dir).await
}

#[tauri::command]
pub async fn save_app_config(app: AppHandle, config: GlobalAppConfig) -> Result<(), AppError> {
    let dir = app_data_dir(&app)?;
    app_config_manager::save(&dir, &config).await
}

#[tauri::command]
pub async fn add_app_repo(app: AppHandle, path: String, mode: RepoMode) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    app_config_manager::add_repo(&mut config, path, mode)?;
    app_config_manager::save(&dir, &config).await?;
    Ok(config)
}

#[tauri::command]
pub async fn remove_app_repo(app: AppHandle, path: String) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    app_config_manager::remove_repo(&mut config, &path);
    app_config_manager::save(&dir, &config).await?;
    Ok(config)
}

#[tauri::command]
pub async fn set_active_repo(app: AppHandle, path: String) -> Result<(), AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    if !config.repos.iter().any(|r| r.path == path) {
        return Err(AppError::Config("Repository not found".into()));
    }
    config.active_repo = Some(path);
    app_config_manager::save(&dir, &config).await
}

/// Check if any PTY sessions are running for worktrees under a given repo.
#[tauri::command]
pub async fn has_active_sessions(app: AppHandle, repo_path: String) -> Result<bool, AppError> {
    let pty_manager = app.state::<PtyManager>();
    let sessions = pty_manager.list().unwrap_or_default();

    // Build the set of worktree paths that belong to this repo.
    // Note: Session.worktree_id is populated from worktree_path at spawn time,
    // so we match against wt.path (not wt.id/name).
    let worktrees = crate::git_manager::list_worktrees(&repo_path, None)
        .unwrap_or_default();
    let repo_worktree_paths: std::collections::HashSet<String> =
        worktrees.iter().map(|wt| wt.path.clone()).collect();

    Ok(sessions.iter().any(|s| {
        repo_worktree_paths.contains(&s.worktree_id)
            && matches!(
                s.status,
                crate::types::SessionStatus::Running
                    | crate::types::SessionStatus::Idle
                    | crate::types::SessionStatus::WaitingForInput
            )
    }))
}
