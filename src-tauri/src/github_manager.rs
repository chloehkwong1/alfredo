use octocrab::Octocrab;

use crate::types::{AppError, CheckRun, KanbanColumn, PrStatus};

/// Get a GitHub token: tries `gh auth token` first, falls back to the provided config token.
pub async fn resolve_token(config_token: Option<&str>) -> Result<String, AppError> {
    // Try gh CLI first
    if let Ok(output) = tokio::process::Command::new("gh")
        .args(["auth", "token"])
        .output()
        .await
    {
        if output.status.success() {
            if let Ok(token) = String::from_utf8(output.stdout) {
                let token = token.trim().to_string();
                if !token.is_empty() {
                    return Ok(token);
                }
            }
        }
    }

    // Fall back to stored config token
    config_token
        .filter(|t| !t.is_empty())
        .map(String::from)
        .ok_or_else(|| AppError::Github("no GitHub token available — install and authenticate the gh CLI: brew install gh && gh auth login".into()))
}

/// Format an octocrab error with useful detail (status code, message body).
fn format_octocrab_error(context: &str, e: octocrab::Error) -> AppError {
    let detail = match &e {
        octocrab::Error::GitHub { source, .. } => {
            format!("{context}: {} ({})", source.message, source.documentation_url.as_deref().unwrap_or(""))
        }
        _ => format!("{context}: {e:?}"),
    };
    AppError::Github(detail)
}

/// Manages GitHub API interactions via octocrab.
pub struct GithubManager {
    client: Octocrab,
}

impl GithubManager {
    /// Create a new GithubManager with a GitHub token (PAT, OAuth, or gh CLI token).
    pub fn new(token: &str) -> Result<Self, AppError> {
        let client = Octocrab::builder()
            .personal_token(token.to_string())
            .build()
            .map_err(|e| AppError::Github(format!("failed to build octocrab client: {e}")))?;
        Ok(Self { client })
    }

    /// Fetch all open PRs and recently merged PRs for the given owner/repo.
    pub async fn sync_prs(&self, owner: &str, repo: &str) -> Result<Vec<PrStatus>, AppError> {
        let open_page = self
            .client
            .pulls(owner, repo)
            .list()
            .state(octocrab::params::State::Open)
            .per_page(100)
            .send()
            .await
            .map_err(|e| format_octocrab_error("failed to fetch PRs", e))?;

        let mut prs: Vec<PrStatus> = open_page
            .items
            .into_iter()
            .map(|pr| PrStatus {
                number: pr.number,
                state: pr
                    .state
                    .map(|s| format!("{s:?}").to_lowercase())
                    .unwrap_or_else(|| "open".to_string()),
                title: pr.title.unwrap_or_default(),
                url: pr
                    .html_url
                    .map(|u| u.to_string())
                    .unwrap_or_default(),
                draft: pr.draft.unwrap_or(false),
                merged: false, // open PRs aren't merged
                branch: pr.head.ref_field,
                merged_at: None,
            })
            .collect();

        let closed_page = self
            .client
            .pulls(owner, repo)
            .list()
            .state(octocrab::params::State::Closed)
            .sort(octocrab::params::pulls::Sort::Updated)
            .direction(octocrab::params::Direction::Descending)
            .per_page(30)
            .send()
            .await
            .map_err(|e| format_octocrab_error("failed to fetch closed PRs", e))?;

        let merged_prs = closed_page
            .items
            .into_iter()
            .filter(|pr| pr.merged_at.is_some())
            .map(|pr| PrStatus {
                number: pr.number,
                state: pr
                    .state
                    .map(|s| format!("{s:?}").to_lowercase())
                    .unwrap_or_else(|| "closed".to_string()),
                title: pr.title.unwrap_or_default(),
                url: pr
                    .html_url
                    .map(|u| u.to_string())
                    .unwrap_or_default(),
                draft: pr.draft.unwrap_or(false),
                merged: true,
                branch: pr.head.ref_field,
                merged_at: pr.merged_at.map(|dt| dt.to_rfc3339()),
            });

        prs.extend(merged_prs);

        Ok(prs)
    }

