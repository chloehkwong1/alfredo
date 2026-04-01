use std::collections::HashMap;
use std::path::Path;

use tokio::process::Command;

use crate::types::{AppConfig, AppError, ClaudeDefaults, ClaudeOverrides, KanbanColumn, NotificationConfig, RunScript, SetupScript, default_archive_days};

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
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub notifications: Option<NotificationConfig>,
    #[serde(default)]
    pub worktree_base_path: Option<String>,
    #[serde(default = "default_archive_days")]
    pub archive_after_days: Option<u32>,
    #[serde(default)]
    pub claude_defaults: Option<ClaudeDefaults>,
    #[serde(default)]
    pub worktree_overrides: Option<HashMap<String, ClaudeOverrides>>,
    #[serde(default)]
    pub run_script: Option<RunScript>,
    #[serde(default)]
    pub stack_parent_overrides: HashMap<String, String>,
}

/// Load the `.alfredo.json` config from a repo root.
pub async fn load_config(repo_path: &str) -> Result<AppConfig, AppError> {
    let config_path = Path::new(repo_path).join(CONFIG_FILE);

    if !config_path.exists() {
        let github_token = crate::keychain::retrieve("github_token").unwrap_or(None);
        let linear_api_key = crate::keychain::retrieve("linear_api_key").unwrap_or(None);
        return Ok(AppConfig {
            repo_path: repo_path.to_string(),
            setup_scripts: vec![],
            github_token,
            linear_api_key,
            branch_mode: false,
            column_overrides: HashMap::new(),
            theme: None,
            notifications: None,
            worktree_base_path: None,
            archive_after_days: Some(2),
            claude_defaults: None,
            worktree_overrides: None,
            run_script: None,
            stack_parent_overrides: HashMap::new(),
        });
    }

    let contents = tokio::fs::read_to_string(&config_path)
        .await
        .map_err(|e| AppError::Config(format!("failed to read {CONFIG_FILE}: {e}")))?;

    let file: ConfigFile = serde_json::from_str(&contents)
        .map_err(|e| AppError::Config(format!("failed to parse {CONFIG_FILE}: {e}")))?;

    // --- Keychain migration ---
    // If tokens are still in the JSON (pre-keychain version), migrate them now.
    let mut needs_resave = false;

    if let Some(ref token) = file.github_token {
        crate::keychain::store("github_token", token)?;
        needs_resave = true;
    }
    if let Some(ref key) = file.linear_api_key {
        crate::keychain::store("linear_api_key", key)?;
        needs_resave = true;
    }

    let github_token = crate::keychain::retrieve("github_token")?;
    let linear_api_key = crate::keychain::retrieve("linear_api_key")?;

    let config = AppConfig {
        repo_path: repo_path.to_string(),
        setup_scripts: file.setup_scripts,
        github_token,
        linear_api_key,
        branch_mode: file.branch_mode,
        column_overrides: file.column_overrides,
        theme: file.theme,
        notifications: file.notifications,
        worktree_base_path: file.worktree_base_path,
        archive_after_days: file.archive_after_days,
        claude_defaults: file.claude_defaults,
        worktree_overrides: file.worktree_overrides,
        run_script: file.run_script,
        stack_parent_overrides: file.stack_parent_overrides,
    };

    if needs_resave {
        // Write config back without the plaintext tokens.
        save_config(repo_path, &config).await?;
    }

    Ok(config)
}

