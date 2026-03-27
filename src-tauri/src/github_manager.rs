use octocrab::Octocrab;

use crate::types::{AppError, CheckRun, KanbanColumn, PrComment, PrDetailedStatus, PrReview, PrStatus, WorkflowRunLog};

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
    token: String,
}

impl GithubManager {
    /// Create a new GithubManager with a GitHub token (PAT, OAuth, or gh CLI token).
    pub fn new(token: &str) -> Result<Self, AppError> {
        let client = Octocrab::builder()
            .personal_token(token.to_string())
            .build()
            .map_err(|e| AppError::Github(format!("failed to build octocrab client: {e}")))?;
        Ok(Self { client, token: token.to_string() })
    }

    fn token(&self) -> &str {
        &self.token
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
                head_sha: Some(pr.head.sha),
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
                head_sha: Some(pr.head.sha),
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
        let head_sha = pr.head.sha.clone();

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
            head_sha: Some(head_sha),
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
                            check_suite_id: run
                                .pointer("/check_suite/id")
                                .and_then(|v| v.as_u64()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(check_runs)
    }

    /// Fetch reviews for a PR.
    pub async fn get_pr_reviews(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<PrReview>, AppError> {
        let url = format!("/repos/{owner}/{repo}/pulls/{pr_number}/reviews");
        let response: serde_json::Value = self
            .client
            .get(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch PR reviews", e))?;

        let reviews = response
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|review| {
                        Some(PrReview {
                            reviewer: review.get("user")?.get("login")?.as_str()?.to_string(),
                            state: review.get("state")?.as_str()?.to_lowercase(),
                            submitted_at: review.get("submitted_at").and_then(|v| v.as_str()).map(|s| s.to_string()),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(reviews)
    }

    /// Fetch line-level review comments for a PR.
    pub async fn get_pr_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<PrComment>, AppError> {
        let url = format!("/repos/{owner}/{repo}/pulls/{pr_number}/comments");
        let response: serde_json::Value = self
            .client
            .get(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch PR comments", e))?;

        let comments = response
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| {
                        Some(PrComment {
                            id: c.get("id")?.as_u64()?,
                            author: c.get("user")?.get("login")?.as_str()?.to_string(),
                            body: c.get("body")?.as_str()?.to_string(),
                            path: c.get("path").and_then(|v| v.as_str()).map(|s| s.to_string()),
                            line: c.get("line").and_then(|v| v.as_u64()).map(|n| n as u32),
                            // GitHub's REST API for pull request review comments does not expose a
                            // "resolved" field. The resolved/unresolved state of a review thread is
                            // only available via the GraphQL API (`pullRequest.reviewThreads.isResolved`).
                            // Until we add a GraphQL call, all comments are treated as unresolved so
                            // none are accidentally hidden from the user.
                            resolved: false,
                            created_at: c.get("created_at")?.as_str()?.to_string(),
                            updated_at: c.get("updated_at")?.as_str()?.to_string(),
                            html_url: c.get("html_url")?.as_str()?.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(comments)
    }

    /// Fetch general (non-line-level) comments on a PR.
    pub async fn get_pr_issue_comments(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<PrComment>, AppError> {
        let url = format!("/repos/{owner}/{repo}/issues/{pr_number}/comments");
        let response: serde_json::Value = self
            .client
            .get(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch issue comments", e))?;

        let comments = response
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|c| {
                        Some(PrComment {
                            id: c.get("id")?.as_u64()?,
                            author: c.get("user")?.get("login")?.as_str()?.to_string(),
                            body: c.get("body")?.as_str()?.to_string(),
                            path: None,
                            line: None,
                            // Issue comments on a PR (general discussion) have no "resolved"
                            // concept in the REST API; always false. See the note in
                            // `get_pr_comments` for full context.
                            resolved: false,
                            created_at: c.get("created_at")?.as_str()?.to_string(),
                            updated_at: c.get("updated_at")?.as_str()?.to_string(),
                            html_url: c.get("html_url")?.as_str()?.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();

        Ok(comments)
    }

    /// Fetch only the `mergeable` field for a PR (single API call).
    /// Used by the sync loop to avoid the heavier `get_pr_detail`.
    pub async fn get_pr_mergeable(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Option<bool>, AppError> {
        let url = format!("/repos/{owner}/{repo}/pulls/{pr_number}");
        let response: serde_json::Value = self
            .client
            .get(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch PR for mergeable", e))?;
        Ok(response.get("mergeable").and_then(|v| v.as_bool()))
    }

    /// Fetch detailed PR info: reviews, comments, and mergeable status.
    pub async fn get_pr_detail(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<PrDetailedStatus, AppError> {
        // Fetch PR for mergeable status
        let pr_url = format!("/repos/{owner}/{repo}/pulls/{pr_number}");
        let pr_response: serde_json::Value = self
            .client
            .get(pr_url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch PR detail", e))?;

        let mergeable = pr_response.get("mergeable").and_then(|v| v.as_bool());

        // Fetch reviews, line comments, and issue comments concurrently
        let (reviews, line_comments, issue_comments) = tokio::join!(
            self.get_pr_reviews(owner, repo, pr_number),
            self.get_pr_comments(owner, repo, pr_number),
            self.get_pr_issue_comments(owner, repo, pr_number),
        );

        let reviews = reviews?;
        let mut comments = line_comments?;
        comments.extend(issue_comments?);

        // Deduplicate reviews: keep only the latest review per reviewer
        let mut latest_reviews: std::collections::HashMap<String, PrReview> =
            std::collections::HashMap::new();
        for review in reviews {
            latest_reviews
                .entry(review.reviewer.clone())
                .and_modify(|existing| {
                    if review.submitted_at > existing.submitted_at {
                        *existing = review.clone();
                    }
                })
                .or_insert(review);
        }
        let deduped_reviews: Vec<PrReview> = latest_reviews.into_values().collect();

        // Derive review decision from individual reviews
        let review_decision = if deduped_reviews.iter().any(|r| r.state == "changes_requested") {
            Some("changes_requested".to_string())
        } else if deduped_reviews.iter().any(|r| r.state == "approved") {
            Some("approved".to_string())
        } else {
            Some("review_required".to_string())
        };

        Ok(PrDetailedStatus {
            reviews: deduped_reviews,
            comments,
            mergeable,
            review_decision,
        })
    }

    /// Re-run only the failed jobs in a workflow run.
    pub async fn rerun_failed_jobs(
        &self,
        owner: &str,
        repo: &str,
        run_id: u64,
    ) -> Result<(), AppError> {
        let url = format!("/repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs");
        let _: serde_json::Value = self.client
            .post(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to re-run failed jobs", e))?;
        Ok(())
    }

    /// Get the workflow run ID for a check run (needed for re-run/log download).
    pub async fn get_workflow_run_id_for_check_suite(
        &self,
        owner: &str,
        repo: &str,
        check_suite_id: u64,
    ) -> Result<Option<u64>, AppError> {
        let url = format!(
            "/repos/{owner}/{repo}/actions/runs?check_suite_id={check_suite_id}"
        );
        let response: serde_json::Value = self
            .client
            .get(url, None::<&()>)
            .await
            .map_err(|e| format_octocrab_error("failed to fetch workflow runs", e))?;

        let run_id = response
            .get("workflow_runs")
            .and_then(|v| v.as_array())
            .and_then(|runs| runs.first())
            .and_then(|run| run.get("id"))
            .and_then(|v| v.as_u64());

        Ok(run_id)
    }

    /// Download and extract the failure log excerpt for a workflow run.
    pub async fn download_workflow_log(
        &self,
        owner: &str,
        repo: &str,
        run_id: u64,
    ) -> Result<Vec<WorkflowRunLog>, AppError> {
        let url = format!("https://api.github.com/repos/{owner}/{repo}/actions/runs/{run_id}/logs");

        let client = reqwest::Client::new();
        let response = client
            .get(&url)
            .header("Authorization", format!("Bearer {}", self.token()))
            .header("User-Agent", "alfredo")
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(|e| AppError::Github(format!("failed to download workflow logs: {e}")))?;

        if !response.status().is_success() {
            return Err(AppError::Github(format!(
                "failed to download workflow logs: HTTP {}",
                response.status()
            )));
        }

        let bytes = response
            .bytes()
            .await
            .map_err(|e| AppError::Github(format!("failed to read workflow log bytes: {e}")))?;

        Self::parse_workflow_logs(run_id, &bytes)
    }

    /// Parse a zip of workflow logs and extract failure excerpts.
    fn parse_workflow_logs(run_id: u64, zip_bytes: &[u8]) -> Result<Vec<WorkflowRunLog>, AppError> {
        use std::io::Read;

        let reader = std::io::Cursor::new(zip_bytes);
        let mut archive = zip::ZipArchive::new(reader)
            .map_err(|e| AppError::Github(format!("failed to read log zip: {e}")))?;

        let mut logs = Vec::new();

        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| AppError::Github(format!("failed to read zip entry: {e}")))?;

            let name = file.name().to_string();

            // Log files are named like "job-name/step-number_step-name.txt"
            let parts: Vec<&str> = name.splitn(2, '/').collect();
            if parts.len() != 2 || !parts[1].ends_with(".txt") {
                continue;
            }

            let job_name = parts[0].to_string();
            let step_name = parts[1]
                .trim_end_matches(".txt")
                .split('_')
                .skip(1)
                .collect::<Vec<&str>>()
                .join("_");

            let mut content = String::new();
            file.read_to_string(&mut content).ok();

            // Check if this step contains failure indicators
            let has_failure = content.contains("FAIL")
                || content.contains("Error:")
                || content.contains("error[")
                || content.contains("FAILED")
                || content.contains("AssertionError")
                || content.contains("Process completed with exit code 1");

            if has_failure {
                // Extract the last 80 lines as the failure excerpt
                let lines: Vec<&str> = content.lines().collect();
                let start = lines.len().saturating_sub(80);
                let excerpt = lines[start..].join("\n");

                logs.push(WorkflowRunLog {
                    run_id,
                    job_name,
                    step_name,
                    log_excerpt: excerpt,
                });
            }
        }

        Ok(logs)
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
/// Resolve a GithubManager + owner/repo from a repo path in one call.
/// Loads the per-repo config, resolves the token, and parses the remote URL.
pub async fn github_context(repo_path: &str) -> Result<(GithubManager, String, String), AppError> {
    let config = crate::config_manager::load_config(repo_path).await?;
    let token = resolve_token(config.github_token.as_deref()).await?;
    let manager = GithubManager::new(&token)?;
    let (owner, repo) = resolve_owner_repo(repo_path).await?;
    Ok((manager, owner, repo))
}

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
            head_sha: None,
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
            head_sha: None,
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
            head_sha: None,
        };
        assert_eq!(determine_column(Some(&pr)), KanbanColumn::Done);
    }
}
