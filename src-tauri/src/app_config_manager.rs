use std::path::PathBuf;

use crate::types::{AppError, GlobalAppConfig, RepoEntry, RepoMode};

/// Resolve the path to `app.json` in the Tauri app data directory.
pub fn config_path(app_data_dir: &std::path::Path) -> PathBuf {
    app_data_dir.join("app.json")
}

/// Load the global app config from `app.json`.
/// Returns defaults if the file doesn't exist.
pub async fn load(app_data_dir: &std::path::Path) -> Result<GlobalAppConfig, AppError> {
    let path = config_path(app_data_dir);

    if !path.exists() {
        return Ok(GlobalAppConfig {
            repos: vec![],
            active_repo: None,
            theme: None,
            notifications: None,
            selected_repos: vec![],
            display_name: None,
            repo_colors: std::collections::HashMap::new(),
            repo_display_names: std::collections::HashMap::new(),
            preferred_editor: "vscode".into(),
            custom_editor_path: None,
            preferred_terminal: "iterm".into(),
            custom_terminal_path: None,
            model: None,
            effort: None,
            permission_mode: None,
            dangerously_skip_permissions: None,
            output_style: None,
            verbose: None,
            default_diff_view_mode: None,
            auto_resume: None,
            collapsed_kanban_columns: vec![],
            sidebar_collapsed: None,
            has_seen_orientation: false,
            active_worktree_id: None,
            linear_oauth: None,
            default_agent: None,
        });
    }

    let contents = tokio::fs::read_to_string(&path)
        .await
        .map_err(|e| AppError::Config(format!("failed to read app.json: {e}")))?;

    let mut config: GlobalAppConfig = serde_json::from_str(&contents)
        .map_err(|e| AppError::Config(format!("failed to parse app.json: {e}")))?;

    // Migration: if selected_repos is empty but active_repo is set, seed it.
    if config.selected_repos.is_empty() {
        if let Some(ref active) = config.active_repo {
            config.selected_repos = vec![active.clone()];
        }
    }

    Ok(config)
}

/// Save the global app config to `app.json`.
pub async fn save(
    app_data_dir: &std::path::Path,
    config: &GlobalAppConfig,
) -> Result<(), AppError> {
    let path = config_path(app_data_dir);

    // Ensure directory exists
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Config(format!("failed to create app data dir: {e}")))?;
    }

    let json = serde_json::to_string_pretty(config)
        .map_err(|e| AppError::Config(format!("failed to serialize app config: {e}")))?;

    tokio::fs::write(&path, json)
        .await
        .map_err(|e| AppError::Config(format!("failed to write app.json: {e}")))
}

/// Add a repo to the config. Returns error if duplicate.
pub fn add_repo(config: &mut GlobalAppConfig, path: String, mode: RepoMode) -> Result<(), AppError> {
    if config.repos.iter().any(|r| r.path == path) {
        return Err(AppError::Config("This repository is already in Alfredo".into()));
    }
    config.repos.push(RepoEntry { path: path.clone(), mode });
    if config.active_repo.is_none() {
        config.active_repo = Some(path);
    }
    Ok(())
}

/// Remove a repo from the config.
pub fn remove_repo(config: &mut GlobalAppConfig, path: &str) {
    config.repos.retain(|r| r.path != path);
    config.selected_repos.retain(|r| r != path);
    if config.active_repo.as_deref() == Some(path) {
        config.active_repo = config.repos.first().map(|r| r.path.clone());
    }
}