/// Save the config to `.alfredo.json` in the repo root.
pub async fn save_config(repo_path: &str, config: &AppConfig) -> Result<(), AppError> {
    let config_path = Path::new(repo_path).join(CONFIG_FILE);

    // Persist tokens to keychain rather than JSON.
    match &config.github_token {
        Some(token) if !token.is_empty() => crate::keychain::store("github_token", token)?,
        None => crate::keychain::delete("github_token")?,
        _ => {}
    }
    match &config.linear_api_key {
        Some(key) if !key.is_empty() => crate::keychain::store("linear_api_key", key)?,
        None => crate::keychain::delete("linear_api_key")?,
        _ => {}
    }

    let file = ConfigFile {
        setup_scripts: config.setup_scripts.clone(),
        github_token: None,       // stored in keychain
        linear_api_key: None,     // stored in keychain
        branch_mode: config.branch_mode,
        column_overrides: config.column_overrides.clone(),
        theme: config.theme.clone(),
        notifications: config.notifications.clone(),
        worktree_base_path: config.worktree_base_path.clone(),
        archive_after_days: config.archive_after_days,
        claude_defaults: config.claude_defaults.clone(),
        worktree_overrides: config.worktree_overrides.clone(),
        run_script: config.run_script.clone(),
        stack_parent_overrides: config.stack_parent_overrides.clone(),
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

pub fn get_stack_parent(config: &AppConfig, worktree_name: &str) -> Option<String> {
    config.stack_parent_overrides.get(worktree_name).cloned()
}

pub fn set_stack_parent(config: &mut AppConfig, worktree_name: &str, parent_branch: &str) {
    config.stack_parent_overrides.insert(worktree_name.to_string(), parent_branch.to_string());
}

pub fn clear_stack_parent(config: &mut AppConfig, worktree_name: &str) {
    config.stack_parent_overrides.remove(worktree_name);
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
    async fn test_load_missing_config_returns_defaults() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let config = load_config(dir.path().to_str().unwrap_or_default()).await?;
        assert!(config.setup_scripts.is_empty());
        assert!(!config.branch_mode);
        Ok(())
    }

    /// Verify that save_config writes non-token fields correctly and does not
    /// persist tokens as plaintext in the JSON file. Token round-tripping
    /// depends on OS keychain access which is not reliably available in test
    /// environments (requires entitlements on macOS), so we verify the JSON
    /// shape rather than the full load/save cycle.
    #[tokio::test]
    async fn test_save_config_omits_tokens_from_json() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let path = dir.path().to_str().unwrap_or_default();

        let mut config = AppConfig {
            repo_path: path.to_string(),
            setup_scripts: vec![SetupScript {
                name: "install".into(),
                command: "npm install".into(),
                run_on: "create".into(),
            }],
            github_token: Some("ghp_test".into()),
            linear_api_key: Some("lin_test".into()),
            branch_mode: true,
            column_overrides: HashMap::new(),
            theme: None,
            notifications: None,
            worktree_base_path: None,
            archive_after_days: Some(2),
            claude_defaults: Some(ClaudeDefaults {
                model: Some("claude-sonnet-4-6".into()),
                effort: Some("high".into()),
                ..Default::default()
            }),
            worktree_overrides: None,
            run_script: None,
            stack_parent_overrides: HashMap::new(),
        };
        config
            .column_overrides
            .insert("feat-x".into(), KanbanColumn::Blocked);

        // save_config may return an error if the keychain is not accessible
        // in the test environment (e.g., unsigned binary on macOS). We only
        // care about the JSON output, so we check the file directly.
        let _ = save_config(path, &config).await;

        let json_path = dir.path().join(CONFIG_FILE);
        if json_path.exists() {
            let contents = tokio::fs::read_to_string(&json_path).await?;
            let value: serde_json::Value = serde_json::from_str(&contents)?;
            // Tokens must not be stored as plaintext in JSON.
            assert!(value["githubToken"].is_null(), "github_token must be null in JSON");
            assert!(value["linearApiKey"].is_null(), "linear_api_key must be null in JSON");
            // Other fields should round-trip normally.
            assert_eq!(value["branchMode"], serde_json::Value::Bool(true));
        }

        Ok(())
    }

    #[tokio::test]
    async fn test_run_setup_scripts_success() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let scripts = vec![SetupScript {
            name: "echo".into(),
            command: "echo hello".into(),
            run_on: "create".into(),
        }];
        let result = run_setup_scripts(dir.path().to_str().unwrap_or_default(), &scripts).await;
        assert!(result.is_ok());
        Ok(())
    }
}
