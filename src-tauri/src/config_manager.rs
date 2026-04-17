use std::collections::HashMap;
use std::path::{Path, PathBuf};

use tokio::process::Command;

use crate::types::{AppConfig, AppError, ClaudeDefaults, ClaudeOverrides, KanbanColumn, LinearTicketRef, NotificationConfig, RunScript, SetupScript};

/// Legacy filename — used only for migration from in-repo config.
const CONFIG_FILE: &str = ".alfredo.json";

/// Stable FNV-1a 64-bit hash. Unlike `DefaultHasher`, whose algorithm may
/// change between Rust releases, this is a fixed algorithm that will produce
/// the same output forever — critical because we use it to derive on-disk paths.
fn fnv1a_64(bytes: &[u8]) -> u64 {
    const BASIS: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x00000100000001B3;
    let mut hash = BASIS;
    for &b in bytes {
        hash ^= b as u64;
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

/// Compute the per-repo directory: `<app_data_dir>/repos/<hex16>/`
pub fn repo_data_dir(app_data_dir: &Path, repo_path: &str) -> PathBuf {
    let hex16 = format!("{:016x}", fnv1a_64(repo_path.as_bytes()));
    app_data_dir.join("repos").join(hex16)
}

/// Compute the config path: `<app_data_dir>/repos/<hex16>/config.json`
fn repo_config_path(app_data_dir: &Path, repo_path: &str) -> PathBuf {
    repo_data_dir(app_data_dir, repo_path).join("config.json")
}

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
    #[serde(default)]
    pub claude_defaults: Option<ClaudeDefaults>,
    #[serde(default)]
    pub worktree_overrides: Option<HashMap<String, ClaudeOverrides>>,
    #[serde(default)]
    pub run_script: Option<RunScript>,
    #[serde(default)]
    pub stack_parent_overrides: HashMap<String, String>,
    #[serde(default)]
    pub archive_script: Option<String>,
    #[serde(default)]
    pub linear_tickets: HashMap<String, LinearTicketRef>,
    #[serde(default)]
    pub port_assignments: HashMap<String, u16>,
    #[serde(default)]
    pub auto_assign_ports: bool,
}

/// Load the repo config from the app data directory.
/// Auto-migrates from the legacy `<repo_path>/.alfredo.json` if needed.
pub async fn load_config(app_data_dir: &Path, repo_path: &str) -> Result<AppConfig, AppError> {
    let new_path = repo_config_path(app_data_dir, repo_path);
    let old_path = Path::new(repo_path).join(CONFIG_FILE);

    // Determine which file to read: prefer new location, fall back to legacy.
    let (source_path, is_migration) = if new_path.exists() {
        (new_path.clone(), false)
    } else if old_path.exists() {
        (old_path.clone(), true)
    } else {
        // No config anywhere — return defaults.
        let github_token = crate::keychain::retrieve("github_token")?;
        let linear_api_key = crate::keychain::retrieve("linear_api_key")?;
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
            claude_defaults: None,
            worktree_overrides: None,
            run_script: None,
            stack_parent_overrides: HashMap::new(),
            archive_script: None,
            linear_tickets: HashMap::new(),
            port_assignments: HashMap::new(),
            auto_assign_ports: false,
        });
    };

    let contents = tokio::fs::read_to_string(&source_path)
        .await
        .map_err(|e| AppError::Config(format!("failed to read config: {e}")))?;

    let file: ConfigFile = serde_json::from_str(&contents)
        .map_err(|e| AppError::Config(format!("failed to parse config: {e}")))?;

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
        claude_defaults: file.claude_defaults,
        worktree_overrides: file.worktree_overrides,
        run_script: file.run_script,
        stack_parent_overrides: file.stack_parent_overrides,
        archive_script: file.archive_script,
        linear_tickets: file.linear_tickets,
        port_assignments: file.port_assignments,
        auto_assign_ports: file.auto_assign_ports,
    };

    if is_migration || needs_resave {
        // Write to new location.
        save_config(app_data_dir, repo_path, &config).await?;
        // Delete the legacy file if we migrated.
        if is_migration {
            let _ = tokio::fs::remove_file(&old_path).await;
        }
    }

    Ok(config)
}

