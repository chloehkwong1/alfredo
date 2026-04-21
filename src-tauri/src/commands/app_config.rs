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

/// Save the UI-managed portion of `app.json`.
///
/// The frontend holds its own snapshot of `GlobalAppConfig` and may send us a
/// stale copy (e.g. the onboarding dialog loads config, then the user connects
/// Linear, then the dialog saves — the dialog's `config.linearOauth` is null).
/// To stop that wiping backend-owned state, we load the current on-disk config
/// and copy backend-managed fields from disk before writing. The incoming
/// `config` is only trusted for frontend-owned fields.
///
/// Backend-owned fields (do NOT copy from the incoming blob):
///   - `linear_oauth` — written by `linear_oauth_start` / `refresh_if_needed`.
///
/// When a new backend-managed field is added (e.g. `linear_oauth_last_error`
/// in B4), add it to the preserve list below.
#[tauri::command]
pub async fn save_app_config(app: AppHandle, config: GlobalAppConfig) -> Result<(), AppError> {
    let dir = app_data_dir(&app)?;
    let on_disk = app_config_manager::load(&dir).await?;

    let merged = GlobalAppConfig {
        linear_oauth: on_disk.linear_oauth,
        ..config
    };

    app_config_manager::save(&dir, &merged).await
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

#[tauri::command]
pub async fn set_selected_repos(app: AppHandle, paths: Vec<String>) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    config.selected_repos = paths;
    // Keep active_repo in sync — if it's no longer selected, switch to the first selected repo
    if let Some(ref active) = config.active_repo {
        if !config.selected_repos.contains(active) {
            config.active_repo = config.selected_repos.first().cloned();
        }
    }
    app_config_manager::save(&dir, &config).await?;
    Ok(config)
}

#[tauri::command]
pub async fn set_display_name(app: AppHandle, name: Option<String>) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    config.display_name = name;
    app_config_manager::save(&dir, &config).await?;
    Ok(config)
}

#[tauri::command]
pub async fn set_repo_display_name(app: AppHandle, repo_path: String, name: Option<String>) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    match name {
        Some(n) if !n.is_empty() => { config.repo_display_names.insert(repo_path, n); }
        _ => { config.repo_display_names.remove(&repo_path); }
    }
    app_config_manager::save(&dir, &config).await?;
    Ok(config)
}

const WORKTREE_LABEL_MAX_LEN: usize = 200;

#[tauri::command]
pub async fn set_worktree_label(app: AppHandle, worktree_path: String, label: Option<String>) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    let sanitized = label.map(|n| {
        n.chars()
            .filter(|c| !c.is_control())
            .collect::<String>()
            .trim()
            .chars()
            .take(WORKTREE_LABEL_MAX_LEN)
            .collect::<String>()
    });
    match sanitized {
        Some(n) if !n.is_empty() => {
            config.worktree_labels.insert(worktree_path, n);
        }
        _ => {
            config.worktree_labels.remove(&worktree_path);
        }
    }
    app_config_manager::save(&dir, &config).await?;
    Ok(config)
}

#[tauri::command]
pub async fn set_comment_chips(app: AppHandle, chips: Vec<String>) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    config.comment_chips = chips;
    app_config_manager::save(&dir, &config).await?;
    Ok(config)
}

#[tauri::command]
pub async fn set_repo_color(app: AppHandle, repo_path: String, color: String) -> Result<GlobalAppConfig, AppError> {
    let dir = app_data_dir(&app)?;
    let mut config = app_config_manager::load(&dir).await?;
    config.repo_colors.insert(repo_path, color);
    app_config_manager::save(&dir, &config).await?;
    Ok(config)
}

/// Check if any PTY sessions are running for worktrees under a given repo.
#[tauri::command]
pub async fn has_active_sessions(app: AppHandle, repo_path: String) -> Result<bool, AppError> {
    let pty_manager = app.state::<PtyManager>();
    let sessions = pty_manager.list().unwrap_or_default();

    // Build the set of worktree IDs that belong to this repo.
    // Session.worktree_id stores the short name (e.g. "feat-my-feature"),
    // which matches Worktree.id — not the full filesystem path.
    let worktrees = crate::git_manager::list_worktrees(&repo_path, None)
        .unwrap_or_default();
    let repo_worktree_ids: std::collections::HashSet<String> =
        worktrees.iter().map(|wt| wt.id.clone()).collect();

    Ok(sessions.iter().any(|s| {
        repo_worktree_ids.contains(&s.worktree_id)
            && matches!(
                s.status,
                crate::types::SessionStatus::Running
                    | crate::types::SessionStatus::Idle
                    | crate::types::SessionStatus::WaitingForInput
            )
    }))
}
