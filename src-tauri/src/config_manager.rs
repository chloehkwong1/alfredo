use std::collections::HashMap;
use std::path::Path;

use tokio::process::Command;

use crate::types::{AppConfig, AppError, KanbanColumn, SetupScript};

const CONFIG_FILE: &str = ".alfredo.json";

/// On-disk representation of `.alfredo.json`.
/// Slightly different from AppConfig to include column overrides.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConfigFile {
    #[serde(default)]
    pub setup_scripts: Vec<SetupScript>,
    #[serde(default)]
    pub github_token: Option<String>,
    #[serde(default)]
    pub linear_api_key: Option<String>,
    #[serde(default)]
    pub branch_mode: bool,
    #[serde(default)]
    pub column_overrides: HashMap<String, KanbanColumn>,
}

/// Load the `.alfredo.json` config from a repo root.
pub async fn load_config(repo_path: &str) -> Result<AppConfig, AppError> {
    let config_path = Path::new(repo_path).join(CONFIG_FILE);

    if !config_path.exists() {
        // Return sensible defaults when no config file exists yet
        return Ok(AppConfig {
            repo_path: repo_path.to_string(),
            setup_scripts: vec![],
            github_token: None,
            linear_api_key: None,
            branch_mode: false,
            column_overrides: HashMap::new(),
        });
    }

    let contents = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| AppError::Config(format!("failed to read {CONFIG_FILE}: {e}")))?;

    let file: ConfigFile = serde_json::from_str(&contents)
        .map_err(|e| AppError::Config(format!("failed to parse {CONFIG_FILE}: {e}")))?;

    Ok(AppConfig {
        repo_path: repo_path.to_string(),
        setup_scripts: file.setup_scripts,
        github_token: file.github_token,
        linear_api_key: file.linear_api_key,
        branch_mode: file.branch_mode,
        column_overrides: file.column_overrides,
    })
}

/// Save the config to `.alfredo.json` in the repo root.
pub async fn save_config(repo_path: &str, config: &AppConfig) -> Result<(), AppError> {
    let config_path = Path::new(repo_path).join(CONFIG_FILE);

    let file = ConfigFile {
        setup_scripts: config.setup_scripts.clone(),
        github_token: config.github_token.clone(),
        linear_api_key: config.linear_api_key.clone(),
        branch_mode: config.branch_mode,
        column_overrides: config.column_overrides.clone(),
    };

    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| AppError::Config(format!("failed to serialize config: {e}")))?;

    tokio::fs::write(&config_path, json)
        .await
        .map_err(|e| AppError::Config(format!("failed to write {CONFIG_FILE}: {e}")))?;

    Ok(())
}

/// Get the column override for a specific worktree, if any.
pub fn get_column_override(
    config: &AppConfig,
    worktree_name: &str,
) -> Option<KanbanColumn> {
    config.column_overrides.get(worktree_name).cloned()
}

/// Set a column override for a specific worktree.
pub fn set_column_override(
    config: &mut AppConfig,
    worktree_name: &str,
    column: KanbanColumn,
) {
    config
        .column_overrides
        .insert(worktree_name.to_string(), column);
}

/// Run setup scripts sequentially in the given worktree directory.
pub async fn run_setup_scripts(
    worktree_path: &str,
    scripts: &[SetupScript],
) -> Result<(), AppError> {
    for script in scripts {
        let output = Command::new("sh")
            .args(["-c", &script.command])
            .current_dir(worktree_path)
            .output()
            .await
            .map_err(|e| {
                AppError::Config(format!(
                    "failed to run setup script '{}': {e}",
                    script.name
                ))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Config(format!(
                "setup script '{}' failed: {stderr}",
                script.name
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_load_missing_config_returns_defaults() {
        let dir = tempfile::TempDir::new().unwrap();
        let config = load_config(dir.path().to_str().unwrap()).await.unwrap();
        assert!(config.setup_scripts.is_empty());
        assert!(config.github_token.is_none());
        assert!(!config.branch_mode);
    }

    #[tokio::test]
    async fn test_save_and_load_config() {
        let dir = tempfile::TempDir::new().unwrap();
        let path = dir.path().to_str().unwrap();

        let mut config = AppConfig {
            repo_path: path.to_string(),
            setup_scripts: vec![SetupScript {
                name: "install".into(),
                command: "npm install".into(),
                run_on: "create".into(),
            }],
            github_token: Some("ghp_test".into()),
            linear_api_key: None,
            branch_mode: true,
            column_overrides: HashMap::new(),
        };
        config
            .column_overrides
            .insert("feat-x".into(), KanbanColumn::Blocked);

        save_config(path, &config).await.unwrap();
        let loaded = load_config(path).await.unwrap();

        assert_eq!(loaded.setup_scripts.len(), 1);
        assert_eq!(loaded.github_token, Some("ghp_test".into()));
        assert!(loaded.branch_mode);
        assert_eq!(
            loaded.column_overrides.get("feat-x"),
            Some(&KanbanColumn::Blocked)
        );
    }

    #[tokio::test]
    async fn test_run_setup_scripts_success() {
        let dir = tempfile::TempDir::new().unwrap();
        let scripts = vec![SetupScript {
            name: "echo".into(),
            command: "echo hello".into(),
            run_on: "create".into(),
        }];
        let result = run_setup_scripts(dir.path().to_str().unwrap(), &scripts).await;
        assert!(result.is_ok());
    }
}
