use crate::config_manager;
use crate::github_manager::GithubManager;
use crate::types::{AppError, PrStatus};

type Result<T> = std::result::Result<T, AppError>;

/// Parse "owner/repo" from a repo path by reading the git remote.
async fn resolve_owner_repo(repo_path: &str) -> Result<(String, String)> {
    let output = tokio::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::Github(format!("failed to get remote URL: {e}")))?;

    if !output.status.success() {
        return Err(AppError::Github("no origin remote found".into()));
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    parse_github_owner_repo(&url)
        .ok_or_else(|| AppError::Github(format!("could not parse owner/repo from: {url}")))
}

/// Extract owner and repo from a GitHub URL (HTTPS or SSH).
fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
    // SSH: git@github.com:owner/repo.git
    // HTTPS: https://github.com/owner/repo.git
    let path = url
        .strip_prefix("git@github.com:")
        .or_else(|| url.strip_prefix("https://github.com/"))?;

    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.splitn(2, '/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();

    if owner.is_empty() || repo.is_empty() {
        return None;
    }

    Some((owner, repo))
}

/// Fetch all open PRs for the configured repository.
#[tauri::command]
pub async fn sync_pr_status(repo_path: String) -> Result<Vec<PrStatus>> {
    let config = config_manager::load_config(&repo_path).await?;
    let token = config
        .github_token
        .ok_or_else(|| AppError::Github("no GitHub token configured".into()))?;

    let (owner, repo) = resolve_owner_repo(&repo_path).await?;
    let manager = GithubManager::new(&token)?;
    manager.sync_prs(&owner, &repo).await
}

/// Get the PR associated with a specific branch, if any.
#[tauri::command]
pub async fn get_pr_for_branch(
    owner: String,
    repo: String,
    branch: String,
) -> Result<Option<PrStatus>> {
    // For this command we need a token — try to get it from env as fallback
    let token = std::env::var("GITHUB_TOKEN")
        .map_err(|_| AppError::Github("no GitHub token available".into()))?;

    let manager = GithubManager::new(&token)?;
    manager.get_pr_for_branch(&owner, &repo, &branch).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ssh_url() {
        let result = parse_github_owner_repo("git@github.com:acme/alfredo.git");
        assert_eq!(result, Some(("acme".into(), "alfredo".into())));
    }

    #[test]
    fn test_parse_https_url() {
        let result = parse_github_owner_repo("https://github.com/acme/alfredo.git");
        assert_eq!(result, Some(("acme".into(), "alfredo".into())));
    }

    #[test]
    fn test_parse_https_no_git_suffix() {
        let result = parse_github_owner_repo("https://github.com/acme/alfredo");
        assert_eq!(result, Some(("acme".into(), "alfredo".into())));
    }

    #[test]
    fn test_parse_invalid_url() {
        assert!(parse_github_owner_repo("not-a-url").is_none());
    }
}
