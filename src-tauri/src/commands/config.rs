use crate::config_manager;
use crate::types::{AppConfig, AppError};

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

/// Run setup scripts for a worktree, reading them from the repo's config file.
/// Scripts are never accepted from the frontend to prevent arbitrary command execution.
#[tauri::command]
pub async fn run_setup_scripts(
    app: tauri::AppHandle,
    repo_path: String,
    worktree_path: String,
) -> Result<()> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let config = config_manager::load_config(&repo_path).await?;
    let create_scripts: Vec<_> = config
        .setup_scripts
        .iter()
        .filter(|s| s.run_on == "create")
        .cloned()
        .collect();

    if create_scripts.is_empty() {
        return Ok(());
    }

    let script_list = create_scripts
        .iter()
        .map(|s| format!("• {} — {}", s.name, s.command))
        .collect::<Vec<_>>()
        .join("\n");

    let confirmed = app
        .dialog()
        .message(format!(
            "This repo wants to run the following setup scripts:\n\n{script_list}\n\nOnly proceed if you trust this repository."
        ))
        .title("Run Setup Scripts?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Run Scripts".into(),
            "Cancel".into(),
        ))
        .blocking_show();

    if !confirmed {
        return Err(AppError::Config(
            "setup scripts cancelled by user".into(),
        ));
    }

    config_manager::run_setup_scripts(&worktree_path, &create_scripts).await
}