    /// Fetch the PR associated with a specific branch head, if any.
    pub async fn get_pr_for_branch(
        &self,
        owner: &str,
        repo: &str,
        branch: &str,
    ) -> Result<Option<PrStatus>, AppError> {
        let page = self
            .client
            .pulls(owner, repo)
            .list()
            .state(octocrab::params::State::All)
            .head(format!("{owner}:{branch}"))
            .per_page(1)
            .send()
            .await
            .map_err(|e| format_octocrab_error("failed to fetch PR for branch", e))?;

        let pr = match page.items.into_iter().next() {
            Some(pr) => pr,
            None => return Ok(None),
        };

        let merged_at = pr.merged_at.map(|dt| dt.to_rfc3339());
        let merged = merged_at.is_some();
        let draft = pr.draft.unwrap_or(false);

        let branch = pr.head.ref_field.clone();

        Ok(Some(PrStatus {
            number: pr.number,
            state: pr
                .state
                .map(|s| format!("{s:?}").to_lowercase())
                .unwrap_or_else(|| "open".to_string()),
            title: pr.title.unwrap_or_default(),
            url: pr
                .html_url
                .map(|u| u.to_string())
                .unwrap_or_default(),
            draft,
            merged,
            branch,
            merged_at,
        }))
    }

    /// Fetch check runs for a given git ref (branch, SHA, or tag).
    pub async fn get_check_runs(
        &self,
        owner: &str,
        repo: &str,
        git_ref: &str,
    ) -> Result<Vec<CheckRun>, AppError> {
        let url = format!("/repos/{owner}/{repo}/commits/{git_ref}/check-runs");
        let response: serde_json::Value = self
            .client
            .get(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch check runs", e))?;

        let check_runs = response
            .get("check_runs")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|run| {
                        Some(CheckRun {
                            id: run.get("id")?.as_u64()?,
                            name: run.get("name")?.as_str()?.to_string(),
                            status: run.get("status")?.as_str()?.to_string(),
                            conclusion: run
                                .get("conclusion")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            html_url: run.get("html_url")?.as_str()?.to_string(),
                            started_at: run
                                .get("started_at")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                            completed_at: run
                                .get("completed_at")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(check_runs)
    }
}

/// Extract owner and repo from a GitHub URL (HTTPS or SSH).
pub fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
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

/// Resolve owner/repo from a repo path by reading the git remote URL.
pub async fn resolve_owner_repo(repo_path: &str) -> Result<(String, String), AppError> {
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

/// Determine the kanban column for a worktree based on its PR status.
pub fn determine_column(pr: Option<&PrStatus>) -> KanbanColumn {
    match pr {
        None => KanbanColumn::InProgress,
        Some(pr) if pr.merged => KanbanColumn::Done,
        Some(pr) if pr.draft => KanbanColumn::DraftPr,
        Some(_) => KanbanColumn::OpenPr,
    }
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

    #[test]
    fn test_determine_column_no_pr() {
        assert_eq!(determine_column(None), KanbanColumn::InProgress);
    }

    #[test]
    fn test_determine_column_draft() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: "".into(),
            draft: true,
            merged: false,
            branch: "feat/test".into(),
            merged_at: None,
        };
        assert_eq!(determine_column(Some(&pr)), KanbanColumn::DraftPr);
    }

    #[test]
    fn test_determine_column_open() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: "".into(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            merged_at: None,
        };
        assert_eq!(determine_column(Some(&pr)), KanbanColumn::OpenPr);
    }

    #[test]
    fn test_determine_column_merged() {
        let pr = PrStatus {
            number: 1,
            state: "closed".into(),
            title: "test".into(),
            url: "".into(),
            draft: false,
            merged: true,
            branch: "feat/test".into(),
            merged_at: None,
        };
        assert_eq!(determine_column(Some(&pr)), KanbanColumn::Done);
    }
}
