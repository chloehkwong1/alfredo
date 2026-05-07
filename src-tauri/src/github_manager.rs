use octocrab::Octocrab;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use crate::platform::gh_command;
use crate::types::{AppError, CheckRun, KanbanColumn, PrComment, PrDetailedStatus, PrReview, PrStatus, WorkflowRunLog};

/// Safety limit for paginated GitHub API calls.
const MAX_PAGES: u32 = 50;

/// Cache of canonical `repo_path` → `(owner, repo)`.
///
/// Why: this used to shell out to `git remote get-url origin` on every call,
/// and on one user's machine that deadlocked in the malloc lock after
/// sleep/wake (classic fork-in-multithreaded-program, amplified by Rosetta).
/// We now read the remote via libgit2 (no fork/exec) and cache the result —
/// origin URLs effectively never change for a worktree during app lifetime.
/// Restart required if a user changes `origin` out-of-band.
fn owner_repo_cache() -> &'static Mutex<HashMap<String, (String, String)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (String, String)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Convert an octocrab PR model into our `PrStatus` type.
/// Derives `merged` from `merged_at.is_some()`, which works for all PR states.
fn pr_status_from_octocrab(pr: octocrab::models::pulls::PullRequest) -> PrStatus {
    let merged_at = pr.merged_at.map(|dt| dt.to_rfc3339());
    PrStatus {
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
        merged: merged_at.is_some(),
        branch: pr.head.ref_field,
        base_branch: Some(pr.base.ref_field),
        merged_at,
        head_sha: Some(pr.head.sha),
        merge_commit_sha: pr.merge_commit_sha.clone(),
        body: pr.body.clone(),
        updated_at: pr.updated_at.map(|dt| dt.to_rfc3339()),
        author: pr.user.as_ref().map(|u| u.login.clone()),
        requested_reviewers: pr
            .requested_reviewers
            .unwrap_or_default()
            .iter()
            .map(|r| r.login.clone())
            .collect(),
    }
}

/// Deduplicate reviews: keep only the latest review per reviewer.
pub fn dedup_reviews(reviews: Vec<PrReview>) -> Vec<PrReview> {
    let mut latest: std::collections::HashMap<String, PrReview> = std::collections::HashMap::new();
    for review in reviews {
        latest
            .entry(review.reviewer.clone())
            .and_modify(|existing| {
                if review.submitted_at > existing.submitted_at {
                    *existing = review.clone();
                }
            })
            .or_insert(review);
    }
    latest.into_values().collect()
}

/// Derive review decision from deduplicated reviews.
/// When no definitive decision exists, distinguishes between "review_requested"
/// (reviewer has been assigned) and "review_required" (no reviewer assigned yet).
pub fn derive_review_decision(reviews: &[PrReview], requested_reviewers: &[String]) -> Option<String> {
    if reviews.iter().any(|r| r.state == "changes_requested") {
        Some("changes_requested".to_string())
    } else if reviews.iter().any(|r| r.state == "approved") {
        Some("approved".to_string())
    } else if !requested_reviewers.is_empty() {
        Some("review_requested".to_string())
    } else {
        Some("review_required".to_string())
    }
}

#[derive(serde::Deserialize)]
struct GithubPrFile {
    filename: String,
    status: String,
    additions: usize,
    deletions: usize,
    patch: Option<String>,
    previous_filename: Option<String>,
}

#[derive(serde::Deserialize)]
struct GithubPrCommit {
    sha: String,
    commit: GithubCommitDetail,
}

#[derive(serde::Deserialize)]
struct GithubCommitDetail {
    message: String,
    author: GithubCommitAuthor,
}

#[derive(serde::Deserialize)]
struct GithubCommitAuthor {
    name: String,
    date: String,
}

/// Parse a GitHub ISO 8601 timestamp (e.g. "2026-03-29T10:30:00Z") into epoch seconds.
fn parse_github_timestamp(date: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(date)
        .map(|dt| dt.timestamp())
        .unwrap_or(0)
}

// ── Extracted JSON parsers ────────────────────────────────────

