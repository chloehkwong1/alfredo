use tauri::Manager;

use crate::config_manager;
use crate::types::{AppConfig, AppError, EffectiveConfig, RepoMode, RepoSharedConfig};

type Result<T> = std::result::Result<T, AppError>;

/// True when `worktree_path` resolves to the repo root. Setup/archive scripts
/// are designed for worktrees that symlink into main; running them with cwd =
/// main destroys the canonical files (e.g. `ln -sf $repo/.env .env` becomes a
/// self-pointing symlink and unlinks the real `.env`). The pinned main card
/// reuses `repo_path` as its `path`, so guard at the command boundary.
fn is_repo_root(worktree_path: &str, repo_path: &str) -> bool {
    match (std::fs::canonicalize(worktree_path), std::fs::canonicalize(repo_path)) {
        (Ok(a), Ok(b)) => a == b,
        _ => worktree_path == repo_path,
    }
}

/// Load the app configuration for a repository.
#[tauri::command]
pub async fn get_config(app: tauri::AppHandle, repo_path: String) -> Result<AppConfig> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let result = config_manager::load_effective_config(&app_data_dir, &repo_path).await?;
    Ok(result.effective)
}

/// Save the app configuration for a repository.
#[tauri::command]
pub async fn save_config(app: tauri::AppHandle, repo_path: String, config: AppConfig) -> Result<()> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    config_manager::save_config(&app_data_dir, &repo_path, &config).await
}

/// Run setup scripts for a worktree, reading them from the repo's config file.
/// Scripts are never accepted from the frontend to prevent arbitrary command execution.
#[tauri::command]
pub async fn run_setup_scripts(
    app: tauri::AppHandle,
    repo_path: String,
    worktree_path: String,
) -> Result<()> {
    if is_repo_root(&worktree_path, &repo_path) {
        return Ok(());
    }

    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let config = config_manager::load_effective_config(&app_data_dir, &repo_path).await?.effective;
    let create_scripts: Vec<_> = config
        .setup_scripts
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|s| s.run_on == "create")
        .cloned()
        .collect();

    if create_scripts.is_empty() {
        return Ok(());
    }

    config_manager::run_setup_scripts(&worktree_path, &create_scripts).await
}

/// Update the repo mode (branch ↔ worktree) in both .alfredo.json and the global app config.
#[tauri::command]
pub async fn set_repo_mode(app: tauri::AppHandle, repo_path: String, mode: RepoMode) -> Result<()> {
    // Load both configs before writing either (fail fast)
    let app_data_dir = app.path()
        .app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let mut local_config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    let mut global = crate::app_config_manager::load(&app_data_dir).await?;

    let entry = global.repos.iter_mut().find(|r| r.path == repo_path)
        .ok_or_else(|| AppError::Config(format!("repo not found in global config: {repo_path}")))?;

    // Mutate
    local_config.branch_mode = matches!(mode, RepoMode::Branch);
    entry.mode = mode;

    // Write both
    config_manager::save_config(&app_data_dir, &repo_path, &local_config).await?;
    crate::app_config_manager::save(&app_data_dir, &global).await?;

    Ok(())
}

/// Run the archive script for a worktree, reading it from the repo's config file.
/// The script command is never accepted from the frontend to prevent arbitrary command execution.
#[tauri::command]
pub async fn run_archive_script(
    app: tauri::AppHandle,
    repo_path: String,
    worktree_path: String,
) -> Result<()> {
    if is_repo_root(&worktree_path, &repo_path) {
        return Ok(());
    }

    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let config = config_manager::load_effective_config(&app_data_dir, &repo_path).await?.effective;

    let Some(ref script_command) = config.archive_script else {
        return Ok(());
    };

    if script_command.trim().is_empty() {
        return Ok(());
    }

    let script = crate::types::SetupScript {
        name: "Archive".to_string(),
        command: script_command.clone(),
        run_on: "archive".to_string(),
    };

    config_manager::run_setup_scripts(&worktree_path, &[script]).await
}

/// Load the effective config layers for a repository (upstream + personal overrides + merged result).
#[tauri::command]
pub async fn get_repo_config_layers(
    app: tauri::AppHandle,
    repo_path: String,
) -> Result<EffectiveConfig> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    config_manager::load_effective_config(&app_data_dir, &repo_path).await
}

/// Read the shared `alfredo.json` from the repo root.
#[tauri::command]
pub async fn read_alfredo_json(repo_path: String) -> Result<Option<RepoSharedConfig>> {
    crate::repo_config::load_alfredo_json(std::path::Path::new(&repo_path)).await
}

/// Write the shared `alfredo.json` to the repo root.
#[tauri::command]
pub async fn write_alfredo_json(repo_path: String, config: RepoSharedConfig) -> Result<()> {
    crate::repo_config::save_alfredo_json(std::path::Path::new(&repo_path), &config).await
}

/// Clear all personal overrides for the repo-shared fields, so that values
/// fall back to `alfredo.json` (or the type defaults if that file is absent).
#[tauri::command]
pub async fn reset_repo_overrides(app: tauri::AppHandle, repo_path: String) -> Result<()> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let mut personal = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    personal.setup_scripts = None;
    personal.run_script = None;
    personal.archive_script = None;
    personal.port_env_var = None;
    personal.port_range_start = None;
    personal.port_range_end = None;
    config_manager::save_config(&app_data_dir, &repo_path, &personal).await?;
    Ok(())
}
