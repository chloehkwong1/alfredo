//! Read/write `<repo>/alfredo.json` — the committed, repo-wide config layer.

use std::path::Path;

use crate::types::{AppError, RepoSharedConfig};

const FILENAME: &str = "alfredo.json";

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
