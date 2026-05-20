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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup_scripts: Option<Vec<SetupScript>>,
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
    #[serde(default)]
    pub port_env_var: Option<String>,
    #[serde(default)]
    pub port_range_start: Option<u16>,
    #[serde(default)]
    pub port_range_end: Option<u16>,
}

/// Signature of a JSON-double-encoded command: every `"` is preceded by `\`
/// and there's at least one quote. Mechanical over-encoding hits *every*
/// quote uniformly, so a single un-escaped `"` rules it out — this avoids
/// false-positives on legit commands like `bash -c "echo \"hi\""` where
/// only the inner quotes are escaped.
fn is_overescaped_command(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut quote_count = 0u32;
    for (i, &b) in bytes.iter().enumerate() {
        if b == b'"' {
            quote_count += 1;
            if i == 0 || bytes[i - 1] != b'\\' {
                return false;
            }
        }
    }
    quote_count > 0
}

/// Detect script commands corrupted with a stray `\` before every `"` —
/// historical bug or hand-edit that JSON-escaped quotes a second time. A
/// command typed into the textarea cannot reach the personal config with
/// these sequences, so finding any means the personal layer is broken.
///
/// Null out the affected field rather than guessing which `\` characters
/// were intentional; on the next load the value falls back to upstream
/// `alfredo.json`. Returns true if anything was healed (caller persists).
fn heal_overescaped_scripts(config: &mut AppConfig, repo_path: &str) -> bool {
    let mut healed = false;

    if let Some(scripts) = &config.setup_scripts {
        if scripts.iter().any(|s| is_overescaped_command(&s.command)) {
            eprintln!("[config_manager] healed over-escaped setup_scripts for {repo_path}");
            config.setup_scripts = None;
            healed = true;
        }
    }
    if let Some(rs) = &config.run_script {
        if is_overescaped_command(&rs.command) {
            eprintln!("[config_manager] healed over-escaped run_script for {repo_path}");
            config.run_script = None;
            healed = true;
        }
    }
    if let Some(s) = &config.archive_script {
        if is_overescaped_command(s) {
            eprintln!("[config_manager] healed over-escaped archive_script for {repo_path}");
            config.archive_script = None;
            healed = true;
        }
    }

    healed
}

/// Coerce values that match the type default to `None` so they cleanly
/// inherit from `alfredo.json`. This runs on every load — the on-disk shape
/// pre-`alfredo.json` may have stored type-default values like `[]` or `0`
/// for the six repo-shared fields. We treat those as "user never set this".
fn coerce_repo_shared_defaults(config: &mut AppConfig) {
    if matches!(&config.setup_scripts, Some(v) if v.is_empty()) {
        config.setup_scripts = None;
    }
    if matches!(&config.archive_script, Some(s) if s.is_empty()) {
        config.archive_script = None;
    }
    if matches!(&config.port_env_var, Some(s) if s.is_empty()) {
        config.port_env_var = None;
    }
    if config.port_range_start == Some(0) {
        config.port_range_start = None;
    }
    if config.port_range_end == Some(0) {
        config.port_range_end = None;
    }
    if let Some(rs) = &config.run_script {
        if rs.command.trim().is_empty() {
            config.run_script = None;
        }
    }
}

