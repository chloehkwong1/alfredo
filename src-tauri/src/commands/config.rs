use crate::types::{AppConfig, AppError, SetupScript};

type Result<T> = std::result::Result<T, AppError>;

/// Load the app configuration for a repository (.alfredo.json).
#[tauri::command]
pub async fn get_config(repo_path: String) -> Result<AppConfig> {
    let _ = repo_path;
    Err(AppError::Config("not yet implemented".into()))
}

/// Save the app configuration for a repository.
#[tauri::command]
pub async fn save_config(repo_path: String, config: AppConfig) -> Result<()> {
    let _ = (repo_path, config);
    Err(AppError::Config("not yet implemented".into()))
}

/// Run setup scripts sequentially in a worktree directory.
#[tauri::command]
pub async fn run_setup_scripts(
    worktree_path: String,
    scripts: Vec<SetupScript>,
) -> Result<()> {
    let _ = (worktree_path, scripts);
    Err(AppError::Config("not yet implemented".into()))
}