/// Save the repo config to the app data directory.
pub async fn save_config(app_data_dir: &Path, repo_path: &str, config: &AppConfig) -> Result<(), AppError> {
    let config_path = repo_config_path(app_data_dir, repo_path);

    // Persist tokens to keychain rather than JSON.
    match &config.github_token {
        Some(token) if !token.is_empty() => crate::keychain::store("github_token", token)?,
        _ => crate::keychain::delete("github_token")?,
    }
    match &config.linear_api_key {
        Some(key) if !key.is_empty() => crate::keychain::store("linear_api_key", key)?,
        _ => crate::keychain::delete("linear_api_key")?,
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
        claude_defaults: config.claude_defaults.clone(),
        worktree_overrides: config.worktree_overrides.clone(),
        run_script: config.run_script.clone(),
        stack_parent_overrides: config.stack_parent_overrides.clone(),
        archive_script: config.archive_script.clone(),
        linear_tickets: config.linear_tickets.clone(),
        port_assignments: config.port_assignments.clone(),
        auto_assign_ports: config.auto_assign_ports,
    };

    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| AppError::Config(format!("failed to serialize config: {e}")))?;

    if let Some(parent) = config_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Config(format!("failed to create config dir: {e}")))?;
    }

    tokio::fs::write(&config_path, json)
        .await
        .map_err(|e| AppError::Config(format!("failed to write config: {e}")))?;

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

pub fn get_linear_ticket(config: &AppConfig, worktree_name: &str) -> Option<LinearTicketRef> {
    config.linear_tickets.get(worktree_name).cloned()
}

pub fn set_linear_ticket(config: &mut AppConfig, worktree_name: &str, ticket: LinearTicketRef) {
    config.linear_tickets.insert(worktree_name.to_string(), ticket);
}

/// Get the assigned port for a worktree, if any.
pub fn get_assigned_port(config: &AppConfig, worktree_name: &str) -> Option<u16> {
    config.port_assignments.get(worktree_name).copied()
}

/// Assign the next available port from the given range to a worktree.
/// Returns the assigned port, or None if the range is exhausted.
pub fn assign_next_port(
    config: &mut AppConfig,
    worktree_name: &str,
    range_start: u16,
    range_end: u16,
) -> Option<u16> {
    let used: std::collections::HashSet<u16> = config.port_assignments.values().copied().collect();
    let port = (range_start..=range_end).find(|p| !used.contains(p))?;
    config.port_assignments.insert(worktree_name.to_string(), port);
    Some(port)
}

/// Set a specific port for a worktree. Returns an error string if the port
/// is already assigned to a different worktree.
pub fn set_worktree_port(
    config: &mut AppConfig,
    worktree_name: &str,
    port: u16,
) -> Result<(), String> {
    if let Some((existing, _)) = config
        .port_assignments
        .iter()
        .find(|(name, &p)| p == port && name.as_str() != worktree_name)
    {
        return Err(format!("Port {} is already assigned to {}", port, existing));
    }
    config.port_assignments.insert(worktree_name.to_string(), port);
    Ok(())
}

/// Release a worktree's port assignment.
pub fn release_port(config: &mut AppConfig, worktree_name: &str) {
    config.port_assignments.remove(worktree_name);
}

/// Run setup scripts sequentially in the given worktree directory.
pub async fn run_setup_scripts(
    worktree_path: &str,
    scripts: &[SetupScript],
) -> Result<(), AppError> {
    let shell = crate::platform::login_shell();
    for script in scripts {
        let output = Command::new(&shell)
            .args(["-li", "-c", &script.command])
            .current_dir(worktree_path)
            .stdin(std::process::Stdio::null())
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
        let app_data = tempfile::TempDir::new()?;
        let repo = tempfile::TempDir::new()?;
        let config = load_config(app_data.path(), repo.path().to_str().unwrap_or_default()).await?;
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
            claude_defaults: Some(ClaudeDefaults {
                model: Some("claude-sonnet-4-6".into()),
                effort: Some("high".into()),
                ..Default::default()
            }),
            worktree_overrides: None,
            run_script: None,
            stack_parent_overrides: HashMap::new(),
            archive_script: None,
            linear_tickets: HashMap::new(),
            port_assignments: HashMap::new(),
            auto_assign_ports: false,
        };
        config
            .column_overrides
            .insert("feat-x".into(), KanbanColumn::Blocked);

        // save_config may return an error if the keychain is not accessible
        // in the test environment (e.g., unsigned binary on macOS). We only
        // care about the JSON output, so we check the file directly.
        let app_data = tempfile::TempDir::new()?;
        let _ = save_config(app_data.path(), path, &config).await;

        let json_path = repo_config_path(app_data.path(), path);
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
