use octocrab::Octocrab;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use crate::bounded_lru::BoundedLru;
use crate::platform::gh_command;
use crate::types::{AppError, CheckRun, KanbanColumn, NativeStackInfo, NativeStackMember, PrComment, PrDetailedStatus, PrReview, PrStatus, WorkflowRunLog};

// LOCK ORDER: when both module-level caches need to be touched in the same
// call, always acquire `token_cache` first and release it before acquiring
// `manager_cache`. `GithubManager::shared` only touches `manager_cache`, so
// no path takes them in reverse. Preserving this prevents future deadlocks.
//
// Both caches are wrapped in `BoundedLru` (cap = `CACHE_CAP`) so a user with
// many GitHub accounts can't grow them without bound. At cap 8 the LRU op
// cost is trivial and avoids the eviction-oscillation a "drop arbitrary
// entry" scheme would suffer under a hot working set above the cap.
const CACHE_CAP: usize = 8;

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
        // REST carries no stack fields; stamped later from the GraphQL
        // native-stack query in `poll_repo`.
        native_stack: None,
    }
}

/// Warn once per process when native-stack detection fails. The stackEntry
/// GraphQL field is an undocumented public-preview API — failures are
/// expected (schema drift, preview withdrawal) and must never break PR sync,
/// so we log a single line instead of spamming every 60s poll.
fn warn_native_stack_once(context: &str) {
    use std::sync::atomic::{AtomicBool, Ordering};
    static WARNED: AtomicBool = AtomicBool::new(false);
    if !WARNED.swap(true, Ordering::Relaxed) {
        eprintln!("[github] native-stack detection unavailable (preview API): {context}");
    }
}

/// Parse PR nodes of the native-stack query (accumulated across pages — a
/// stack's members can straddle a page boundary, so grouping must run over
/// the combined node list, never per page) into PR number → stack membership.
/// Every parse step is fail-open: a node missing any required field is
/// skipped, and a `null` stackEntry means the PR is not in a stack.
fn parse_native_stack_nodes(nodes: &[serde_json::Value]) -> HashMap<u64, NativeStackInfo> {
    let mut result = HashMap::new();

    // Group members by stack id, remembering each stack's number + size.
    let mut rosters: HashMap<String, (u64, u32, Vec<NativeStackMember>)> = HashMap::new();
    for node in nodes {
        let Some(entry) = node.get("stackEntry").filter(|e| !e.is_null()) else {
            continue; // not in a stack
        };
        let (Some(number), Some(position)) = (
            node.get("number").and_then(serde_json::Value::as_u64),
            entry.get("position").and_then(serde_json::Value::as_u64),
        ) else {
            continue;
        };
        let Some(stack) = entry.get("stack").filter(|s| !s.is_null()) else {
            continue;
        };
        let (Some(stack_id), Some(stack_number), Some(stack_size)) = (
            stack.get("id").and_then(serde_json::Value::as_str),
            stack.get("number").and_then(serde_json::Value::as_u64),
            stack.get("size").and_then(serde_json::Value::as_u64),
        ) else {
            continue;
        };

        let as_string = |key: &str| {
            node.get(key)
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        let member = NativeStackMember {
            number,
            title: as_string("title"),
            branch: as_string("headRefName"),
            state: as_string("state"),
            url: as_string("url"),
            position: position as u32,
        };
        rosters
            .entry(stack_id.to_string())
            .or_insert_with(|| (stack_number, stack_size as u32, Vec::new()))
            .2
            .push(member);
    }

    for (stack_id, (stack_number, size, mut members)) in rosters {
        members.sort_by_key(|m| m.position);
        for member in &members {
            result.insert(
                member.number,
                NativeStackInfo {
                    id: stack_id.clone(),
                    number: stack_number,
                    position: member.position,
                    size,
                    members: members.clone(),
                },
            );
        }
    }
    result
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
                    // GitHub returns "LEFT" for the pre-change side and "RIGHT" for the
                    // post-change side. The field is absent on older single-line comments
                    // — GitHub's documented default is "RIGHT".
                    let side = match c.get("side").and_then(serde_json::Value::as_str) {
                        Some("LEFT") => crate::types::DiffSide::Old,
                        _ => crate::types::DiffSide::New,
                    };
                    Some(PrComment {
                        id: c.get("id")?.as_u64()?,
                        author: c.get("user")?.get("login")?.as_str()?.to_string(),
                        body: c.get("body")?.as_str()?.to_string(),
                        path: c.get("path").and_then(|v| v.as_str()).map(std::string::ToString::to_string),
                        line: c.get("line").and_then(serde_json::Value::as_u64).map(|n| n as u32),
                        side,
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
                        side: crate::types::DiffSide::default(),
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
        // GitHub PR diffs only expose patch text, not full file content.
        // The Monaco renderer falls back to a placeholder when both are None.
        original_content: None,
        modified_content: None,
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

/// Process-wide shared reqwest client. We share one pool across every
/// `GithubManager` so we don't accumulate idle TCP sockets — see the cache
/// docs below.
///
/// Panics if the bounded client fails to build — the only realistic failure
/// is TLS init, which is unrecoverable at startup. Falling back to a default
/// client would silently re-introduce the unbounded pool this exists to
/// eliminate, which is the worse failure mode (FD leak shows up weeks later).
#[allow(clippy::expect_used)]
fn shared_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .pool_max_idle_per_host(4)
            .pool_idle_timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("failed to build shared HTTP client")
    })
}

/// Process-wide cache of `GithubManager`s keyed by token.
///
/// Why: every `GithubManager::new` used to construct a fresh octocrab and
/// reqwest client. Each fresh `reqwest::Client` owns its own connection pool
/// with default `pool_idle_timeout` of 90 s and no idle-cap, so TCP sockets
/// to `api.github.com` accumulated as FDs across the periodic poll loop and
/// every per-PR detail fetch. On users with many worktrees + repos this
/// exhausted the macOS 256-FD limit and surfaced as
/// `Git error: failed to spawn git: Too many open files` (because `git2`
/// needs an FD to fork). Reusing one manager per token reuses one pool.
///
/// Entries are evicted via `invalidate_for_repo` (called from
/// `config_manager::save_config`) when the token changes, so the cache stays
/// in lockstep with `token_cache`.
fn manager_cache() -> &'static Mutex<BoundedLru<String, Arc<GithubManager>>> {
    static CACHE: OnceLock<Mutex<BoundedLru<String, Arc<GithubManager>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(BoundedLru::new(CACHE_CAP)))
}