/// Parse the JSON response from the check-runs API into `Vec<CheckRun>`.
fn parse_check_runs_response(response: &serde_json::Value) -> Vec<CheckRun> {
    response
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
                            .map(std::string::ToString::to_string),
                        html_url: run.get("html_url")?.as_str()?.to_string(),
                        started_at: run
                            .get("started_at")
                            .and_then(|v| v.as_str())
                            .map(std::string::ToString::to_string),
                        completed_at: run
                            .get("completed_at")
                            .and_then(|v| v.as_str())
                            .map(std::string::ToString::to_string),
                        check_suite_id: run
                            .pointer("/check_suite/id")
                            .and_then(serde_json::Value::as_u64),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parse the JSON response from the PR reviews API into `Vec<PrReview>`.
fn parse_reviews_response(response: &serde_json::Value) -> Vec<PrReview> {
    response
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|review| {
                    let body = review
                        .get("body")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(std::string::ToString::to_string);
                    Some(PrReview {
                        reviewer: review.get("user")?.get("login")?.as_str()?.to_string(),
                        state: review.get("state")?.as_str()?.to_lowercase(),
                        submitted_at: review.get("submitted_at").and_then(|v| v.as_str()).map(std::string::ToString::to_string),
                        body,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parse the JSON response from the PR review comments API into `Vec<PrComment>`.
fn parse_pr_comments_response(response: &serde_json::Value) -> Vec<PrComment> {
    response
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    Some(PrComment {
                        id: c.get("id")?.as_u64()?,
                        author: c.get("user")?.get("login")?.as_str()?.to_string(),
                        body: c.get("body")?.as_str()?.to_string(),
                        path: c.get("path").and_then(|v| v.as_str()).map(std::string::ToString::to_string),
                        line: c.get("line").and_then(serde_json::Value::as_u64).map(|n| n as u32),
                        resolved: false,
                        created_at: c.get("created_at")?.as_str()?.to_string(),
                        updated_at: c.get("updated_at")?.as_str()?.to_string(),
                        html_url: c.get("html_url")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parse the JSON response from the issue comments API into `Vec<PrComment>`.
fn parse_issue_comments_response(response: &serde_json::Value) -> Vec<PrComment> {
    response
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
                        resolved: false,
                        created_at: c.get("created_at")?.as_str()?.to_string(),
                        updated_at: c.get("updated_at")?.as_str()?.to_string(),
                        html_url: c.get("html_url")?.as_str()?.to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Map a deserialized `GithubPrFile` into our `DiffFile` type.
fn map_github_file(file: GithubPrFile) -> crate::commands::diff::DiffFile {
    let status = match file.status.as_str() {
        "added" => "added",
        "removed" => "deleted",
        "renamed" => "renamed",
        _ => "modified",
    };

    let (hunks, truncated) = if let Some(ref patch) = file.patch {
        (crate::patch_parser::parse_patch(patch), false)
    } else {
        (Vec::new(), true)
    };

    crate::commands::diff::DiffFile {
        path: file.filename,
        old_path: file.previous_filename,
        status: status.to_string(),
        additions: file.additions,
        deletions: file.deletions,
        hunks,
        truncated,
    }
}

/// Map a deserialized `GithubPrCommit` into our `CommitInfo` type.
fn map_github_commit(commit: GithubPrCommit) -> crate::commands::diff::CommitInfo {
    let hash = commit.sha.clone();
    let short_hash = hash[..7.min(hash.len())].to_string();
    crate::commands::diff::CommitInfo {
        hash,
        short_hash,
        message: commit.commit.message,
        author: commit.commit.author.name,
        timestamp: parse_github_timestamp(&commit.commit.author.date),
    }
}

/// Get a GitHub token: tries `gh auth token` first, falls back to the provided config token.
pub async fn resolve_token(config_token: Option<&str>) -> Result<String, AppError> {
    // Try gh CLI first
    if let Ok(output) = gh_command()
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
fn format_octocrab_error(context: &str, e: &octocrab::Error) -> AppError {
    let detail = match e {
        octocrab::Error::GitHub { source, .. } => {
            let status = source.status_code.as_u16();
            format!(
                "[{status}] {context}: {} ({})",
                source.message,
                source.documentation_url.as_deref().unwrap_or("")
            )
        }
        _ => format!("{context}: {e:?}"),
    };
    AppError::Github(detail)
}

/// Manages GitHub API interactions via octocrab.
pub struct GithubManager {
    client: Octocrab,
    http_client: reqwest::Client,
    token: String,
}

impl GithubManager {
    /// Create a new GithubManager with a GitHub token (PAT, OAuth, or gh CLI token).
    pub fn new(token: &str) -> Result<Self, AppError> {
        let client = Octocrab::builder()
            .personal_token(token.to_string())
            .set_connect_timeout(Some(std::time::Duration::from_secs(10)))
            .set_read_timeout(Some(std::time::Duration::from_secs(30)))
            .build()
            .map_err(|e| AppError::Github(format!("failed to build octocrab client: {e}")))?;
        let http_client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|e| AppError::Github(format!("failed to build HTTP client: {e}")))?;
        Ok(Self { client, http_client, token: token.to_string() })
    }

    fn token(&self) -> &str {
        &self.token
    }

    /// Build an authenticated GET request with standard GitHub headers.
    fn authed_get(&self, url: &str) -> reqwest::RequestBuilder {
        self.http_client
            .get(url)
            .header("Authorization", format!("Bearer {}", self.token()))
            .header("User-Agent", "alfredo")
            .header("Accept", "application/vnd.github+json")
    }

    /// Fetch the unix-timestamp when the authenticated user's core REST rate
    /// limit resets. `/rate_limit` itself does not count against the limit.
    pub async fn rate_limit_reset(&self) -> Result<u64, AppError> {
        let resp = self
            .authed_get("https://api.github.com/rate_limit")
            .send()
            .await
            .map_err(|e| AppError::Github(format!("rate_limit request failed: {e}")))?;
        let json: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::Github(format!("rate_limit parse failed: {e}")))?;
        json.pointer("/resources/core/reset")
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| AppError::Github("rate_limit response missing core.reset".into()))
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
            .map_err(|e| format_octocrab_error("failed to fetch PRs", &e))?;

        let mut prs: Vec<PrStatus> = open_page
            .items
            .into_iter()
            .map(pr_status_from_octocrab)
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
            .map_err(|e| format_octocrab_error("failed to fetch closed PRs", &e))?;

        // Include both merged PRs and cancelled (closed-not-merged) PRs so a
        // worktree whose PR was just closed can transition to Done instead of
        // silently dropping out of the sync payload (which leaves stale state).
        let closed_prs = closed_page.items.into_iter().map(pr_status_from_octocrab);

        prs.extend(closed_prs);

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
            .map_err(|e| format_octocrab_error("failed to fetch PR for branch", &e))?;

        Ok(page.items.into_iter().next().map(pr_status_from_octocrab))
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
            .map_err(|e| format_octocrab_error("failed to fetch check runs", &e))?;

        Ok(parse_check_runs_response(&response))
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
            .map_err(|e| format_octocrab_error("failed to fetch PR reviews", &e))?;

        Ok(parse_reviews_response(&response))
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
            .map_err(|e| format_octocrab_error("failed to fetch PR comments", &e))?;

        Ok(parse_pr_comments_response(&response))
    }

    /// Fetch review thread resolution status via GitHub GraphQL API.
    /// Returns a map of comment database ID → resolved bool.
    pub async fn get_review_thread_resolution(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<HashMap<u64, bool>, AppError> {
        let query = format!(
            r#"{{
  repository(owner: "{owner}", name: "{repo}") {{
    pullRequest(number: {pr_number}) {{
      reviewThreads(first: 100) {{
        nodes {{
          isResolved
          comments(first: 1) {{
            nodes {{
              databaseId
            }}
          }}
        }}
      }}
    }}
  }}
}}"#
        );

        let body = serde_json::json!({ "query": query });
        let response: serde_json::Value = self
            .http_client
            .post("https://api.github.com/graphql")
            .header("Authorization", format!("Bearer {}", self.token()))
            .header("User-Agent", "alfredo")
            .json(&body)
            .send()
            .await
            .map_err(|e| AppError::Github(format!("GraphQL request failed: {e}")))?
            .json()
            .await
            .map_err(|e| AppError::Github(format!("GraphQL response parse failed: {e}")))?;

        let mut resolution_map = HashMap::new();
        if let Some(threads) = response
            .pointer("/data/repository/pullRequest/reviewThreads/nodes")
            .and_then(|v| v.as_array())
        {
            for thread in threads {
                let is_resolved = thread
                    .get("isResolved")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false);
                if let Some(comment_id) = thread
                    .pointer("/comments/nodes/0/databaseId")
                    .and_then(serde_json::Value::as_u64)
                {
                    resolution_map.insert(comment_id, is_resolved);
                }
            }
        }

        Ok(resolution_map)
    }

    /// Apply thread resolution status to a list of comments.
    pub fn apply_thread_resolution(comments: &mut [PrComment], resolution: &HashMap<u64, bool>) {
        for comment in comments.iter_mut() {
            if let Some(&resolved) = resolution.get(&comment.id) {
                comment.resolved = resolved;
            }
        }
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
            .map_err(|e| format_octocrab_error("failed to fetch issue comments", &e))?;

        Ok(parse_issue_comments_response(&response))
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
            .map_err(|e| format_octocrab_error("failed to fetch PR for mergeable", &e))?;
        Ok(response.get("mergeable").and_then(serde_json::Value::as_bool))
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
            .map_err(|e| format_octocrab_error("failed to fetch PR detail", &e))?;

        let mergeable = pr_response.get("mergeable").and_then(serde_json::Value::as_bool);

        let requested_reviewers = pr_response
            .get("requested_reviewers")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|u| u.get("login").and_then(|l| l.as_str()).map(String::from))
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();

        // Fetch reviews, line comments, issue comments, and thread resolution concurrently
        let (reviews, line_comments, issue_comments, resolution) = tokio::join!(
            self.get_pr_reviews(owner, repo, pr_number),
            self.get_pr_comments(owner, repo, pr_number),
            self.get_pr_issue_comments(owner, repo, pr_number),
            self.get_review_thread_resolution(owner, repo, pr_number),
        );

        let reviews = reviews?;
        let mut comments = line_comments?;
        comments.extend(issue_comments?);

        if let Ok(resolution) = resolution {
            Self::apply_thread_resolution(&mut comments, &resolution);
        }

        let deduped_reviews = dedup_reviews(reviews);
        let review_decision = derive_review_decision(&deduped_reviews, &requested_reviewers);

        Ok(PrDetailedStatus {
            reviews: deduped_reviews,
            comments,
            mergeable,
            review_decision,
            requested_reviewers,
        })
    }

    /// Fetch the list of files changed in a PR, with parsed diff hunks.
    /// Uses the GitHub REST API: GET /repos/{owner}/{repo}/pulls/{number}/files
    pub async fn get_pr_files(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<crate::commands::diff::DiffFile>, AppError> {
        let mut all_files = Vec::new();
        let mut page: u32 = 1;

        loop {
            let url = format!(
                "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/files?per_page=100&page={page}"
            );

            let response = self
                .authed_get(&url)
                .send()
                .await
                .map_err(|e| AppError::Github(format!("failed to fetch PR files: {e}")))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(AppError::Github(format!(
                    "GitHub PR files API returned {status}: {body}"
                )));
            }

            let files: Vec<GithubPrFile> = response
                .json()
                .await
                .map_err(|e| AppError::Github(format!("failed to parse PR files response: {e}")))?;

            let count = files.len();

            for file in files {
                all_files.push(map_github_file(file));
            }

            if count < 100 {
                break;
            }
            page += 1;
            if page > MAX_PAGES {
                eprintln!("[github] get_pr_files: hit {MAX_PAGES}-page safety limit for PR #{pr_number}");
                break;
            }
        }

        Ok(all_files)
    }

    /// Fetch commits for a PR from the GitHub API.
    /// Uses: GET /repos/{owner}/{repo}/pulls/{number}/commits
    pub async fn get_pr_commits(
        &self,
        owner: &str,
        repo: &str,
        pr_number: u64,
    ) -> Result<Vec<crate::commands::diff::CommitInfo>, AppError> {
        let mut all_commits = Vec::new();
        let mut page: u32 = 1;

        loop {
            let url = format!(
                "https://api.github.com/repos/{owner}/{repo}/pulls/{pr_number}/commits?per_page=100&page={page}"
            );

            let response = self
                .authed_get(&url)
                .send()
                .await
                .map_err(|e| AppError::Github(format!("failed to fetch PR commits: {e}")))?;

            if !response.status().is_success() {
                let status = response.status();
                let body = response.text().await.unwrap_or_default();
                return Err(AppError::Github(format!(
                    "GitHub PR commits API returned {status}: {body}"
                )));
            }

            let commits: Vec<GithubPrCommit> = response
                .json()
                .await
                .map_err(|e| AppError::Github(format!("failed to parse PR commits response: {e}")))?;

            let count = commits.len();

            for commit in commits {
                all_commits.push(map_github_commit(commit));
            }

            if count < 100 {
                break;
            }
            page += 1;
            if page > MAX_PAGES {
                eprintln!("[github] get_pr_commits: hit {MAX_PAGES}-page safety limit for PR #{pr_number}");
                break;
            }
        }

        Ok(all_commits)
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
            .map_err(|e| format_octocrab_error("failed to re-run failed jobs", &e))?;
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
            .map_err(|e| format_octocrab_error("failed to fetch workflow runs", &e))?;

        let run_id = response
            .get("workflow_runs")
            .and_then(|v| v.as_array())
            .and_then(|runs| runs.first())
            .and_then(|run| run.get("id"))
            .and_then(serde_json::Value::as_u64);

        Ok(run_id)
    }

    /// Download log for a single job and extract the failed step's output.
    ///
    /// For GitHub Actions, check run IDs equal job IDs, so callers can pass
    /// a check run ID directly — no check_suite/workflow_run lookup needed.
    pub async fn download_job_log(
        &self,
        owner: &str,
        repo: &str,
        job_id: u64,
        job_name: &str,
    ) -> Result<Option<WorkflowRunLog>, AppError> {
        let log_url = format!(
            "https://api.github.com/repos/{owner}/{repo}/actions/jobs/{job_id}/logs"
        );
        let log_resp = self
            .authed_get(&log_url)
            .send()
            .await
            .map_err(|e| AppError::Github(format!("failed to fetch job log: {e}")))?;

        if !log_resp.status().is_success() {
            eprintln!("[github] job log fetch for job {job_id} returned HTTP {}", log_resp.status());
            return Ok(None);
        }

        let log_text = log_resp
            .text()
            .await
            .unwrap_or_default();

        if log_text.is_empty() {
            return Ok(None);
        }

        // Find the failed step name from the log's ##[group] headers.
        // We look for a step followed by ##[error] to identify the failure.
        let failed_step_name = Self::find_failed_step_in_log(&log_text)
            .unwrap_or_else(|| "unknown".to_string());

        let excerpt = Self::extract_failed_step_log(&log_text, &failed_step_name);

        Ok(Some(WorkflowRunLog {
            job_name: job_name.to_string(),
            step_name: failed_step_name,
            log_excerpt: excerpt,
        }))
    }

    /// Scan a job's plain-text log for the step that contains an error.
    ///
    /// GitHub Actions logs use `##[group]StepName` to open sections and
    /// `##[error]` markers for failures. We find the step that owns the error.
    fn find_failed_step_in_log(log_text: &str) -> Option<String> {
        let mut current_step: Option<String> = None;
        for line in log_text.lines() {
            // Strip timestamp prefix (e.g. "2024-01-15T10:30:45.1234567Z ")
            let content = if line.len() > 30 && line.as_bytes().get(28) == Some(&b'Z') {
                &line[30..]
            } else {
                line
            };
            if let Some(name) = content.strip_prefix("##[group]") {
                current_step = Some(name.to_string());
            } else if content.contains("##[error]") {
                if let Some(ref step) = current_step {
                    return Some(step.clone());
                }
            }
        }
        None
    }

    /// Extract the log section for a specific failed step from a job's plain-text log.
    ///
    /// GitHub Actions job logs delimit steps with lines containing the step name.
    /// We find the failed step's section and return the last 150 lines of it.
    fn extract_failed_step_log(log_text: &str, step_name: &str) -> String {
        let lines: Vec<&str> = log_text.lines().collect();

        // Find the section that matches the failed step name.
        // Step headers appear as timestamps followed by "##[group]Step Name"
        let mut section_start = None;
        let mut section_end = None;

        for (i, line) in lines.iter().enumerate() {
            // Match lines like "2024-01-15T10:30:45.1234567Z ##[group]Run tests"
            if line.contains(&format!("##[group]{step_name}")) {
                section_start = Some(i);
                section_end = None;
            } else if section_start.is_some() && section_end.is_none() && line.contains("##[group]") {
                // Next step started — end of our section
                section_end = Some(i);
            }
        }

        let (start, end) = match section_start {
            Some(s) => (s, section_end.unwrap_or(lines.len())),
            // Fallback: if we can't find the step header, return the last 150 lines
            None => (lines.len().saturating_sub(150), lines.len()),
        };

        // Strip timestamps from each line for cleaner output
        let section: Vec<&str> = lines[start..end]
            .iter()
            .map(|line| {
                // Timestamps are like "2024-01-15T10:30:45.1234567Z "
                if line.len() > 30 && line.as_bytes().get(28) == Some(&b'Z') {
                    &line[30..]
                } else {
                    line
                }
            })
            .collect();

        // Take the last 150 lines of the section if it's very long
        let trim_start = section.len().saturating_sub(150);
        section[trim_start..].join("\n")
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
/// The GitHub token is cached for the process lifetime to avoid shelling out
/// to `gh auth token` on every IPC call.
pub async fn github_context(app_data_dir: &std::path::Path, repo_path: &str) -> Result<(GithubManager, String, String), AppError> {
    let token = cached_token(app_data_dir, repo_path).await?;
    let manager = GithubManager::new(&token)?;
    let (owner, repo) = resolve_owner_repo(repo_path).await?;
    Ok((manager, owner, repo))
}

/// Cache the resolved GitHub token to avoid repeated `gh auth token` subprocess
/// spawns. The token is resolved once and reused for all subsequent calls.
async fn cached_token(app_data_dir: &std::path::Path, repo_path: &str) -> Result<String, AppError> {
    use tokio::sync::OnceCell;

    static TOKEN_CACHE: OnceCell<Result<String, String>> = OnceCell::const_new();

    let result = TOKEN_CACHE
        .get_or_init(|| async {
            let config = crate::config_manager::load_personal_config(app_data_dir, repo_path).await
                .map_err(|e| format!("{e}"))?;
            resolve_token(config.github_token.as_deref()).await
                .map_err(|e| format!("{e}"))
        })
        .await;

    match result {
        Ok(token) => Ok(token.clone()),
        Err(e) => Err(AppError::Github(e.clone())),
    }
}

pub async fn resolve_owner_repo(repo_path: &str) -> Result<(String, String), AppError> {
    // Canonicalize so trailing slashes / symlinked variants hit the same cache entry.
    let cache_key = std::path::Path::new(repo_path)
        .canonicalize()
        .ok()
        .and_then(|p| p.to_str().map(ToString::to_string))
        .unwrap_or_else(|| repo_path.to_string());

    if let Ok(guard) = owner_repo_cache().lock() {
        if let Some(cached) = guard.get(&cache_key).cloned() {
            return Ok(cached);
        }
    }

    // Read the origin URL via libgit2 — no fork/exec, so immune to the
    // post-wake malloc-lock deadlock we hit when shelling out to `git`.
    let path_for_blocking = cache_key.clone();
    let url = tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let repo = git2::Repository::discover(&path_for_blocking)
            .map_err(|e| AppError::Github(format!("not a git repo: {e}")))?;
        let remote = repo
            .find_remote("origin")
            .map_err(|_| AppError::Github("no origin remote found".into()))?;
        let url = remote
            .url()
            .ok_or_else(|| AppError::Github("origin has no URL".into()))?
            .to_string();
        Ok(url)
    })
    .await
    .map_err(|e| AppError::Github(format!("resolve_owner_repo task panicked: {e}")))??;

    let parsed = parse_github_owner_repo(&url)
        .ok_or_else(|| AppError::Github(format!("could not parse owner/repo from: {url}")))?;

    if let Ok(mut guard) = owner_repo_cache().lock() {
        guard.insert(cache_key, parsed.clone());
    }
    Ok(parsed)
}

/// Whether `user` has a still-active approving review on this PR.
///
/// Looks at the user's most recent *decisive* review — one of "approved",
/// "changes_requested", or "dismissed". "commented" and "pending" entries
/// are ignored because GitHub does not treat them as superseding a prior
/// approval (e.g. leaving a "ship it!" comment after approving keeps the
/// approval valid).
///
/// Pass the raw, un-deduplicated review list so the most-recent-decisive
/// review can be identified even when a later non-decisive review exists.
fn user_has_active_approval(reviews: &[PrReview], user: &str) -> bool {
    reviews
        .iter()
        .filter(|r| r.reviewer.eq_ignore_ascii_case(user))
        .filter(|r| matches!(r.state.as_str(), "approved" | "changes_requested" | "dismissed"))
        .max_by(|a, b| a.submitted_at.cmp(&b.submitted_at))
        .is_some_and(|r| r.state == "approved")
}

/// Determine the kanban column for a worktree based on its PR status.
///
/// When `github_username` is provided, open (non-draft) PRs are split into
/// "In Review" (user is the author) vs "Needs Review" (someone else's PR).
/// Others' PRs where the user has an active approving review (per
/// [`user_has_active_approval`]) and has not been re-requested resolve to
/// "Done".
///
/// `reviews` should be the raw review list (not pre-deduplicated) so the
/// most-recent-decisive review can be identified. When called before reviews
/// have loaded, pass `&[]` — the column is then recomputed once review data
/// is available.
pub fn determine_column(
    pr: Option<&PrStatus>,
    github_username: Option<&str>,
    reviews: &[PrReview],
) -> KanbanColumn {
    match pr {
        None => KanbanColumn::InProgress,
        Some(pr) if pr.merged => KanbanColumn::Done,
        Some(pr) if pr.state == "closed" => KanbanColumn::Done,
        Some(pr) if pr.draft => KanbanColumn::DraftPr,
        Some(pr) => {
            let is_own_pr = match (pr.author.as_deref(), github_username) {
                (Some(author), Some(user)) => author.eq_ignore_ascii_case(user),
                _ => true, // default to "own PR" if we can't tell
            };
            if is_own_pr {
                return KanbanColumn::OpenPr;
            }
            if let Some(user) = github_username {
                let re_requested = pr
                    .requested_reviewers
                    .iter()
                    .any(|r| r.eq_ignore_ascii_case(user));
                if user_has_active_approval(reviews, user) && !re_requested {
                    return KanbanColumn::Done;
                }
            }
            KanbanColumn::NeedsReview
        }
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
        assert_eq!(determine_column(None, None, &[]), KanbanColumn::InProgress);
    }

    #[test]
    fn test_determine_column_draft() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: true,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("chloe".into()),
            requested_reviewers: vec![],
        };
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &[]), KanbanColumn::DraftPr);
    }

    #[test]
    fn test_determine_column_own_pr() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("chloe".into()),
            requested_reviewers: vec![],
        };
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &[]), KanbanColumn::OpenPr);
    }

    #[test]
    fn test_determine_column_needs_review() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("teammate".into()),
            requested_reviewers: vec![],
        };
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &[]), KanbanColumn::NeedsReview);
    }

    #[test]
    fn test_determine_column_no_username_defaults_to_own() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("anyone".into()),
            requested_reviewers: vec![],
        };
        assert_eq!(determine_column(Some(&pr), None, &[]), KanbanColumn::OpenPr);
    }

    #[test]
    fn test_determine_column_merged() {
        let pr = PrStatus {
            number: 1,
            state: "closed".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: true,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("chloe".into()),
            requested_reviewers: vec![],
        };
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &[]), KanbanColumn::Done);
    }

    #[test]
    fn test_determine_column_cancelled() {
        let pr = PrStatus {
            number: 1,
            state: "closed".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("chloe".into()),
            requested_reviewers: vec![],
        };
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &[]), KanbanColumn::Done);
    }

    #[test]
    fn test_determine_column_others_pr_i_approved() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("teammate".into()),
            requested_reviewers: vec![], // GitHub auto-removes me after I review
        };
        let reviews = vec![PrReview {
            reviewer: "chloe".into(),
            state: "approved".into(),
            submitted_at: Some("2026-05-07T10:00:00Z".into()),
            body: None,
        }];
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &reviews), KanbanColumn::Done);
    }

    #[test]
    fn test_determine_column_others_pr_i_approved_then_re_requested() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("teammate".into()),
            requested_reviewers: vec!["chloe".into()],
        };
        let reviews = vec![PrReview {
            reviewer: "chloe".into(),
            state: "approved".into(),
            submitted_at: Some("2026-05-07T10:00:00Z".into()),
            body: None,
        }];
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &reviews), KanbanColumn::NeedsReview);
    }

    #[test]
    fn test_determine_column_others_pr_i_requested_changes() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("teammate".into()),
            requested_reviewers: vec![],
        };
        let reviews = vec![PrReview {
            reviewer: "chloe".into(),
            state: "changes_requested".into(),
            submitted_at: Some("2026-05-07T10:00:00Z".into()),
            body: None,
        }];
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &reviews), KanbanColumn::NeedsReview);
    }

    #[test]
    fn test_determine_column_others_pr_approved_then_commented() {
        // Common UX case: user approves, then leaves a follow-up "ship it!"
        // comment-only review. GitHub still considers the approval valid, so
        // the PR should stay in Done.
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("teammate".into()),
            requested_reviewers: vec![],
        };
        let reviews = vec![
            PrReview {
                reviewer: "chloe".into(),
                state: "approved".into(),
                submitted_at: Some("2026-05-07T10:00:00Z".into()),
                body: None,
            },
            PrReview {
                reviewer: "chloe".into(),
                state: "commented".into(),
                submitted_at: Some("2026-05-07T11:00:00Z".into()),
                body: None,
            },
        ];
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &reviews), KanbanColumn::Done);
    }

    #[test]
    fn test_determine_column_others_pr_approved_then_dismissed() {
        // If the user's approval is later dismissed, the PR should fall back
        // to Needs Review.
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("teammate".into()),
            requested_reviewers: vec![],
        };
        let reviews = vec![
            PrReview {
                reviewer: "chloe".into(),
                state: "approved".into(),
                submitted_at: Some("2026-05-07T10:00:00Z".into()),
                body: None,
            },
            PrReview {
                reviewer: "chloe".into(),
                state: "dismissed".into(),
                submitted_at: Some("2026-05-07T12:00:00Z".into()),
                body: None,
            },
        ];
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &reviews), KanbanColumn::NeedsReview);
    }

    #[test]
    fn test_determine_column_own_pr_with_self_approval() {
        // Author + approver short-circuit: own PRs always resolve to OpenPr,
        // never Done, even if the user somehow has an approving review on
        // their own PR (locks in the branch ordering in determine_column).
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("chloe".into()),
            requested_reviewers: vec![],
        };
        let reviews = vec![PrReview {
            reviewer: "chloe".into(),
            state: "approved".into(),
            submitted_at: Some("2026-05-07T10:00:00Z".into()),
            body: None,
        }];
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &reviews), KanbanColumn::OpenPr);
    }

    #[test]
    fn test_determine_column_others_pr_someone_else_approved() {
        let pr = PrStatus {
            number: 1,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/test".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("teammate".into()),
            requested_reviewers: vec![],
        };
        let reviews = vec![PrReview {
            reviewer: "alice".into(),
            state: "approved".into(),
            submitted_at: Some("2026-05-07T10:00:00Z".into()),
            body: None,
        }];
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &reviews), KanbanColumn::NeedsReview);
    }

    // --- dedup_reviews tests ---

    #[test]
    fn test_dedup_reviews_keeps_latest() {
        let reviews = vec![
            PrReview {
                reviewer: "alice".into(),
                state: "approved".into(),
                submitted_at: Some("2026-03-29T10:00:00Z".into()),
                body: None,
            },
            PrReview {
                reviewer: "alice".into(),
                state: "changes_requested".into(),
                submitted_at: Some("2026-03-29T12:00:00Z".into()),
                body: None,
            },
        ];
        let result = dedup_reviews(reviews);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].state, "changes_requested");
    }

    #[test]
    fn test_dedup_reviews_different_reviewers() {
        let reviews = vec![
            PrReview {
                reviewer: "alice".into(),
                state: "approved".into(),
                submitted_at: Some("2026-03-29T10:00:00Z".into()),
                body: None,
            },
            PrReview {
                reviewer: "bob".into(),
                state: "changes_requested".into(),
                submitted_at: Some("2026-03-29T11:00:00Z".into()),
                body: None,
            },
        ];
        let result = dedup_reviews(reviews);
        assert_eq!(result.len(), 2);
    }

    // --- derive_review_decision tests ---

    #[test]
    fn test_derive_review_decision_changes_requested() {
        let reviews = vec![PrReview {
            reviewer: "alice".into(),
            state: "changes_requested".into(),
            submitted_at: Some("2026-03-29T10:00:00Z".into()),
            body: None,
        }];
        assert_eq!(
            derive_review_decision(&reviews, &[]),
            Some("changes_requested".into())
        );
    }

    #[test]
    fn test_derive_review_decision_approved() {
        let reviews = vec![PrReview {
            reviewer: "alice".into(),
            state: "approved".into(),
            submitted_at: Some("2026-03-29T10:00:00Z".into()),
            body: None,
        }];
        assert_eq!(
            derive_review_decision(&reviews, &[]),
            Some("approved".into())
        );
    }

    #[test]
    fn test_derive_review_decision_review_requested() {
        let reviews = vec![PrReview {
            reviewer: "alice".into(),
            state: "commented".into(),
            submitted_at: Some("2026-03-29T10:00:00Z".into()),
            body: None,
        }];
        let requested = vec!["bob".to_string()];
        assert_eq!(
            derive_review_decision(&reviews, &requested),
            Some("review_requested".into())
        );
    }

    #[test]
    fn test_derive_review_decision_review_required() {
        let reviews: Vec<PrReview> = vec![];
        let requested: Vec<String> = vec![];
        assert_eq!(
            derive_review_decision(&reviews, &requested),
            Some("review_required".into())
        );
    }

    // --- parse_github_timestamp tests ---

    #[test]
    fn test_parse_github_timestamp_valid() {
        let ts = parse_github_timestamp("2026-03-29T10:30:00Z");
        assert_eq!(ts, 1774780200);
    }

    #[test]
    fn test_parse_github_timestamp_invalid() {
        assert_eq!(parse_github_timestamp("not-a-date"), 0);
    }

    // --- parse_workflow_logs tests ---
    // TODO: Re-enable when parse_workflow_logs and zip dependency are added
    // (tests reference a function that was never implemented)
    /*
    fn build_test_zip(entries: &[(&str, &str)]) -> Vec<u8> {
        use std::io::Write;
        let buf = std::io::Cursor::new(Vec::new());
        let mut zip = zip::ZipWriter::new(buf);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, content) in entries {
            zip.start_file(*name, options).unwrap();
            zip.write_all(content.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn test_parse_workflow_logs_with_failure() {
        let zip_bytes = build_test_zip(&[(
            "build/1_Run tests.txt",
            "Running tests...\nFAIL src/foo.test.ts\nProcess completed with exit code 1",
        )]);
        let logs = GithubManager::parse_workflow_logs(42, &zip_bytes).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].run_id, 42);
        assert_eq!(logs[0].job_name, "build");
        assert_eq!(logs[0].step_name, "Run tests");
        assert!(logs[0].log_excerpt.contains("FAIL"));
    }

    #[test]
    fn test_parse_workflow_logs_no_failures() {
        let zip_bytes = build_test_zip(&[(
            "build/1_Run tests.txt",
            "Running tests...\nAll 42 tests passed.",
        )]);
        let logs = GithubManager::parse_workflow_logs(42, &zip_bytes).unwrap();
        assert!(logs.is_empty());
    }

    #[test]
    fn test_parse_workflow_logs_skips_non_txt() {
        let zip_bytes = build_test_zip(&[(
            "build/1_Run tests.log",
            "FAIL this should be skipped",
        )]);
        let logs = GithubManager::parse_workflow_logs(42, &zip_bytes).unwrap();
        assert!(logs.is_empty());
    }
    */

    // --- parse_check_runs_response tests ---

    #[test]
    fn test_parse_check_runs_response() {
        let json = serde_json::json!({
            "check_runs": [
                {
                    "id": 101,
                    "name": "build",
                    "status": "completed",
                    "conclusion": "success",
                    "html_url": "https://github.com/acme/repo/runs/101",
                    "started_at": "2026-03-29T10:00:00Z",
                    "completed_at": "2026-03-29T10:05:00Z",
                    "check_suite": { "id": 500 }
                },
                {
                    "id": 102,
                    "name": "lint",
                    "status": "in_progress",
                    "conclusion": null,
                    "html_url": "https://github.com/acme/repo/runs/102",
                    "started_at": "2026-03-29T10:01:00Z",
                    "completed_at": null
                }
            ]
        });

        let runs = parse_check_runs_response(&json);
        assert_eq!(runs.len(), 2);

        assert_eq!(runs[0].id, 101);
        assert_eq!(runs[0].name, "build");
        assert_eq!(runs[0].status, "completed");
        assert_eq!(runs[0].conclusion.as_deref(), Some("success"));
        assert_eq!(runs[0].started_at.as_deref(), Some("2026-03-29T10:00:00Z"));
        assert_eq!(runs[0].completed_at.as_deref(), Some("2026-03-29T10:05:00Z"));
        assert_eq!(runs[0].check_suite_id, Some(500));

        assert_eq!(runs[1].id, 102);
        assert_eq!(runs[1].name, "lint");
        assert_eq!(runs[1].status, "in_progress");
        assert_eq!(runs[1].conclusion, None);
        assert_eq!(runs[1].completed_at, None);
        assert_eq!(runs[1].check_suite_id, None);
    }

    #[test]
    fn test_parse_check_runs_empty() {
        let json = serde_json::json!({ "check_runs": [] });
        assert!(parse_check_runs_response(&json).is_empty());
    }

    #[test]
    fn test_parse_check_runs_missing_fields() {
        let json = serde_json::json!({
            "check_runs": [
                { "name": "no-id", "status": "completed", "conclusion": "success", "html_url": "u" },
                { "id": 200, "name": "ok", "status": "completed", "conclusion": null, "html_url": "u2" }
            ]
        });
        let runs = parse_check_runs_response(&json);
        // First entry skipped (missing id), second kept
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].id, 200);
    }

    // --- parse_reviews_response tests ---

    #[test]
    fn test_parse_reviews_response() {
        let json = serde_json::json!([
            {
                "user": { "login": "alice" },
                "state": "APPROVED",
                "submitted_at": "2026-03-29T11:00:00Z",
                "body": "LGTM, shipping"
            },
            {
                "user": { "login": "bob" },
                "state": "CHANGES_REQUESTED",
                "submitted_at": null,
                "body": "   "
            },
            {
                "user": { "login": "carol" },
                "state": "COMMENTED",
                "submitted_at": "2026-03-29T12:00:00Z"
            }
        ]);

        let reviews = parse_reviews_response(&json);
        assert_eq!(reviews.len(), 3);
        assert_eq!(reviews[0].reviewer, "alice");
        assert_eq!(reviews[0].state, "approved");
        assert_eq!(reviews[0].submitted_at.as_deref(), Some("2026-03-29T11:00:00Z"));
        assert_eq!(reviews[0].body.as_deref(), Some("LGTM, shipping"));
        assert_eq!(reviews[1].reviewer, "bob");
        assert_eq!(reviews[1].state, "changes_requested");
        assert_eq!(reviews[1].submitted_at, None);
        // Whitespace-only bodies collapse to None so the UI doesn't render an empty summary.
        assert_eq!(reviews[1].body, None);
        // Missing body field → None.
        assert_eq!(reviews[2].body, None);
    }

    #[test]
    fn test_parse_reviews_empty() {
        let json = serde_json::json!([]);
        assert!(parse_reviews_response(&json).is_empty());
    }

    // --- parse_pr_comments_response tests ---

    #[test]
    fn test_parse_pr_comments_response() {
        let json = serde_json::json!([
            {
                "id": 301,
                "user": { "login": "carol" },
                "body": "Looks good",
                "path": "src/main.rs",
                "line": 42,
                "created_at": "2026-03-29T12:00:00Z",
                "updated_at": "2026-03-29T12:05:00Z",
                "html_url": "https://github.com/acme/repo/pull/1#comment-301"
            }
        ]);

        let comments = parse_pr_comments_response(&json);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, 301);
        assert_eq!(comments[0].author, "carol");
        assert_eq!(comments[0].body, "Looks good");
        assert_eq!(comments[0].path.as_deref(), Some("src/main.rs"));
        assert_eq!(comments[0].line, Some(42));
        assert!(!comments[0].resolved);
        assert_eq!(comments[0].created_at, "2026-03-29T12:00:00Z");
        assert_eq!(comments[0].html_url, "https://github.com/acme/repo/pull/1#comment-301");
    }

    // --- parse_issue_comments_response tests ---

    #[test]
    fn test_parse_issue_comments_response() {
        let json = serde_json::json!([
            {
                "id": 401,
                "user": { "login": "dave" },
                "body": "General feedback",
                "created_at": "2026-03-29T13:00:00Z",
                "updated_at": "2026-03-29T13:01:00Z",
                "html_url": "https://github.com/acme/repo/issues/1#comment-401"
            }
        ]);

        let comments = parse_issue_comments_response(&json);
        assert_eq!(comments.len(), 1);
        assert_eq!(comments[0].id, 401);
        assert_eq!(comments[0].author, "dave");
        assert_eq!(comments[0].path, None);
        assert_eq!(comments[0].line, None);
        assert!(!comments[0].resolved);
    }

    // --- map_github_file tests ---

    #[test]
    fn test_map_github_file_added() {
        let file = GithubPrFile {
            filename: "src/new.rs".into(),
            status: "added".into(),
            additions: 10,
            deletions: 0,
            patch: Some("@@ -0,0 +1,10 @@\n+line1".into()),
            previous_filename: None,
        };
        let diff = map_github_file(file);
        assert_eq!(diff.path, "src/new.rs");
        assert_eq!(diff.status, "added");
        assert_eq!(diff.additions, 10);
        assert_eq!(diff.deletions, 0);
        assert!(!diff.truncated);
        assert!(!diff.hunks.is_empty());
        assert_eq!(diff.old_path, None);
    }

    #[test]
    fn test_map_github_file_renamed() {
        let file = GithubPrFile {
            filename: "src/new_name.rs".into(),
            status: "renamed".into(),
            additions: 2,
            deletions: 1,
            patch: Some("@@ -1,3 +1,4 @@\n context\n-old\n+new\n+extra".into()),
            previous_filename: Some("src/old_name.rs".into()),
        };
        let diff = map_github_file(file);
        assert_eq!(diff.status, "renamed");
        assert_eq!(diff.old_path.as_deref(), Some("src/old_name.rs"));
    }

    #[test]
    fn test_map_github_file_no_patch() {
        let file = GithubPrFile {
            filename: "binary.png".into(),
            status: "modified".into(),
            additions: 0,
            deletions: 0,
            patch: None,
            previous_filename: None,
        };
        let diff = map_github_file(file);
        assert!(diff.truncated);
        assert!(diff.hunks.is_empty());
    }

    // --- map_github_commit tests ---

    #[test]
    fn test_map_github_commit() {
        let commit = GithubPrCommit {
            sha: "abc1234567890".into(),
            commit: GithubCommitDetail {
                message: "feat: add feature".into(),
                author: GithubCommitAuthor {
                    name: "Chloe".into(),
                    date: "2026-03-29T14:00:00Z".into(),
                },
            },
        };
        let info = map_github_commit(commit);
        assert_eq!(info.hash, "abc1234567890");
        assert_eq!(info.short_hash, "abc1234");
        assert_eq!(info.message, "feat: add feature");
        assert_eq!(info.author, "Chloe");
        assert_eq!(info.timestamp, 1774792800);
    }
}