/// Migrate from legacy single-repo state.
/// Checks for tauri-plugin-store's app-settings.json and existing .alfredo.json.
pub async fn migrate_if_needed(
    app_data_dir: &std::path::Path,
    store_path: &std::path::Path,
) -> Result<Option<GlobalAppConfig>, AppError> {
    let app_json = config_path(app_data_dir);
    if app_json.exists() {
        return Ok(None); // Already migrated
    }

    // Try to read the old tauri-plugin-store file
    let store_file = store_path.join("app-settings.json");
    if !store_file.exists() {
        return Ok(None);
    }

    let contents = tokio::fs::read_to_string(&store_file)
        .await
        .map_err(|e| AppError::Config(format!("failed to read legacy store: {e}")))?;

    // The store format is a JSON object with key-value pairs
    let store: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| AppError::Config(format!("failed to parse legacy store: {e}")))?;

    let repo_path = store.get("repoPath")
        .and_then(|v| v.as_str())
        .map(std::string::ToString::to_string);

    let Some(repo_path) = repo_path else {
        return Ok(None);
    };

    // Try to load existing .alfredo.json for migration data
    let repo_config = crate::config_manager::load_config(&repo_path).await.ok();

    let mode = match repo_config.as_ref() {
        Some(c) if c.branch_mode => RepoMode::Branch,
        _ => RepoMode::Worktree,
    };

    let global = GlobalAppConfig {
        repos: vec![RepoEntry { path: repo_path.clone(), mode }],
        active_repo: Some(repo_path.clone()),
        theme: repo_config.as_ref().and_then(|c| c.theme.clone()),
        notifications: repo_config.as_ref().and_then(|c| c.notifications.clone()),
        selected_repos: vec![repo_path],
        display_name: None,
        repo_colors: std::collections::HashMap::new(),
        repo_display_names: std::collections::HashMap::new(),
        preferred_editor: "vscode".into(),
        custom_editor_path: None,
        preferred_terminal: "iterm".into(),
        custom_terminal_path: None,
        model: None,
        effort: None,
        permission_mode: None,
        dangerously_skip_permissions: None,
        output_style: None,
        verbose: None,
        default_diff_view_mode: None,
        auto_resume: None,
        collapsed_kanban_columns: vec![],
        sidebar_collapsed: None,
        has_seen_orientation: false,
        active_worktree_id: None,
        linear_oauth: None,
        default_agent: None,
    };

    save(app_data_dir, &global).await?;
    Ok(Some(global))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_load_missing_returns_defaults() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let config = load(dir.path()).await?;
        assert!(config.repos.is_empty());
        assert!(config.active_repo.is_none());
        Ok(())
    }

    #[tokio::test]
    async fn test_save_and_load() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let config = GlobalAppConfig {
            repos: vec![RepoEntry {
                path: "/tmp/test-repo".into(),
                mode: RepoMode::Worktree,
            }],
            active_repo: Some("/tmp/test-repo".into()),
            theme: Some("warm-dark".into()),
            notifications: None,
            selected_repos: vec![],
            display_name: None,
            repo_colors: std::collections::HashMap::new(),
            repo_display_names: std::collections::HashMap::new(),
            preferred_editor: "vscode".into(),
            custom_editor_path: None,
            preferred_terminal: "iterm".into(),
            custom_terminal_path: None,
            model: None,
            effort: None,
            permission_mode: None,
            dangerously_skip_permissions: None,
            output_style: None,
            verbose: None,
            default_diff_view_mode: None,
            auto_resume: None,
            collapsed_kanban_columns: vec![],
            sidebar_collapsed: None,
            active_worktree_id: None,
            has_seen_orientation: false,
            linear_oauth: None,
        };
        save(dir.path(), &config).await?;
        let loaded = load(dir.path()).await?;
        assert_eq!(loaded.repos.len(), 1);
        assert_eq!(loaded.active_repo, Some("/tmp/test-repo".into()));
        Ok(())
    }

    #[tokio::test]
    async fn test_add_repo_duplicate_errors() {
        let mut config = GlobalAppConfig {
            repos: vec![RepoEntry {
                path: "/tmp/repo".into(),
                mode: RepoMode::Worktree,
            }],
            active_repo: Some("/tmp/repo".into()),
            theme: None,
            notifications: None,
            selected_repos: vec![],
            display_name: None,
            repo_colors: std::collections::HashMap::new(),
            repo_display_names: std::collections::HashMap::new(),
            preferred_editor: "vscode".into(),
            custom_editor_path: None,
            preferred_terminal: "iterm".into(),
            custom_terminal_path: None,
            model: None,
            effort: None,
            permission_mode: None,
            dangerously_skip_permissions: None,
            output_style: None,
            verbose: None,
            default_diff_view_mode: None,
            auto_resume: None,
            collapsed_kanban_columns: vec![],
            sidebar_collapsed: None,
            active_worktree_id: None,
            has_seen_orientation: false,
            linear_oauth: None,
        };
        let result = add_repo(&mut config, "/tmp/repo".into(), RepoMode::Branch);
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_remove_repo_switches_active() {
        let mut config = GlobalAppConfig {
            repos: vec![
                RepoEntry { path: "/tmp/a".into(), mode: RepoMode::Worktree },
                RepoEntry { path: "/tmp/b".into(), mode: RepoMode::Branch },
            ],
            active_repo: Some("/tmp/a".into()),
            theme: None,
            notifications: None,
            selected_repos: vec![],
            display_name: None,
            repo_colors: std::collections::HashMap::new(),
            repo_display_names: std::collections::HashMap::new(),
            preferred_editor: "vscode".into(),
            custom_editor_path: None,
            preferred_terminal: "iterm".into(),
            custom_terminal_path: None,
            model: None,
            effort: None,
            permission_mode: None,
            dangerously_skip_permissions: None,
            output_style: None,
            verbose: None,
            default_diff_view_mode: None,
            auto_resume: None,
            collapsed_kanban_columns: vec![],
            sidebar_collapsed: None,
            active_worktree_id: None,
            has_seen_orientation: false,
            linear_oauth: None,
        };
        remove_repo(&mut config, "/tmp/a");
        assert_eq!(config.repos.len(), 1);
        assert_eq!(config.active_repo, Some("/tmp/b".into()));
    }
}