/// Force the shared HTTP client to initialize now, so a TLS-init failure
/// crashes loudly at app startup instead of on the first GitHub interaction
/// — by which time the user has typed into the UI and would lose state.
/// Call from `lib.rs` setup; idempotent.
pub(crate) fn init_shared_clients() {
    let _ = shared_http_client();
}

impl GithubManager {
    /// Construct a `GithubManager` for the given token without touching the
    /// shared cache. Prefer `shared` — this is kept for callers that need a
    /// one-off manager (e.g. tests).
    pub fn new(token: &str) -> Result<Self, AppError> {
        let client = Octocrab::builder()
            .personal_token(token.to_string())
            .set_connect_timeout(Some(std::time::Duration::from_secs(10)))
            .set_read_timeout(Some(std::time::Duration::from_secs(30)))
            .build()
            .map_err(|e| AppError::Github(format!("failed to build octocrab client: {e}")))?;
        let http_client = shared_http_client().clone();
        Ok(Self { client, http_client, token: token.to_string() })
    }

    /// Get a shared `GithubManager` for the given token, building one on
    /// first use and reusing it on every subsequent call. The returned
    /// `Arc` lets callers hold a handle without copying the underlying
    /// HTTP clients or their connection pools.
    pub fn shared(token: &str) -> Result<Arc<Self>, AppError> {
        let mut guard = manager_cache().lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        let key = token.to_string();
        if let Some(existing) = guard.get(&key) {
            return Ok(existing.clone());
        }
        let manager = Arc::new(Self::new(token)?);
        guard.insert(key, manager.clone());
        Ok(manager)
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

    /// Fetch native GitHub Stack membership for all open PRs in a repo
    /// (public preview, via the undocumented `stackEntry` GraphQL field —
    /// absent from REST and `gh pr view --json`). Returns PR number →
    /// stack info; PRs not in a stack are absent from the map.
    ///
    /// Cursor-paginated, newest PRs first: GitHub's default ordering is
    /// oldest-first, so a >100-open-PR repo would otherwise silently drop
    /// its newest PRs from the membership map. The page cap is a runaway
    /// guard; ordering by CREATED_AT DESC means even a cap hit favours the
    /// PRs a live worktree is most likely stacked on.
    ///
    /// `None` means the fetch or response shape failed (transport error,
    /// GraphQL error, preview-API withdrawal) — warned once per process,
    /// and callers must NOT treat it as "no stacks": that would re-arm
    /// every stand-down gate on a transient 5xx. `Some(map)` is
    /// authoritative, including an authoritatively empty map.
    pub async fn fetch_native_stack_entries(
        &self,
        owner: &str,
        repo: &str,
    ) -> Option<HashMap<u64, NativeStackInfo>> {
        // 10 pages × 100 PRs is far beyond any repo Alfredo watches; the cap
        // only exists so a pathological pageInfo can't loop forever.
        const MAX_PAGES: usize = 10;

        let mut nodes: Vec<serde_json::Value> = Vec::new();
        let mut cursor: Option<String> = None;
        for _ in 0..MAX_PAGES {
            let after = cursor
                .as_ref()
                .map(|c| format!(r#", after: "{c}""#))
                .unwrap_or_default();
            let query = format!(
                r#"{{
  repository(owner: "{owner}", name: "{repo}") {{
    pullRequests(states: [OPEN], first: 100, orderBy: {{field: CREATED_AT, direction: DESC}}{after}) {{
      pageInfo {{ hasNextPage endCursor }}
      nodes {{
        number
        title
        headRefName
        state
        url
        stackEntry {{
          position
          stack {{ id number size }}
        }}
      }}
    }}
  }}
}}"#
            );

            let body = serde_json::json!({ "query": query });
            let request = async {
                self.http_client
                    .post("https://api.github.com/graphql")
                    .header("Authorization", format!("Bearer {}", self.token()))
                    .header("User-Agent", "alfredo")
                    .json(&body)
                    .send()
                    .await?
                    .json::<serde_json::Value>()
                    .await
            };
            let response = match request.await {
                Ok(v) => v,
                Err(e) => {
                    warn_native_stack_once(&format!("request failed for {owner}/{repo}: {e}"));
                    return None;
                }
            };

            let Some(page_nodes) = response
                .pointer("/data/repository/pullRequests/nodes")
                .and_then(serde_json::Value::as_array)
            else {
                let errors = response
                    .get("errors")
                    .map(ToString::to_string)
                    .unwrap_or_else(|| "no data in response".to_string());
                warn_native_stack_once(&format!(
                    "unexpected GraphQL response for {owner}/{repo}: {errors}"
                ));
                return None;
            };
            nodes.extend(page_nodes.iter().cloned());

            // pageInfo parsing is fail-soft: a missing/odd shape ends the loop
            // with the pages already gathered rather than erroring out.
            let page_info = response.pointer("/data/repository/pullRequests/pageInfo");
            let has_next = page_info
                .and_then(|p| p.get("hasNextPage"))
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            if !has_next {
                break;
            }
            cursor = page_info
                .and_then(|p| p.get("endCursor"))
                .and_then(serde_json::Value::as_str)
                .map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }
        Some(parse_native_stack_nodes(&nodes))
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

/// Resolve a `GithubManager` + owner/repo from a repo path in one call.
/// Loads the per-repo config, resolves the token, and parses the remote URL.
/// The token is cached per repo and invalidated by `save_config`, so it survives
/// across IPC calls but takes effect immediately when the user updates it.
pub async fn github_context(app_data_dir: &std::path::Path, repo_path: &str) -> Result<(Arc<GithubManager>, String, String), AppError> {
    let token = cached_token(app_data_dir, repo_path).await?;
    let manager = GithubManager::shared(&token)?;
    let (owner, repo) = resolve_owner_repo(repo_path).await?;
    Ok((manager, owner, repo))
}

/// Per-repo cache of resolved GitHub tokens. Avoids reshelling `gh auth token`
/// on every IPC call while still allowing invalidation when the user updates
/// or disconnects the token via `save_config`/`github_auth_disconnect`.
///
/// Previously this was a process-wide `OnceCell` that resolved once and froze
/// forever, which had two pathologies: (1) changing the token required an app
/// restart, and (2) the first repo's token was reused as the cached answer for
/// every subsequent repo regardless of its actual config.
fn token_cache() -> &'static tokio::sync::RwLock<BoundedLru<String, String>> {
    static CACHE: OnceLock<tokio::sync::RwLock<BoundedLru<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| tokio::sync::RwLock::new(BoundedLru::new(CACHE_CAP)))
}

/// Normalize a repo path to a stable cache key — trailing slashes, symlinked
/// variants, and relative paths all collapse to the same canonical form.
/// Matches the strategy `resolve_owner_repo` already uses for its cache, so a
/// `save_config` invalidation hits the same key that `cached_token` inserted.
///
/// Contract: callers must pass post-expansion absolute paths (no `~`). If
/// `canonicalize` fails (e.g. the path no longer exists) we fall back to the
/// raw string — that's only symmetric across cache boundaries when the input
/// itself is consistent, so don't mix expanded and unexpanded forms.
fn canonical_key(repo_path: &str) -> String {
    std::path::Path::new(repo_path)
        .canonicalize()
        .ok()
        .and_then(|p| p.to_str().map(ToString::to_string))
        .unwrap_or_else(|| repo_path.to_string())
}

async fn cached_token(app_data_dir: &std::path::Path, repo_path: &str) -> Result<String, AppError> {
    let key = canonical_key(repo_path);
    // BoundedLru::get touches MRU on hit, so we need the write lock unconditionally.
    // The cache is tiny (cap = CACHE_CAP) so write-contention is negligible.
    if let Some(token) = token_cache().write().await.get(&key).cloned() {
        return Ok(token);
    }
    let config = crate::config_manager::load_personal_config(app_data_dir, repo_path).await?;
    let token = resolve_token(config.github_token.as_deref()).await?;
    token_cache().write().await.insert(key, token.clone());
    Ok(token)
}

/// Drop cached GitHub state for a repo. Called from `config_manager::save_config`
/// so that updates to `github_token` (or sign-out via `github_auth_disconnect`)
/// take effect immediately — the next `github_context` call re-reads the
/// keychain and rebuilds the `GithubManager` for the new token.
///
/// We only evict the cached `GithubManager` if no other repo is still using
/// the same token (multiple repos commonly share a global `gh` CLI token).
pub(crate) async fn invalidate_for_repo(repo_path: &str) {
    let key = canonical_key(repo_path);
    // Hold the write lock across remove + "still in use" check so another
    // caller can't reinsert the same token between the two steps.
    let mut tok_guard = token_cache().write().await;
    let Some(old_token) = tok_guard.remove(&key) else { return };
    let still_used = tok_guard.values().any(|t| t == &old_token);
    drop(tok_guard);
    if !still_used {
        let mut mgr_guard = manager_cache().lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        mgr_guard.remove(&old_token);
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
            .ok()
            .filter(|u| !u.is_empty())
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

/// Reduce each reviewer's reviews to their most recent *decisive* state —
/// one of "approved", "changes_requested", or "dismissed". "commented" and
/// "pending" entries are ignored because GitHub does not treat them as
/// superseding a prior decisive review (e.g. leaving a "ship it!" comment
/// after approving keeps the approval valid).
///
/// Pass the raw, un-deduplicated review list so the most-recent-decisive
/// review can be identified even when a later non-decisive review exists.
fn latest_decisive_states(reviews: &[PrReview]) -> Vec<&str> {
    let mut latest: std::collections::HashMap<String, &PrReview> = std::collections::HashMap::new();
    for r in reviews {
        if !matches!(r.state.as_str(), "approved" | "changes_requested" | "dismissed") {
            continue;
        }
        let key = r.reviewer.to_lowercase();
        match latest.get(&key) {
            Some(existing) if existing.submitted_at >= r.submitted_at => {}
            _ => {
                latest.insert(key, r);
            }
        }
    }
    latest.into_values().map(|r| r.state.as_str()).collect()
}

/// The given user's most recent decisive review state ("approved",
/// "changes_requested", or "dismissed"), if they have one. Comparison is
/// case-insensitive — GitHub logins are.
fn my_latest_decisive_state<'a>(reviews: &'a [PrReview], user: &str) -> Option<&'a str> {
    reviews
        .iter()
        .filter(|r| r.reviewer.eq_ignore_ascii_case(user))
        .filter(|r| matches!(r.state.as_str(), "approved" | "changes_requested" | "dismissed"))
        .max_by(|a, b| a.submitted_at.cmp(&b.submitted_at))
        .map(|r| r.state.as_str())
}

/// Determine the kanban column for a worktree based on its PR status.
///
/// When `github_username` is provided, open (non-draft) PRs are split into
/// "In Review" (user is the author) vs "Needs Review" (someone else's PR).
/// My involvement takes precedence over the aggregate review state: an open
/// request for my review parks the card in Needs Review (a re-request after my
/// approval pulls it back), and my own approval — not just anyone's — moves it
/// to Done. PRs I was never asked to review keep the aggregate behaviour:
/// resolve to "Done" when any reviewer has an active approving review and no
/// reviewer has an outstanding `changes_requested`. A dismissed approval flips
/// back to "Needs Review" since the latest-decisive state is no longer "approved".
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
            // My involvement takes precedence over the aggregate review
            // state: an open request for my review parks the card in Needs
            // Review (a re-request after my approval pulls it back), and my
            // own approval — not just anyone's — moves it to Done. PRs I was
            // never asked to review keep the aggregate behaviour below.
            if let Some(user) = github_username {
                if pr.requested_reviewers.iter().any(|r| r.eq_ignore_ascii_case(user)) {
                    return KanbanColumn::NeedsReview;
                }
                if my_latest_decisive_state(reviews, user) == Some("approved") {
                    return KanbanColumn::Done;
                }
            }
            let states = latest_decisive_states(reviews);
            if states.contains(&"changes_requested") {
                return KanbanColumn::NeedsReview;
            }
            if states.contains(&"approved") {
                return KanbanColumn::Done;
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
            native_stack: None,
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
            native_stack: None,
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
            native_stack: None,
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
            native_stack: None,
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
            native_stack: None,
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
            native_stack: None,
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
            native_stack: None,
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
    fn test_determine_column_others_pr_approved_with_pending_individual_request() {
        // A pending individual request for MY review always parks the card in
        // Needs Review — a re-request after my approval pulls it back. (Spec:
        // 2026-08-06-review-requests-design.md, "Column semantics fix".)
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
            native_stack: None,
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
    fn test_determine_column_others_pr_approved_by_someone_else() {
        // When I'm in requested_reviewers, my pending request takes precedence:
        // the PR stays in Needs Review even if someone else has approved it.
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
            native_stack: None,
        };
        let reviews = vec![PrReview {
            reviewer: "another-reviewer".into(),
            state: "approved".into(),
            submitted_at: Some("2026-05-07T10:00:00Z".into()),
            body: None,
        }];
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &reviews), KanbanColumn::NeedsReview);
    }

    #[test]
    fn test_determine_column_others_pr_approved_but_someone_else_requested_changes() {
        // An outstanding changes_requested from any reviewer overrides another
        // reviewer's approval — matches GitHub's CHANGES_REQUESTED state.
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
            native_stack: None,
        };
        let reviews = vec![
            PrReview {
                reviewer: "approver".into(),
                state: "approved".into(),
                submitted_at: Some("2026-05-07T10:00:00Z".into()),
                body: None,
            },
            PrReview {
                reviewer: "blocker".into(),
                state: "changes_requested".into(),
                submitted_at: Some("2026-05-07T11:00:00Z".into()),
                body: None,
            },
        ];
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
            native_stack: None,
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
            native_stack: None,
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
            native_stack: None,
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
            native_stack: None,
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
        // Any active approval — including from a different reviewer — moves
        // the PR to Done.
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
            native_stack: None,
        };
        let reviews = vec![PrReview {
            reviewer: "alice".into(),
            state: "approved".into(),
            submitted_at: Some("2026-05-07T10:00:00Z".into()),
            body: None,
        }];
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &reviews), KanbanColumn::Done);
    }

    #[test]
    fn test_determine_column_requested_reviewer_parks_in_needs_review() {
        // I'm in requested_reviewers and haven't reviewed → Needs Review,
        // regardless of what other reviewers have done.
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
            requested_reviewers: vec!["Chloe".into()], // case differs on purpose
            native_stack: None,
        };
        let reviews = vec![PrReview {
            reviewer: "another-reviewer".into(),
            state: "approved".into(),
            submitted_at: Some("2026-05-07T10:00:00Z".into()),
            body: None,
        }];
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &reviews), KanbanColumn::NeedsReview);
    }

    #[test]
    fn test_determine_column_my_approval_beats_others_changes_requested() {
        // Once I've approved (and I'm no longer requested), the PR is off my
        // plate → Done, even if another reviewer has changes_requested open.
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
            native_stack: None,
        };
        let reviews = vec![
            PrReview {
                reviewer: "chloe".into(),
                state: "approved".into(),
                submitted_at: Some("2026-05-07T10:00:00Z".into()),
                body: None,
            },
            PrReview {
                reviewer: "another-reviewer".into(),
                state: "changes_requested".into(),
                submitted_at: Some("2026-05-07T11:00:00Z".into()),
                body: None,
            },
        ];
        assert_eq!(determine_column(Some(&pr), Some("chloe"), &reviews), KanbanColumn::Done);
    }

    #[test]
    fn test_determine_column_my_dismissed_approval_is_not_done() {
        // My approval was dismissed → my latest decisive state is "dismissed",
        // not "approved" → falls through; no other reviews → Needs Review.
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
            native_stack: None,
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

    // --- parse_native_stack_response tests ---

    fn stack_node(
        number: u64,
        branch: &str,
        position: u64,
        stack_id: &str,
    ) -> serde_json::Value {
        serde_json::json!({
            "number": number,
            "title": format!("PR #{number}"),
            "headRefName": branch,
            "state": "OPEN",
            "url": format!("https://github.com/o/r/pull/{number}"),
            "stackEntry": {
                "position": position,
                "stack": { "id": stack_id, "number": 7, "size": 2 }
            }
        })
    }

    #[test]
    fn test_parse_native_stack_member_with_ordered_roster() {
        // Response order is position-descending; roster must come back sorted.
        let nodes = vec![
            stack_node(12, "feat/layer-2", 2, "ST_abc"),
            stack_node(11, "feat/layer-1", 1, "ST_abc"),
        ];
        let map = parse_native_stack_nodes(&nodes);
        assert_eq!(map.len(), 2);

        let info = map.get(&11).unwrap();
        assert_eq!(info.id, "ST_abc");
        assert_eq!(info.number, 7);
        assert_eq!(info.position, 1);
        assert_eq!(info.size, 2);
        let roster: Vec<(u64, u32)> = info.members.iter().map(|m| (m.number, m.position)).collect();
        assert_eq!(roster, vec![(11, 1), (12, 2)]);
        assert_eq!(info.members[0].branch, "feat/layer-1");
        assert_eq!(info.members[0].title, "PR #11");
        assert_eq!(info.members[0].state, "OPEN");
        assert_eq!(info.members[0].url, "https://github.com/o/r/pull/11");

        // Every member's entry carries the same full roster, with its own position.
        let upper = map.get(&12).unwrap();
        assert_eq!(upper.position, 2);
        assert_eq!(upper.members, info.members);
    }

    // A stack whose members straddle a page boundary must come back as one
    // roster — grouping runs over the accumulated node list, never per page.
    #[test]
    fn test_parse_native_stack_nodes_merges_members_across_pages() {
        let page_one = vec![stack_node(12, "feat/layer-2", 2, "ST_abc")];
        let page_two = vec![
            stack_node(11, "feat/layer-1", 1, "ST_abc"),
            stack_node(30, "feat/other", 1, "ST_xyz"),
        ];
        let combined: Vec<serde_json::Value> =
            page_one.into_iter().chain(page_two).collect();

        let map = parse_native_stack_nodes(&combined);
        assert_eq!(map.len(), 3);

        let info = map.get(&11).unwrap();
        assert_eq!(info.id, "ST_abc");
        let roster: Vec<(u64, u32)> = info.members.iter().map(|m| (m.number, m.position)).collect();
        assert_eq!(roster, vec![(11, 1), (12, 2)], "cross-page members share one sorted roster");
        assert_eq!(map.get(&12).unwrap().members, info.members);

        // The unrelated stack on page two stays its own roster.
        assert_eq!(map.get(&30).unwrap().id, "ST_xyz");
        assert_eq!(map.get(&30).unwrap().members.len(), 1);
    }

    #[test]
    fn test_parse_native_stack_null_entry_absent() {
        let nodes = vec![
            serde_json::json!({
                "number": 40,
                "title": "Solo PR",
                "headRefName": "feat/solo",
                "state": "OPEN",
                "url": "https://github.com/o/r/pull/40",
                "stackEntry": null
            }),
            stack_node(11, "feat/layer-1", 1, "ST_abc"),
        ];
        let map = parse_native_stack_nodes(&nodes);
        assert!(!map.contains_key(&40));
        assert!(map.contains_key(&11));
    }

    #[test]
    fn test_parse_native_stack_missing_field_skips_node() {
        // stack object lost its `id` (schema drift) → node skipped, fail-open.
        let nodes = vec![serde_json::json!({
            "number": 11,
            "title": "PR #11",
            "headRefName": "feat/layer-1",
            "state": "OPEN",
            "url": "https://github.com/o/r/pull/11",
            "stackEntry": {
                "position": 1,
                "stack": { "number": 7, "size": 2 }
            }
        })];
        assert!(parse_native_stack_nodes(&nodes).is_empty());
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

    // --- Shared cache invariants ---
    //
    // The static caches are process-wide, so tests use unique tokens / paths
    // (a per-test prefix) to avoid cross-test interference when run in
    // parallel. We assert behaviour, not absolute cache size. All tests run
    // on a tokio runtime because Octocrab's builder needs one.

    fn mgr_cache_contains(token: &str) -> bool {
        manager_cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .contains_key(token)
    }

    #[tokio::test]
    async fn shared_returns_same_arc_for_same_token() {
        let token = "test-fd-fix-aaa-same-token";
        let a = GithubManager::shared(token).unwrap();
        let b = GithubManager::shared(token).unwrap();
        assert!(Arc::ptr_eq(&a, &b), "same token must return the same Arc");
    }

    #[tokio::test]
    async fn shared_returns_distinct_arcs_for_distinct_tokens() {
        let a = GithubManager::shared("test-fd-fix-aaa-distinct-1").unwrap();
        let b = GithubManager::shared("test-fd-fix-aaa-distinct-2").unwrap();
        assert!(!Arc::ptr_eq(&a, &b), "distinct tokens must return distinct Arcs");
    }

    #[tokio::test]
    async fn invalidate_evicts_manager_when_token_unused_elsewhere() {
        let token = "test-fd-fix-bbb-sole-user";
        let repo = "/tmp/alfredo-test-bbb-sole-user-repo";
        token_cache().write().await.insert(repo.into(), token.into());
        let _mgr = GithubManager::shared(token).unwrap();
        assert!(mgr_cache_contains(token));

        invalidate_for_repo(repo).await;

        assert!(!token_cache().read().await.contains_key(repo));
        assert!(!mgr_cache_contains(token));
    }

    #[tokio::test]
    async fn invalidate_keeps_manager_when_another_repo_shares_token() {
        let token = "test-fd-fix-ccc-shared";
        let repo_a = "/tmp/alfredo-test-ccc-shared-repo-a";
        let repo_b = "/tmp/alfredo-test-ccc-shared-repo-b";
        {
            let mut g = token_cache().write().await;
            g.insert(repo_a.into(), token.into());
            g.insert(repo_b.into(), token.into());
        }
        let _mgr = GithubManager::shared(token).unwrap();

        invalidate_for_repo(repo_a).await;

        assert!(!token_cache().read().await.contains_key(repo_a));
        assert!(token_cache().read().await.contains_key(repo_b));
        assert!(
            mgr_cache_contains(token),
            "manager must survive while another repo still references the token"
        );

        // Cleanup so we don't pollute other tests.
        token_cache().write().await.remove(repo_b);
        manager_cache()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(token);
    }
}
