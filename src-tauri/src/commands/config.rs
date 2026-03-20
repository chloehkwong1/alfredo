use crate::config_manager;
use crate::types::{AppConfig, AppError, SetupScript};

type Result<T> = std::result::Result<T, AppError>;

/// Load the app configuration for a repository (.alfredo.json).
#[tauri::command]
pub async fn get_config(repo_path: String) -> Result<AppConfig> {
    config_manager::load_config(&repo_path).await
}

/// Save the app configuration for a repository.
#[tauri::command]
pub async fn save_config(repo_path: String, config: AppConfig) -> Result<()> {
    config_manager::save_config(&repo_path, &config).await
}

/// Run setup scripts sequentially in a worktree directory.
#[tauri::command]
pub async fn run_setup_scripts(
    worktree_path: String,
    scripts: Vec<SetupScript>,
) -> Result<()> {
    config_manager::run_setup_scripts(&worktree_path, &scripts).await
}