/// Load the repo config from the app data directory.
/// Auto-migrates from the legacy `<repo_path>/.alfredo.json` if needed.
pub async fn load_personal_config(app_data_dir: &Path, repo_path: &str) -> Result<AppConfig, AppError> {
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
        let mut config = AppConfig {
            repo_path: repo_path.to_string(),
            setup_scripts: None,
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
            port_env_var: None,
            port_range_start: None,
            port_range_end: None,
        };
        coerce_repo_shared_defaults(&mut config);
        return Ok(config);
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

    let mut config = AppConfig {
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
        port_env_var: file.port_env_var,
        port_range_start: file.port_range_start,
        port_range_end: file.port_range_end,
    };
    coerce_repo_shared_defaults(&mut config);
    if heal_overescaped_scripts(&mut config, repo_path) {
        needs_resave = true;
    }

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

/// Load the effective config = personal-overrides layered on top of
/// `<repo>/alfredo.json`. Use this everywhere the app needs to *read* config
/// values (vs. write them, which still goes through `save_config`).
pub async fn load_effective_config(
    app_data_dir: &Path,
    repo_path: &str,
) -> Result<crate::types::EffectiveConfig, AppError> {
    let mut personal = load_personal_config(app_data_dir, repo_path).await?;
    let mut upstream = crate::repo_config::load_alfredo_json(Path::new(repo_path)).await?;

    // One-time migration: if there's no alfredo.json yet but the personal
    // layer has non-default repo-shared values, lift them into alfredo.json
    // and clear them from personal. After this, the user sees those values
    // as `from alfredo.json` and gets a committable diff in their repo.
    if upstream.is_none() {
        let migrated = crate::types::RepoSharedConfig {
            setup_scripts: personal.setup_scripts.clone(),
            run_script: personal.run_script.clone(),
            archive_script: personal.archive_script.clone(),
            port_env_var: personal.port_env_var.clone(),
            port_range_start: personal.port_range_start,
            port_range_end: personal.port_range_end,
        };
        let any = migrated.setup_scripts.is_some()
            || migrated.run_script.is_some()
            || migrated.archive_script.is_some()
            || migrated.port_env_var.is_some()
            || migrated.port_range_start.is_some()
            || migrated.port_range_end.is_some();
        if any {
            crate::repo_config::save_alfredo_json(Path::new(repo_path), &migrated).await?;
            personal.setup_scripts = None;
            personal.run_script = None;
            personal.archive_script = None;
            personal.port_env_var = None;
            personal.port_range_start = None;
            personal.port_range_end = None;
            // Persist the cleared personal layer so the migration is durable.
            write_personal_config_file(app_data_dir, repo_path, &personal).await?;
            upstream = Some(migrated);
        }
    }

    let overrides = crate::types::RepoOverrideFlags {
        setup_scripts: personal.setup_scripts.is_some(),
        run_script: personal.run_script.is_some(),
        archive_script: personal.archive_script.is_some(),
        port_env_var: personal.port_env_var.is_some(),
        port_range_start: personal.port_range_start.is_some(),
        port_range_end: personal.port_range_end.is_some(),
    };

    if let Some(up) = &upstream {
        if personal.setup_scripts.is_none() {
            personal.setup_scripts = up.setup_scripts.clone();
        }
        if personal.run_script.is_none() {
            personal.run_script = up.run_script.clone();
        }
        if personal.archive_script.is_none() {
            personal.archive_script = up.archive_script.clone();
        }
        if personal.port_env_var.is_none() {
            personal.port_env_var = up.port_env_var.clone();
        }
        if personal.port_range_start.is_none() {
            personal.port_range_start = up.port_range_start;
        }
        if personal.port_range_end.is_none() {
            personal.port_range_end = up.port_range_end;
        }
    }

    let upstream_in_git = upstream.is_some()
        && crate::repo_config::alfredo_json_in_git(Path::new(repo_path));

    Ok(crate::types::EffectiveConfig {
        effective: personal,
        overrides,
        upstream,
        upstream_in_git,
    })
}

/// Write the personal-config JSON to disk without touching the keychain.
/// Called by `save_config` after keychain ops, and by the migration path in
/// `load_effective_config` (which deliberately bypasses the keychain).
async fn write_personal_config_file(
    app_data_dir: &Path,
    repo_path: &str,
    config: &AppConfig,
) -> Result<(), AppError> {
    let config_path = repo_config_path(app_data_dir, repo_path);

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
        port_env_var: config.port_env_var.clone(),
        port_range_start: config.port_range_start,
        port_range_end: config.port_range_end,
    };

    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| AppError::Config(format!("failed to serialize config: {e}")))?;

    if let Some(parent) = config_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| AppError::Config(format!("failed to create config dir: {e}")))?;
    }

    crate::atomic_write::write_json_atomic(&config_path, &json)
        .await
        .map_err(|e| AppError::Config(format!("failed to write config: {e}")))?;

    Ok(())
}

