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
            repo_short_labels: std::collections::HashMap::new(),
            worktree_labels: std::collections::HashMap::new(),
            preferred_editor: "vscode".into(),
            custom_editor_path: None,
            preferred_terminal: "iterm".into(),
            custom_terminal_path: None,
            dangerously_skip_permissions: None,
            extra_flags: None,
            default_diff_view_mode: None,
            collapsed_kanban_columns: vec![],
            sidebar_collapsed: None,
            hide_unpinned_worktrees: None,
            show_main_card_repos: vec![],
            has_seen_orientation: false,
            active_worktree_id: None,
            linear_oauth: None,
            default_agent: None,
            archive_after_days: Some(2),
            delete_after_days: None,
            debug_mode: None,
            comment_chips: vec![],
            dismissed_lifecycle_nudge: false,
            receive_beta_updates: false,
            auto_pull_review_requests: true,
            auto_sync_native_stacks: true,
            whats_new_last_seen: None,
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

    // Migration: rewrite removed/invalid sound ids to "coin". Keep in sync with
    // SOUND_IDS in src/hooks/notificationUtils.ts.
    const VALID_SOUNDS: &[&str] = &[
        "none", "coin", "alfie", "bigben", "mail", "pacman",
        "oof", "honk", "ahooga", "boing", "microwave",
        "shutter", "seatbelt", "powerup", "blip", "levelup",
        "doorbell", "fwump", "quack", "bear",
    ];
    if let Some(ref mut notif) = config.notifications {
        if !VALID_SOUNDS.contains(&notif.sound.as_str()) {
            notif.sound = "coin".to_string();
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

    crate::atomic_write::write_json_atomic(&path, &json)
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

/// Advance the what's-new marker, never rewinding it — a downgrade must not
/// re-trigger the popup for content the user already dismissed. Returns true
/// when the config changed and therefore needs saving.
pub fn advance_whats_new_seen(config: &mut GlobalAppConfig, version: &str) -> bool {
    if let Some(current) = config.whats_new_last_seen.as_deref() {
        if !crate::ask_alfredo::whats_new::version_gt(version, current) {
            return false;
        }
    }
    config.whats_new_last_seen = Some(version.to_string());
    true
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
    let repo_config = crate::config_manager::load_personal_config(app_data_dir, &repo_path).await.ok();

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
        repo_short_labels: std::collections::HashMap::new(),
        worktree_labels: std::collections::HashMap::new(),
        preferred_editor: "vscode".into(),
        custom_editor_path: None,
        preferred_terminal: "iterm".into(),
        custom_terminal_path: None,
        dangerously_skip_permissions: None,
        extra_flags: None,
        default_diff_view_mode: None,
        collapsed_kanban_columns: vec![],
        sidebar_collapsed: None,
        hide_unpinned_worktrees: None,
        show_main_card_repos: vec![],
        has_seen_orientation: false,
        active_worktree_id: None,
        linear_oauth: None,
        default_agent: None,
        archive_after_days: Some(2),
        delete_after_days: None,
        debug_mode: None,
        comment_chips: vec![],
        dismissed_lifecycle_nudge: false,
        receive_beta_updates: false,
        auto_pull_review_requests: true,
        auto_sync_native_stacks: true,
        whats_new_last_seen: None,
    };

    save(app_data_dir, &global).await?;
    Ok(Some(global))
}

/// Synchronous, best-effort read of `app.json` for use before the Tauri
/// app handle is available. Returns `None` on any error.
pub fn load_sync_best_effort() -> Option<GlobalAppConfig> {
    let app_data = dirs::data_dir()?.join("com.alfredo.app");
    let path = app_data.join("app.json");
    let contents = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str::<GlobalAppConfig>(&contents).ok()
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
            repo_short_labels: std::collections::HashMap::new(),
            worktree_labels: std::collections::HashMap::new(),
            preferred_editor: "vscode".into(),
            custom_editor_path: None,
            preferred_terminal: "iterm".into(),
            custom_terminal_path: None,
            dangerously_skip_permissions: None,
            extra_flags: None,
            default_diff_view_mode: None,
            collapsed_kanban_columns: vec![],
            sidebar_collapsed: None,
            hide_unpinned_worktrees: None,
            show_main_card_repos: vec![],
            active_worktree_id: None,
            has_seen_orientation: false,
            linear_oauth: None,
            default_agent: None,
            archive_after_days: Some(2),
            delete_after_days: None,
            debug_mode: None,
            comment_chips: vec![],
            dismissed_lifecycle_nudge: false,
            receive_beta_updates: false,
            auto_pull_review_requests: true,
            auto_sync_native_stacks: true,
            whats_new_last_seen: None,
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
            repo_short_labels: std::collections::HashMap::new(),
            worktree_labels: std::collections::HashMap::new(),
            preferred_editor: "vscode".into(),
            custom_editor_path: None,
            preferred_terminal: "iterm".into(),
            custom_terminal_path: None,
            dangerously_skip_permissions: None,
            extra_flags: None,
            default_diff_view_mode: None,
            collapsed_kanban_columns: vec![],
            sidebar_collapsed: None,
            hide_unpinned_worktrees: None,
            show_main_card_repos: vec![],
            active_worktree_id: None,
            has_seen_orientation: false,
            linear_oauth: None,
            default_agent: None,
            archive_after_days: Some(2),
            delete_after_days: None,
            debug_mode: None,
            comment_chips: vec![],
            dismissed_lifecycle_nudge: false,
            receive_beta_updates: false,
            auto_pull_review_requests: true,
            auto_sync_native_stacks: true,
            whats_new_last_seen: None,
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
            repo_short_labels: std::collections::HashMap::new(),
            worktree_labels: std::collections::HashMap::new(),
            preferred_editor: "vscode".into(),
            custom_editor_path: None,
            preferred_terminal: "iterm".into(),
            custom_terminal_path: None,
            dangerously_skip_permissions: None,
            extra_flags: None,
            default_diff_view_mode: None,
            collapsed_kanban_columns: vec![],
            sidebar_collapsed: None,
            hide_unpinned_worktrees: None,
            show_main_card_repos: vec![],
            active_worktree_id: None,
            has_seen_orientation: false,
            linear_oauth: None,
            default_agent: None,
            archive_after_days: Some(2),
            delete_after_days: None,
            debug_mode: None,
            comment_chips: vec![],
            dismissed_lifecycle_nudge: false,
            receive_beta_updates: false,
            auto_pull_review_requests: true,
            auto_sync_native_stacks: true,
            whats_new_last_seen: None,
        };
        remove_repo(&mut config, "/tmp/a");
        assert_eq!(config.repos.len(), 1);
        assert_eq!(config.active_repo, Some("/tmp/b".into()));
    }

    #[tokio::test]
    async fn test_comment_chips_round_trip_preserves_order() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let path = config_path(dir.path());
        tokio::fs::create_dir_all(dir.path()).await?;
        let json = serde_json::json!({
            "commentChips": ["fix this", "explain", "add tests"]
        });
        tokio::fs::write(&path, serde_json::to_string_pretty(&json)?).await?;
        let loaded = load(dir.path()).await?;
        assert_eq!(loaded.comment_chips, vec!["fix this", "explain", "add tests"]);
        Ok(())
    }

    #[tokio::test]
    async fn test_comment_chips_missing_defaults_to_empty() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let path = config_path(dir.path());
        tokio::fs::create_dir_all(dir.path()).await?;
        // No commentChips field at all — serde(default) should give empty vec.
        tokio::fs::write(&path, "{}").await?;
        let loaded = load(dir.path()).await?;
        assert!(loaded.comment_chips.is_empty());
        Ok(())
    }

    #[test]
    fn global_config_without_extra_flags_deserializes_to_none() {
        let cfg: crate::types::GlobalAppConfig = serde_json::from_str("{}").unwrap();
        assert_eq!(cfg.extra_flags, None);
    }

    #[tokio::test]
    async fn advance_whats_new_seen_sets_marker_when_unset()
    -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let mut config = load(dir.path()).await?;
        assert!(advance_whats_new_seen(&mut config, "0.20.0"));
        assert_eq!(config.whats_new_last_seen.as_deref(), Some("0.20.0"));
        Ok(())
    }

    #[tokio::test]
    async fn advance_whats_new_seen_moves_marker_forward()
    -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let mut config = load(dir.path()).await?;
        config.whats_new_last_seen = Some("0.19.0".into());
        assert!(advance_whats_new_seen(&mut config, "0.20.0"));
        assert_eq!(config.whats_new_last_seen.as_deref(), Some("0.20.0"));
        Ok(())
    }

    #[tokio::test]
    async fn advance_whats_new_seen_never_rewinds() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let mut config = load(dir.path()).await?;
        config.whats_new_last_seen = Some("0.20.0".into());
        assert!(!advance_whats_new_seen(&mut config, "0.19.0"));
        assert_eq!(config.whats_new_last_seen.as_deref(), Some("0.20.0"));
        Ok(())
    }

    #[tokio::test]
    async fn advance_whats_new_seen_is_idempotent() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let mut config = load(dir.path()).await?;
        config.whats_new_last_seen = Some("0.20.0".into());
        assert!(!advance_whats_new_seen(&mut config, "0.20.0"));
        Ok(())
    }

    #[test]
    fn test_auto_pull_review_requests_defaults_true() {
        let config: crate::types::GlobalAppConfig = serde_json::from_str("{}").unwrap();
        assert!(config.auto_pull_review_requests);
    }

    #[test]
    fn test_auto_sync_native_stacks_defaults_true() {
        let config: crate::types::GlobalAppConfig = serde_json::from_str("{}").unwrap();
        assert!(config.auto_sync_native_stacks);
    }
}
