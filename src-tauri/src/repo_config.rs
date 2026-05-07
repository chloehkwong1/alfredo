//! Read/write `<repo>/alfredo.json` — the committed, repo-wide config layer.

use std::path::Path;

use crate::types::{AppError, RepoSharedConfig};

const FILENAME: &str = "alfredo.json";

/// True when `<repo>/alfredo.json` is in the git index — i.e. staged or
/// committed, and not a local-only artifact (e.g. one written silently by
/// the personal→upstream migration before the user committed anything).
///
/// Returns false for non-git directories, when libgit2 errors, or when the
/// file isn't tracked. The chip uses this to warn that "Tracking alfredo.json"
/// is reading a file no teammate will ever see.
pub fn alfredo_json_in_git(repo_path: &Path) -> bool {
    let Ok(repo) = git2::Repository::open(repo_path) else { return false; };
    let Ok(index) = repo.index() else { return false; };
    index.get_path(Path::new(FILENAME), 0).is_some()
}

/// Load `<repo>/alfredo.json`. Returns `Ok(None)` if the file does not exist,
/// `Err(AppError::Config(...))` if the file exists but cannot be parsed.
pub async fn load_alfredo_json(repo_path: &Path) -> Result<Option<RepoSharedConfig>, AppError> {
    let path = repo_path.join(FILENAME);
    match tokio::fs::read_to_string(&path).await {
        Ok(contents) => {
            let config: RepoSharedConfig = serde_json::from_str(&contents)
                .map_err(|e| AppError::Config(format!("failed to parse alfredo.json: {e}")))?;
            Ok(Some(config))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(AppError::Config(format!("failed to read alfredo.json: {e}"))),
    }
}

/// Write `<repo>/alfredo.json`. The `$schema` pointer is added on top so
/// editors that support JSON schema (VS Code, JetBrains) get autocomplete
/// when the user hand-edits the file.
const SCHEMA_URL: &str =
    "https://raw.githubusercontent.com/chloehkwong1/alfredo/main/schemas/alfredo.schema.json";

pub async fn save_alfredo_json(
    repo_path: &Path,
    config: &RepoSharedConfig,
) -> Result<(), AppError> {
    let mut value = serde_json::to_value(config)
        .map_err(|e| AppError::Config(format!("failed to serialize alfredo.json: {e}")))?;
    if let serde_json::Value::Object(ref mut map) = value {
        map.insert("$schema".to_string(), serde_json::Value::String(SCHEMA_URL.to_string()));
    }

    let json = serde_json::to_string_pretty(&value)
        .map_err(|e| AppError::Config(format!("failed to serialize alfredo.json: {e}")))?;
    let path = repo_path.join(FILENAME);
    tokio::fs::write(&path, format!("{json}\n"))
        .await
        .map_err(|e| AppError::Config(format!("failed to write alfredo.json: {e}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SetupScript;

    #[tokio::test]
    async fn in_git_false_when_not_a_repo() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        tokio::fs::write(dir.path().join("alfredo.json"), "{}").await?;
        assert!(!alfredo_json_in_git(dir.path()));
        Ok(())
    }

    #[tokio::test]
    async fn in_git_false_when_untracked() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        git2::Repository::init(dir.path())?;
        tokio::fs::write(dir.path().join("alfredo.json"), "{}").await?;
        assert!(!alfredo_json_in_git(dir.path()));
        Ok(())
    }

    #[tokio::test]
    async fn in_git_true_when_staged() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let repo = git2::Repository::init(dir.path())?;
        tokio::fs::write(dir.path().join("alfredo.json"), "{}").await?;
        let mut index = repo.index()?;
        index.add_path(Path::new("alfredo.json"))?;
        index.write()?;
        assert!(alfredo_json_in_git(dir.path()));
        Ok(())
    }

    #[tokio::test]
    async fn returns_none_when_file_missing() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let result = load_alfredo_json(dir.path()).await?;
        assert!(result.is_none());
        Ok(())
    }

    #[tokio::test]
    async fn loads_valid_file() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        tokio::fs::write(
            dir.path().join("alfredo.json"),
            r#"{"setupScripts":[{"name":"i","command":"echo hi","runOn":"create"}],"portRangeStart":3000}"#,
        )
        .await?;
        let result = load_alfredo_json(dir.path()).await?.expect("present");
        assert_eq!(result.setup_scripts.as_ref().map(|v| v.len()), Some(1));
        assert_eq!(result.port_range_start, Some(3000));
        Ok(())
    }

    #[tokio::test]
    async fn malformed_returns_err() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        tokio::fs::write(dir.path().join("alfredo.json"), "{ not json").await?;
        let result = load_alfredo_json(dir.path()).await;
        assert!(result.is_err());
        Ok(())
    }

    #[tokio::test]
    async fn saves_round_trips() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let config = RepoSharedConfig {
            setup_scripts: Some(vec![SetupScript {
                name: "install".into(),
                command: "yarn install".into(),
                run_on: "create".into(),
            }]),
            port_range_start: Some(3000),
            port_range_end: Some(3005),
            ..Default::default()
        };
        save_alfredo_json(dir.path(), &config).await?;
        let loaded = load_alfredo_json(dir.path()).await?.expect("present");
        assert_eq!(loaded.port_range_start, Some(3000));
        assert_eq!(loaded.port_range_end, Some(3005));
        assert_eq!(loaded.setup_scripts.as_ref().map(|v| v.len()), Some(1));
        Ok(())
    }

    #[tokio::test]
    async fn save_omits_none_fields_from_json() -> Result<(), Box<dyn std::error::Error>> {
        let dir = tempfile::TempDir::new()?;
        let config = RepoSharedConfig {
            run_script: Some(crate::types::RunScript {
                command: "./bin/serve".into(),
                ..Default::default()
            }),
            ..Default::default()
        };
        save_alfredo_json(dir.path(), &config).await?;
        let raw = tokio::fs::read_to_string(dir.path().join("alfredo.json")).await?;
        assert!(raw.contains("runScript"));
        assert!(!raw.contains("setupScripts"));
        assert!(!raw.contains("portRangeStart"));
        Ok(())
    }
}