/// Save the repo config to the app data directory.
pub async fn save_config(app_data_dir: &Path, repo_path: &str, config: &AppConfig) -> Result<(), AppError> {
    // Persist tokens to keychain rather than JSON.
    match &config.github_token {
        Some(token) if !token.is_empty() => crate::keychain::store("github_token", token)?,
        _ => crate::keychain::delete("github_token")?,
    }
    match &config.linear_api_key {
        Some(key) if !key.is_empty() => crate::keychain::store("linear_api_key", key)?,
        _ => crate::keychain::delete("linear_api_key")?,
    }

    // Strip values that match upstream so personal stays sparse — future edits
    // to alfredo.json then propagate instead of showing as a frozen override.
    let mut to_write = config.clone();
    if let Some(upstream) = crate::repo_config::load_alfredo_json(Path::new(repo_path)).await? {
        if to_write.setup_scripts == upstream.setup_scripts {
            to_write.setup_scripts = None;
        }
        if to_write.run_script == upstream.run_script {
            to_write.run_script = None;
        }
        if to_write.archive_script == upstream.archive_script {
            to_write.archive_script = None;
        }
        if to_write.port_env_var == upstream.port_env_var {
            to_write.port_env_var = None;
        }
        if to_write.port_range_start == upstream.port_range_start {
            to_write.port_range_start = None;
        }
        if to_write.port_range_end == upstream.port_range_end {
            to_write.port_range_end = None;
        }
    }

    write_personal_config_file(app_data_dir, repo_path, &to_write).await?;

    // Drop cached GitHub clients for this repo so a refreshed/cleared token
    // takes effect on the next call without an app restart.
    crate::github_manager::invalidate_for_repo(repo_path).await;

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

/// Release a worktree's port assignment.
pub fn release_port(config: &mut AppConfig, worktree_name: &str) {
    config.port_assignments.remove(worktree_name);
}

/// Remove port assignments whose worktree `id` is not in `live_ids`.
/// Returns the removed keys. Caller must build `live_ids` from an
/// authoritative, *unfiltered* worktree enumeration.
pub fn prune_orphan_ports(
    config: &mut AppConfig,
    live_ids: &std::collections::HashSet<String>,
) -> Vec<String> {
    let stale: Vec<String> = config
        .port_assignments
        .keys()
        .filter(|k| !live_ids.contains(*k))
        .cloned()
        .collect();
    for k in &stale {
        config.port_assignments.remove(k);
    }
    stale
}

/// Collapse runs of whitespace (including embedded newlines) into a single
/// space and trim. Multi-line commands saved before the frontend
/// `normalizeCommand` fix — or written by older Alfredo builds, hand edits,
/// or restored backups — would otherwise be split on `\n` by the shell.
fn normalize_command(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Run setup scripts sequentially in the given worktree directory.
///
/// `repo_path` is the absolute path of the main repo checkout — exposed to
/// scripts as `$ALFREDO_ROOT_PATH` so multi-repo workflows (copying or
/// symlinking files from main) don't have to reverse-engineer the location.
pub async fn run_setup_scripts(
    repo_path: &str,
    worktree_path: &str,
    scripts: &[SetupScript],
) -> Result<(), AppError> {
    let shell = crate::platform::login_shell();
    for script in scripts {
        let command = normalize_command(&script.command);
        // `-l` (login) sources the user's shell profile so PATH and env vars
        // match a normal terminal. `-i` is intentionally omitted: with no TTY
        // attached, interactive init can fail noisily on options like `zle`,
        // and that stderr surfaces in the user-facing error below.
        let output = Command::new(&shell)
            .args(["-l", "-c", &command])
            .current_dir(worktree_path)
            .env("ALFREDO_ROOT_PATH", repo_path)
            .env("ALFREDO_WORKTREE_PATH", worktree_path)
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
            let stdout = String::from_utf8_lossy(&output.stdout);
            let code = output
                .status
                .code()
                .map_or_else(|| "?".to_string(), |c| c.to_string());
            // Many setup-script failures (npm/bundle network flakes, version-manager
            // shell-init exits) leave stderr empty and useful detail on stdout — or
            // produce no output at all. Surface both streams plus the exit code so
            // the user has something to triage from.
            let detail = match (stderr.trim().is_empty(), stdout.trim().is_empty()) {
                (false, true) => format!("stderr: {stderr}"),
                (false, false) => format!("stderr: {stderr}\nstdout: {stdout}"),
                (true, false) => format!("(stderr empty) stdout: {stdout}"),
                (true, true) => "(no output captured on stderr or stdout)".into(),
            };
            return Err(AppError::Config(format!(
                "setup script '{}' failed (exit {code}): {detail}",
                script.name
            )));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_prune_orphan_ports_removes_only_absent_worktrees() {
        let mut config = AppConfig {
            repo_path: "/repo".into(),
            ..Default::default()
        };
        config.port_assignments.insert("/repo::live".into(), 3000);
        config.port_assignments.insert("/repo::gone".into(), 3001);

        let live: std::collections::HashSet<String> =
            ["/repo::live".to_string()].into_iter().collect();
        let pruned = prune_orphan_ports(&mut config, &live);

        assert_eq!(pruned, vec!["/repo::gone".to_string()]);
        assert!(config.port_assignments.contains_key("/repo::live"));
        assert!(!config.port_assignments.contains_key("/repo::gone"));
    }

    #[tokio::test]
    async fn test_load_missing_config_returns_defaults() -> Result<(), Box<dyn std::error::Error>> {
        let app_data = tempfile::TempDir::new()?;
        let repo = tempfile::TempDir::new()?;
        let config = load_personal_config(app_data.path(), repo.path().to_str().unwrap_or_default()).await?;
        assert!(config.setup_scripts.as_deref().unwrap_or(&[]).is_empty());
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
            setup_scripts: Some(vec![SetupScript {
                name: "install".into(),
                command: "npm install".into(),
                run_on: "create".into(),
            }]),
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
            port_env_var: None,
            port_range_start: None,
            port_range_end: None,
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
        let path = dir.path().to_str().unwrap_or_default();
        let result = run_setup_scripts(path, path, &scripts).await;
        assert!(result.is_ok());
        Ok(())
    }

    #[test]
    fn normalize_command_collapses_embedded_newlines_and_runs() {
        // Mirrors the failure mode where a saved alfredo.json contains a
        // literal `\n` mid-chain — zsh would otherwise split on the newline
        // and execute line 2 as a separate command.
        let raw = "  ln -sf a b && ln -sfn                \n  c d && true";
        assert_eq!(
            normalize_command(raw),
            "ln -sf a b && ln -sfn c d && true"
        );
    }

    #[tokio::test]
    async fn test_run_setup_scripts_handles_multiline_command() -> Result<(), Box<dyn std::error::Error>> {
        // The && chain must run as a single statement. Without normalisation,
        // the shell sees `touch marker` on line 1 and `&& touch other` as a
        // syntax error on line 2, so `other` would never be created.
        let dir = tempfile::TempDir::new()?;
        let scripts = vec![SetupScript {
            name: "multiline".into(),
            command: "touch marker\n&& touch other".into(),
            run_on: "create".into(),
        }];
        let path = dir.path().to_str().unwrap_or_default();
        let result = run_setup_scripts(path, path, &scripts).await;
        assert!(result.is_ok(), "multiline command should run as single statement: {result:?}");
        assert!(dir.path().join("marker").exists(), "first half of && chain should run");
        assert!(dir.path().join("other").exists(), "second half of && chain should run");
        Ok(())
    }

    #[tokio::test]
    async fn run_setup_scripts_failure_includes_exit_code_and_stdout() -> Result<(), Box<dyn std::error::Error>> {
        // Regression guard: previously the error swallowed stdout and the exit
        // code, leaving silent-stderr failures (npm flakes, shell-init exits)
        // undiagnosable. The error must surface enough context to triage.
        let dir = tempfile::TempDir::new()?;
        let scripts = vec![SetupScript {
            name: "noisy-fail".into(),
            command: "echo hello-from-stdout && exit 7".into(),
            run_on: "create".into(),
        }];
        let path = dir.path().to_str().unwrap_or_default();
        let err = run_setup_scripts(path, path, &scripts).await.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("exit 7"), "should include exit code: {msg}");
        assert!(msg.contains("hello-from-stdout"), "should include stdout: {msg}");
        Ok(())
    }

    #[tokio::test]
    async fn run_setup_scripts_failure_with_no_output_is_labelled() -> Result<(), Box<dyn std::error::Error>> {
        // The mystery case from the field: shell exits non-zero with empty
        // stdout and stderr. The message must say so explicitly rather than
        // rendering as a bare "failed:" with nothing after the colon.
        let dir = tempfile::TempDir::new()?;
        let scripts = vec![SetupScript {
            name: "silent-fail".into(),
            command: "exit 3".into(),
            run_on: "create".into(),
        }];
        let path = dir.path().to_str().unwrap_or_default();
        let err = run_setup_scripts(path, path, &scripts).await.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("exit 3"), "should include exit code: {msg}");
        assert!(
            msg.contains("no output captured"),
            "should label empty-output case: {msg}"
        );
        Ok(())
    }

    #[tokio::test]
    async fn run_setup_scripts_exposes_root_and_worktree_paths() -> Result<(), Box<dyn std::error::Error>> {
        // Multi-repo setup scripts need a stable way to find the main checkout
        // (e.g. `cp $ALFREDO_ROOT_PATH/.env .env`). Without these env vars they
        // fall back to fragile `git worktree list` parsing.
        let repo = tempfile::TempDir::new()?;
        let worktree = tempfile::TempDir::new()?;
        let scripts = vec![SetupScript {
            name: "echo-paths".into(),
            command: r#"printf '%s\n%s' "$ALFREDO_ROOT_PATH" "$ALFREDO_WORKTREE_PATH" > out.txt"#.into(),
            run_on: "create".into(),
        }];
        let repo_path = repo.path().to_str().unwrap_or_default();
        let worktree_path = worktree.path().to_str().unwrap_or_default();
        run_setup_scripts(repo_path, worktree_path, &scripts).await?;

        let out = tokio::fs::read_to_string(worktree.path().join("out.txt")).await?;
        let mut lines = out.lines();
        assert_eq!(lines.next(), Some(repo_path));
        assert_eq!(lines.next(), Some(worktree_path));
        Ok(())
    }

    #[test]
    fn coerce_zeros_empties_and_empty_vecs_to_none() {
        let mut config = AppConfig {
            repo_path: "/tmp/x".into(),
            setup_scripts: Some(vec![]),
            run_script: Some(crate::types::RunScript {
                command: "".into(),
                ..Default::default()
            }),
            github_token: None,
            linear_api_key: None,
            branch_mode: false,
            column_overrides: HashMap::new(),
            theme: None,
            notifications: None,
            worktree_base_path: None,
            claude_defaults: None,
            worktree_overrides: None,
            stack_parent_overrides: HashMap::new(),
            archive_script: Some("".into()),
            linear_tickets: HashMap::new(),
            port_assignments: HashMap::new(),
            auto_assign_ports: false,
            port_env_var: Some("".into()),
            port_range_start: Some(0),
            port_range_end: Some(0),
        };
        coerce_repo_shared_defaults(&mut config);
        assert!(config.setup_scripts.is_none());
        assert!(config.run_script.is_none());
        assert!(config.archive_script.is_none());
        assert!(config.port_env_var.is_none());
        assert!(config.port_range_start.is_none());
        assert!(config.port_range_end.is_none());
    }

    #[tokio::test]
    async fn load_heals_overescaped_personal_scripts() -> Result<(), Box<dyn std::error::Error>> {
        // A historical bug or hand-edit can leave the personal config with
        // `\"` sequences in script commands, which the shell then passes
        // verbatim (e.g. `cp "/path/.env" .env` with literal quotes around
        // the filename). Once present, the broken value silently shadows
        // upstream `alfredo.json` because precedence checks `is_none()`,
        // not validity. Loading must null out any such field and persist
        // the cleaned state.
        let app_data = tempfile::TempDir::new()?;
        let repo = tempfile::TempDir::new()?;
        let repo_path = repo.path().to_str().unwrap_or_default();

        let personal_dir = repo_data_dir(app_data.path(), repo_path);
        tokio::fs::create_dir_all(&personal_dir).await?;
        let raw = r#"{
            "setupScripts": [{
              "name": "Setup",
              "command": "cp \\\"$ALFREDO_ROOT_PATH/.env\\\" .env",
              "runOn": "create"
            }],
            "runScript": { "name": "Run", "command": "echo \\\"hi\\\"" },
            "archiveScript": "rm \\\"./build\\\"",
            "branchMode": false
        }"#;
        tokio::fs::write(personal_dir.join("config.json"), raw).await?;

        let loaded = load_personal_config(app_data.path(), repo_path).await?;
        assert!(loaded.setup_scripts.is_none(), "broken setup_scripts should be nulled");
        assert!(loaded.run_script.is_none(), "broken run_script should be nulled");
        assert!(loaded.archive_script.is_none(), "broken archive_script should be nulled");

        // Persistence: a second load must not re-detect the corruption,
        // proving the cleaned state was actually written to disk.
        let reloaded = load_personal_config(app_data.path(), repo_path).await?;
        assert!(reloaded.setup_scripts.is_none());
        assert!(reloaded.run_script.is_none());
        assert!(reloaded.archive_script.is_none());
        Ok(())
    }

    #[tokio::test]
    async fn load_preserves_legitimate_escaped_inner_quotes() -> Result<(), Box<dyn std::error::Error>> {
        // `bash -c "echo \"hi\""` is a legit shell idiom: outer quotes
        // are bare `"`, inner quotes are `\"`. Heuristic must not trigger
        // since not *every* quote is escaped.
        let app_data = tempfile::TempDir::new()?;
        let repo = tempfile::TempDir::new()?;
        let repo_path = repo.path().to_str().unwrap_or_default();

        let personal_dir = repo_data_dir(app_data.path(), repo_path);
        tokio::fs::create_dir_all(&personal_dir).await?;
        let raw = r#"{
            "setupScripts": [{
              "name": "Setup",
              "command": "bash -c \"echo \\\"hi\\\"\"",
              "runOn": "create"
            }],
            "branchMode": false
        }"#;
        tokio::fs::write(personal_dir.join("config.json"), raw).await?;

        let loaded = load_personal_config(app_data.path(), repo_path).await?;
        let cmd = &loaded.setup_scripts.as_ref().expect("present")[0].command;
        assert_eq!(cmd, r#"bash -c "echo \"hi\"""#);
        Ok(())
    }

    #[tokio::test]
    async fn load_preserves_legitimate_quoted_scripts() -> Result<(), Box<dyn std::error::Error>> {
        // The textarea writes raw user keystrokes; serde_json adds the JSON
        // escape so the on-disk form is `\"` (one backslash + quote). After
        // parsing it's just `"`. Healing must NOT trigger on these.
        let app_data = tempfile::TempDir::new()?;
        let repo = tempfile::TempDir::new()?;
        let repo_path = repo.path().to_str().unwrap_or_default();

        let personal_dir = repo_data_dir(app_data.path(), repo_path);
        tokio::fs::create_dir_all(&personal_dir).await?;
        let raw = r#"{
            "setupScripts": [{
              "name": "Setup",
              "command": "cp \"$ALFREDO_ROOT_PATH/.env\" .env",
              "runOn": "create"
            }],
            "branchMode": false
        }"#;
        tokio::fs::write(personal_dir.join("config.json"), raw).await?;

        let loaded = load_personal_config(app_data.path(), repo_path).await?;
        let cmd = &loaded.setup_scripts.as_ref().expect("present")[0].command;
        assert_eq!(cmd, r#"cp "$ALFREDO_ROOT_PATH/.env" .env"#);
        Ok(())
    }

    #[tokio::test]
    async fn migration_writes_alfredo_json_and_clears_personal() -> Result<(), Box<dyn std::error::Error>> {
        let app_data = tempfile::TempDir::new()?;
        let repo = tempfile::TempDir::new()?;
        let repo_path = repo.path().to_str().unwrap_or_default();

        // Seed personal layer with a real value, no alfredo.json yet.
        let personal_dir = repo_data_dir(app_data.path(), repo_path);
        tokio::fs::create_dir_all(&personal_dir).await?;
        let personal_json = serde_json::json!({
            "portRangeStart": 3000,
            "portRangeEnd": 3005,
        });
        tokio::fs::write(personal_dir.join("config.json"), personal_json.to_string()).await?;

        let result = load_effective_config(app_data.path(), repo_path).await?;

        // alfredo.json should now exist with the migrated values.
        let alfredo_raw = tokio::fs::read_to_string(repo.path().join("alfredo.json")).await?;
        assert!(alfredo_raw.contains("3000"));
        assert!(alfredo_raw.contains("3005"));

        // Effective values still reflect the migrated values.
        assert_eq!(result.effective.port_range_start, Some(3000));
        assert_eq!(result.effective.port_range_end, Some(3005));

        // Override flags should be false now (inherited, not personal).
        assert!(!result.overrides.port_range_start);
        assert!(!result.overrides.port_range_end);

        // Second call must be a no-op — alfredo.json exists, migration skipped.
        let result2 = load_effective_config(app_data.path(), repo_path).await?;
        assert_eq!(result2.effective.port_range_start, Some(3000));
        assert!(!result2.overrides.port_range_start);
        // Verify file not rewritten — content unchanged.
        let alfredo_raw2 = tokio::fs::read_to_string(repo.path().join("alfredo.json")).await?;
        assert_eq!(alfredo_raw, alfredo_raw2);

        Ok(())
    }

    #[tokio::test]
    async fn migration_skipped_when_no_repo_shared_values() -> Result<(), Box<dyn std::error::Error>> {
        let app_data = tempfile::TempDir::new()?;
        let repo = tempfile::TempDir::new()?;
        let repo_path = repo.path().to_str().unwrap_or_default();

        let _ = load_effective_config(app_data.path(), repo_path).await?;
        // Nothing should have been written.
        let exists = tokio::fs::try_exists(repo.path().join("alfredo.json")).await.unwrap_or(false);
        assert!(!exists);
        Ok(())
    }

    #[tokio::test]
    async fn save_strips_values_equal_to_upstream() -> Result<(), Box<dyn std::error::Error>> {
        // Regression: previously, saving an effective config that contained
        // values inherited from alfredo.json would copy those values into the
        // personal layer. Subsequent edits to alfredo.json then surfaced as
        // false "Edited locally" tags. Save must keep personal sparse.
        let app_data = tempfile::TempDir::new()?;
        let repo = tempfile::TempDir::new()?;
        let repo_path = repo.path().to_str().unwrap_or_default();

        // Upstream alfredo.json defines run_script + port range.
        tokio::fs::write(
            repo.path().join("alfredo.json"),
            r#"{"runScript":{"name":"Run","command":"alfie"},"portRangeStart":3000,"portRangeEnd":3005}"#,
        )
        .await?;

        // Caller passes the merged effective config (e.g. dialog round-trip).
        let mut effective = AppConfig {
            repo_path: repo_path.to_string(),
            setup_scripts: None,
            github_token: None,
            linear_api_key: None,
            branch_mode: false,
            column_overrides: HashMap::new(),
            theme: None,
            notifications: None,
            worktree_base_path: Some("/tmp/wt".into()), // genuine personal field
            claude_defaults: None,
            worktree_overrides: None,
            run_script: Some(crate::types::RunScript {
                name: "Run".into(),
                command: "alfie".into(),
                ..Default::default()
            }),
            stack_parent_overrides: HashMap::new(),
            archive_script: None,
            linear_tickets: HashMap::new(),
            port_assignments: HashMap::new(),
            auto_assign_ports: false,
            port_env_var: None,
            port_range_start: Some(3000),
            port_range_end: Some(3005),
        };

        // save_config may fail on keychain in test env; we only care about JSON.
        let _ = save_config(app_data.path(), repo_path, &effective).await;

        let json_path = repo_config_path(app_data.path(), repo_path);
        let raw = tokio::fs::read_to_string(&json_path).await?;
        let value: serde_json::Value = serde_json::from_str(&raw)?;

        // Inherited values should be null in personal — not duplicated.
        assert!(value["runScript"].is_null(), "run_script equal to upstream must be stripped");
        assert!(value["portRangeStart"].is_null(), "port_range_start equal to upstream must be stripped");
        assert!(value["portRangeEnd"].is_null(), "port_range_end equal to upstream must be stripped");
        // Genuine personal field stays.
        assert_eq!(value["worktreeBasePath"], "/tmp/wt");

        // End-to-end: after the strip, simulate the user editing alfredo.json
        // and reload via load_effective_config. The new upstream value should
        // become the effective value with no override flag set — i.e. exactly
        // the bug Chloe hit ("changed alfredo.json, dialog said diverged").
        tokio::fs::write(
            repo.path().join("alfredo.json"),
            r#"{"runScript":{"name":"Run","command":"alfie-v2"},"portRangeStart":4000,"portRangeEnd":4005}"#,
        )
        .await?;
        let reloaded = load_effective_config(app_data.path(), repo_path).await?;
        assert_eq!(
            reloaded.effective.run_script.as_ref().map(|r| r.command.as_str()),
            Some("alfie-v2"),
            "post-strip alfredo.json edit must propagate to effective",
        );
        assert!(!reloaded.overrides.run_script, "no false divergence after upstream edit");
        assert!(!reloaded.overrides.port_range_start);

        // Now genuinely diverge run_script and confirm it's persisted.
        effective.run_script = Some(crate::types::RunScript {
            name: "Run".into(),
            command: "different".into(),
            ..Default::default()
        });
        let _ = save_config(app_data.path(), repo_path, &effective).await;
        let raw2 = tokio::fs::read_to_string(&json_path).await?;
        let value2: serde_json::Value = serde_json::from_str(&raw2)?;
        assert_eq!(value2["runScript"]["command"], "different");

        Ok(())
    }

    #[tokio::test]
    async fn merges_layers_personal_wins() -> Result<(), Box<dyn std::error::Error>> {
        let app_data = tempfile::TempDir::new()?;
        let repo = tempfile::TempDir::new()?;
        let repo_path = repo.path().to_str().unwrap_or_default();

        // upstream defines port range; personal overrides only setupScripts.
        tokio::fs::write(
            repo.path().join("alfredo.json"),
            r#"{"portRangeStart":3000,"portRangeEnd":3005,"runScript":{"name":"up","command":"./bin/up"}}"#,
        )
        .await?;

        // Seed personal layer with an override of setup_scripts.
        let personal_dir = repo_data_dir(app_data.path(), repo_path);
        tokio::fs::create_dir_all(&personal_dir).await?;
        let personal_json = serde_json::json!({
            "setupScripts": [{"name":"install","command":"yarn install","runOn":"create"}],
        });
        tokio::fs::write(personal_dir.join("config.json"), personal_json.to_string()).await?;

        let result = load_effective_config(app_data.path(), repo_path).await?;
        assert_eq!(result.effective.setup_scripts.as_ref().map(|v| v.len()), Some(1));
        assert_eq!(result.effective.run_script.as_ref().map(|r| r.command.as_str()), Some("./bin/up"));
        assert_eq!(result.effective.port_range_start, Some(3000));
        assert!(result.overrides.setup_scripts);
        assert!(!result.overrides.run_script);
        assert!(!result.overrides.port_range_start);
        assert!(result.upstream.is_some());
        Ok(())
    }
}
