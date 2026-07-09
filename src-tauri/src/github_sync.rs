use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tokio::time;

use crate::config_manager;
use crate::github_manager::{dedup_reviews, derive_review_decision, determine_column, GithubManager};
use crate::platform::gh_command;
use crate::types::{PrStatus, CheckRun, PrReview, PrComment, KanbanColumn};

/// Window during which a just-merged PR is still worth enriching (reviews, checks,
/// comments). Covers the common case of a cubic/human reviewer leaving a comment
/// moments before or after merge without burning API budget on stale merged PRs.
const RECENTLY_MERGED_WINDOW_HOURS: i64 = 24;

/// Window during which a closed-not-merged PR is still worth enriching.
/// PrStatus has no `closed_at`, so we use `updated_at` as a proxy: closing a
/// PR bumps `updated_at` on GitHub's side. Subsequent comments would also
/// bump `updated_at`, so this window is "time since last activity, not
/// necessarily time since close" — slightly generous, intentionally so.
const RECENTLY_CLOSED_WINDOW_HOURS: i64 = 24;

fn is_within_window(timestamp: Option<&str>, window_hours: i64) -> bool {
    let Some(raw) = timestamp else { return false; };
    let Ok(ts) = chrono::DateTime::parse_from_rfc3339(raw) else { return false; };
    let age = chrono::Utc::now().signed_duration_since(ts.with_timezone(&chrono::Utc));
    age.num_hours() < window_hours
}

/// Whether a PR was merged within the recent-enrichment window.
/// Treats unparseable timestamps as "not recent" (safer — we stop polling).
fn is_recently_merged(merged_at: Option<&str>) -> bool {
    is_within_window(merged_at, RECENTLY_MERGED_WINDOW_HOURS)
}

/// Whether enrichment (mergeable/reviews/checks/comments) should still run
/// for this PR. Open PRs always qualify; merged and closed-not-merged PRs
/// only qualify within their respective recency windows. Worktrees still
/// reference closed/merged PRs until the user archives them, so without
/// this gate every active worktree fans out 6+ REST calls per minute even
/// for PRs that haven't moved in months.
fn should_enrich(pr: &PrStatusWithColumn) -> bool {
    if pr.state != "closed" {
        return true;
    }
    if pr.merged {
        is_recently_merged(pr.merged_at.as_deref())
    } else {
        is_within_window(pr.updated_at.as_deref(), RECENTLY_CLOSED_WINDOW_HOURS)
    }
}

/// Whether a check run counts as failing for the PR "Checks pass" rollup.
///
/// Fail-safe inverse of GitHub's "successful" set: a required check satisfies
/// branch protection only when its conclusion is `success`, `skipped`, or
/// `neutral`. Any other completed conclusion — `failure`, `timed_out`,
/// `action_required`, `cancelled` (issue #52), `stale`, or a conclusion GitHub
/// adds in future — does not, so we count it as failing rather than silently
/// showing "Checks pass". In-progress runs (not yet completed) are pending.
fn check_run_is_failing(cr: &CheckRun) -> bool {
    cr.status == "completed"
        && !matches!(
            cr.conclusion.as_deref(),
            Some("success") | Some("skipped") | Some("neutral") | None
        )
}

/// Payload emitted on the `github:pr-update` Tauri event.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrUpdatePayload {
    /// All PR statuses fetched from GitHub (matched to branches).
    pub prs: Vec<PrStatusWithColumn>,
}

/// A PR status annotated with the auto-determined kanban column.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusWithColumn {
    pub number: u64,
    pub state: String,
    pub title: String,
    pub url: String,
    pub draft: bool,
    pub merged: bool,
    pub branch: String,
    pub auto_column: String,
    pub merged_at: Option<String>,
    pub head_sha: Option<String>,
    /// Number of check runs with a failing conclusion.
    pub failing_check_count: Option<u32>,
    /// Number of check runs still in progress or queued.
    pub pending_check_count: Option<u32>,
    /// Number of unresolved line-level review comments.
    pub unresolved_comment_count: Option<u32>,
    /// Derived review decision: "approved", "changes_requested", or "review_required".
    pub review_decision: Option<String>,
    /// Whether the PR is mergeable per GitHub's assessment.
    pub mergeable: Option<bool>,
    /// PR description body text.
    pub body: Option<String>,
    /// The repo path this PR belongs to, for multi-repo disambiguation.
    pub repo_path: String,
    /// Full check run objects for the PR panel.
    pub check_runs: Vec<CheckRun>,
    /// Full review objects for the PR panel.
    pub reviews: Vec<PrReview>,
    /// Line comments + issue comments merged, for the PR panel.
    /// None means comments were not fetched in this sync batch (frontend preserves cache).
    pub comments: Option<Vec<PrComment>>,
    /// ISO 8601 timestamp of the last update to this PR.
    pub updated_at: Option<String>,
    /// GitHub login of the PR author.
    pub author: Option<String>,
    /// GitHub logins of users requested to review this PR.
    pub requested_reviewers: Vec<String>,
    /// The base (target) branch for this PR (e.g. "develop", "main").
    pub base_branch: Option<String>,
}

/// Serialize a `KanbanColumn` to its camelCase string form (e.g. "needsReview").
/// Falls back to "inProgress" if serialization somehow fails — this matches the
/// pre-existing default and is unreachable in practice for a unit enum.
fn column_to_string(column: &KanbanColumn) -> String {
    serde_json::to_value(column)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_else(|| "inProgress".to_string())
}

impl PrStatusWithColumn {
    fn from_pr(pr: &PrStatus, repo_path: &str, github_username: Option<&str>) -> Self {
        // Initial column is computed without review data — recomputed in
        // poll_repo only for PRs that pass `should_enrich` AND have an active
        // worktree. PRs the user has approved will start as "Needs Review"
        // and flip to "Done" after the reviews fetch; PRs without an active
        // worktree never get the recompute (acceptable today since those
        // never surface as cards, but worth knowing if that ever changes).
        let column = determine_column(Some(pr), github_username, &[]);
        Self {
            number: pr.number,
            state: pr.state.clone(),
            title: pr.title.clone(),
            url: pr.url.clone(),
            draft: pr.draft,
            merged: pr.merged,
            branch: pr.branch.clone(),
            auto_column: column_to_string(&column),
            merged_at: pr.merged_at.clone(),
            head_sha: pr.head_sha.clone(),
            body: pr.body.clone(),
            failing_check_count: None,
            pending_check_count: None,
            unresolved_comment_count: None,
            review_decision: None,
            mergeable: None,
            repo_path: repo_path.to_string(),
            check_runs: Vec::new(),
            reviews: Vec::new(),
            comments: None,
            updated_at: pr.updated_at.clone(),
            author: pr.author.clone(),
            requested_reviewers: pr.requested_reviewers.clone(),
            base_branch: pr.base_branch.clone(),
        }
    }
}

/// Start the background GitHub PR sync loop.
///
/// Polls every 60 seconds normally. On rate-limit 403s, sleeps until the
/// `X-RateLimit-Reset` timestamp (via the /rate_limit endpoint). On generic
/// failures, backs off: 60s → 120s → 240s until a successful sync.
pub fn start_sync_loop(app_handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut consecutive_failures: u32 = 0;

        loop {
            let outcome = poll_once(&app_handle).await;

            let delay = match outcome {
                // Rate-limit branches are checked BEFORE any_success so that a
                // partial-success poll (one repo ok, another 403'd) still
                // respects the reset window instead of re-hitting the limit in
                // 60s.
                Ok(PollOutcome { rate_limit_reset: Some(reset_ts), .. }) => {
                    consecutive_failures = 0;
                    let now = std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let wait = reset_ts.saturating_sub(now).saturating_add(5);
                    let wait = wait.clamp(60, 3600);
                    eprintln!("[github_sync] rate-limited; sleeping {wait}s until reset");
                    Duration::from_secs(wait)
                }
                Ok(PollOutcome { rate_limit_fallback: true, .. }) => {
                    consecutive_failures = 0;
                    eprintln!(
                        "[github_sync] rate-limited (secondary or unknown reset); sleeping {RATE_LIMIT_FALLBACK_SECS}s"
                    );
                    Duration::from_secs(RATE_LIMIT_FALLBACK_SECS)
                }
                Ok(PollOutcome { any_success: true, .. }) => {
                    consecutive_failures = 0;
                    Duration::from_secs(60)
                }
                Ok(PollOutcome { any_success: false, .. }) => {
                    if consecutive_failures < 2 {
                        consecutive_failures += 1;
                    }
                    eprintln!("[github_sync] all repos failed, backing off (tier {consecutive_failures})");
                    match consecutive_failures {
                        1 => Duration::from_secs(120),
                        _ => Duration::from_secs(240),
                    }
                }
                Err(e) => {
                    eprintln!("[github_sync] poll error: {e}");
                    if consecutive_failures < 2 {
                        consecutive_failures += 1;
                    }
                    Duration::from_secs(120)
                }
            };
            time::sleep(delay).await;
        }
    });
}

/// Result of a single poll iteration.
#[derive(Default)]
struct PollOutcome {
    /// True if at least one repo synced successfully.
    any_success: bool,
    /// Set when any repo hit a rate-limit 403; the unix timestamp when the
    /// core REST limit resets. Loop uses this to sleep until the window opens.
    rate_limit_reset: Option<u64>,
    /// Set when we saw a rate-limit but either couldn't read the reset
    /// timestamp, or it was a secondary/abuse limit (which uses a separate
    /// budget from `/rate_limit`'s core counters).
    rate_limit_fallback: bool,
}

/// Resolve the repo paths from managed state.
fn get_sync_state(app_handle: &AppHandle) -> (Vec<String>, std::collections::HashSet<String>) {
    let Some(state) = app_handle.try_state::<SyncState>() else {
        return (Vec::new(), std::collections::HashSet::new());
    };
    let paths = state.repo_paths.lock().map(|p| p.clone()).unwrap_or_default();
    let branches = state.active_branches.lock().map(|b| b.clone()).unwrap_or_default();
    (paths, branches)
}

/// Managed state to hold the repo paths and active worktree branches for the sync loop.
pub struct SyncState {
    pub repo_paths: std::sync::Mutex<Vec<String>>,
    /// Branches that have active worktrees — only these PRs get full enrichment.
    pub active_branches: std::sync::Mutex<std::collections::HashSet<String>>,
}

/// Set the repo paths and active branches so the sync loop knows what to poll and enrich.
/// Also triggers an immediate poll so worktrees get correct PR status on startup
/// without waiting for the next 30-second tick.
#[tauri::command]
pub async fn set_sync_repo_paths(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, SyncState>,
    repo_paths: Vec<String>,
    active_branches: Vec<String>,
) -> Result<(), String> {
    {
        let mut paths = state.repo_paths.lock().map_err(|e| e.to_string())?;
        *paths = repo_paths;
    }
    {
        let mut branches = state.active_branches.lock().map_err(|e| e.to_string())?;
        *branches = active_branches.into_iter().collect();
    }
    // Fire an immediate poll so the frontend doesn't wait for the next tick.
    if let Err(e) = poll_once(&app_handle).await {
        eprintln!("[github_sync] immediate poll after set_sync_repo_paths: {e}");
    }
    Ok(())
}

/// Single poll iteration: fetch PRs for all repos and emit two events.
///
/// Phase 1 (fast): Fetches PR list + mergeable/reviews/checks, emits immediately.
/// This unblocks the UI — worktrees get their prStatus and can start loading PR files.
///
/// Phase 2 (slower): Fetches comments for active PRs, emits an update.
/// The frontend preserves cached comments until this arrives.
///
/// Returns a `PollOutcome` describing success/failure state and any
/// rate-limit signal. The sync loop uses this to pick the next sleep.
async fn poll_once(app_handle: &AppHandle) -> Result<PollOutcome, String> {
    let (repo_paths, active_branches) = get_sync_state(app_handle);
    if repo_paths.is_empty() {
        return Ok(PollOutcome { any_success: true, ..Default::default() });
    }

    let app_data_dir = app_handle.path().app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?;

    let mut all_prs: Vec<PrStatusWithColumn> = Vec::new();
    let mut any_repo_succeeded = false;
    let mut rate_limit_fallback = false;
    let mut saw_primary_rate_limit_in: Option<String> = None;

    for repo_path in &repo_paths {
        match poll_repo(&app_data_dir, repo_path, &active_branches).await {
            Ok(prs) => {
                any_repo_succeeded = true;
                all_prs.extend(prs);
            }
            Err(e) if e.starts_with("auth:") => {
                let _ = app_handle.emit("github:auth-error", repo_path.as_str());
                eprintln!("[github_sync] auth failed for {repo_path}: {e}");
            }
            Err(e) => {
                eprintln!("[github_sync] error syncing {repo_path}: {e}");
                if is_rate_limit_error(&e) {
                    if is_secondary_rate_limit(&e) {
                        // Secondary/abuse limits use a separate budget from
                        // /rate_limit's core counter, so querying it would lie.
                        rate_limit_fallback = true;
                    } else if saw_primary_rate_limit_in.is_none() {
                        // Defer the /rate_limit lookup: one call covers all
                        // repos on the same token.
                        saw_primary_rate_limit_in = Some(repo_path.clone());
                    }
                }
            }
        }
    }

    // Resolve primary rate-limit reset once — all repos share the same token.
    let rate_limit_reset = if let Some(repo_path) = saw_primary_rate_limit_in {
        match fetch_rate_limit_reset(&app_data_dir, &repo_path).await {
            Some(ts) => Some(ts),
            None => {
                eprintln!("[github_sync] /rate_limit lookup failed — using fallback sleep");
                rate_limit_fallback = true;
                None
            }
        }
    } else {
        None
    };

    // Emit immediately — frontend gets prStatus/prNumber/baseBranch and can start loading files.
    // comments is None in these payloads; the frontend will preserve its cached comment data.
    if !all_prs.is_empty() {
        app_handle
            .emit("github:pr-update", &PrUpdatePayload { prs: all_prs.clone() })
            .map_err(|e| format!("failed to emit event: {e}"))?;
    }

    // Auto-sync PR base branches for stacked worktrees
    sync_pr_base_branches(&app_data_dir, &repo_paths, &all_prs).await;

    // Task 11: check for merged parents and auto-clear stack parent config
    crate::stack_manager::check_merged_parents(app_handle, &app_data_dir, &repo_paths, &all_prs).await;

    // Phase 2: enrich with comments (separate API calls, one PR at a time)
    for repo_path in &repo_paths {
        enrich_repo_with_comments(&mut all_prs, &app_data_dir, repo_path, &active_branches).await;
    }

    // Emit again with comment data populated
    if !all_prs.is_empty() {
        app_handle
            .emit("github:pr-update", &PrUpdatePayload { prs: all_prs })
            .map_err(|e| format!("failed to emit event: {e}"))?;
    }

    // Task 10: detect parent HEAD changes and auto-rebase stacked worktrees
    crate::stack_manager::check_and_rebase(app_handle, &app_data_dir, &repo_paths).await;

    // Task 12: compute and emit stack rebase statuses
    crate::stack_manager::compute_stack_statuses(app_handle, &app_data_dir, &repo_paths).await;

    Ok(PollOutcome {
        any_success: any_repo_succeeded,
        rate_limit_reset,
        rate_limit_fallback,
    })
}

/// Heuristic: the octocrab error message includes GitHub's verbatim text
/// "API rate limit exceeded" when a request is 403'd by the primary limiter.
fn is_rate_limit_error(err: &str) -> bool {
    err.contains("[403]")
        || err.contains("rate limit exceeded")
        || err.contains("secondary rate limit")
}

/// Secondary/abuse limits use a different budget than `/rate_limit` reports,
/// so core.reset is misleading — sleep a conservative window instead.
fn is_secondary_rate_limit(err: &str) -> bool {
    err.contains("secondary rate limit") || err.contains("abuse")
}

/// Fallback sleep when we detect a rate-limit but can't read the reset
/// timestamp (network error, secondary limit). 15 min beats the old 240s loop.
const RATE_LIMIT_FALLBACK_SECS: u64 = 900;

/// Look up the reset timestamp via `/rate_limit` (which doesn't count against
/// the limit) using the same token `poll_repo` would have used.
async fn fetch_rate_limit_reset(
    app_data_dir: &std::path::Path,
    repo_path: &str,
) -> Option<u64> {
    let config = config_manager::load_personal_config(app_data_dir, repo_path).await.ok()?;
    let token = crate::github_manager::resolve_token(config.github_token.as_deref()).await.ok()?;
    let manager = GithubManager::shared(&token).ok()?;
    manager.rate_limit_reset().await.ok()
}

/// Fetch and enrich PRs for a single repo. Returns the enriched PR list.
async fn poll_repo(
    app_data_dir: &std::path::Path,
    repo_path: &str,
    active_branches: &std::collections::HashSet<String>,
) -> Result<Vec<PrStatusWithColumn>, String> {
    let config = config_manager::load_personal_config(app_data_dir, repo_path)
        .await
        .map_err(|e| format!("{e}"))?;

    let token = match crate::github_manager::resolve_token(config.github_token.as_deref()).await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[github_sync] no token for {repo_path}: {e}");
            return Err(format!("auth:{repo_path}"));
        }
    };

    let manager = GithubManager::shared(&token).map_err(|e| format!("{e}"))?;

    let (owner, repo) = crate::github_manager::resolve_owner_repo(repo_path)
        .await
        .map_err(|e| format!("{e}"))?;

    let prs = manager
        .sync_prs(&owner, &repo)
        .await
        .map_err(|e| format!("{e}"))?;

    // Resolve the authenticated GitHub username so we can distinguish
    // "In Review" (own PRs) from "Needs Review" (others' PRs).
    let github_username = resolve_github_username().await;

    // Build the initial payload from PrStatus, then enrich open PRs with summary data.
    let mut payload_prs: Vec<PrStatusWithColumn> =
        prs.iter().map(|pr| PrStatusWithColumn::from_pr(pr, repo_path, github_username.as_deref())).collect();

    // Only enrich PRs that have active worktrees — no point fetching details
    // for PRs the user isn't looking at. This keeps API usage proportional to
    // the number of worktrees (typically 2-5), not the total open PRs (can be 80+).
    for (pr, pr_with_col) in prs.iter().zip(payload_prs.iter_mut()) {
        if !should_enrich(pr_with_col) {
            continue;
        }
        if !active_branches.contains(&pr_with_col.branch) {
            continue;
        }

        let pr_number = pr_with_col.number;

        let (mergeable_result, reviews_result, checks_result) = tokio::join!(
            manager.get_pr_mergeable(&owner, &repo, pr_number),
            manager.get_pr_reviews(&owner, &repo, pr_number),
            async {
                if let Some(ref sha) = pr_with_col.head_sha {
                    manager.get_check_runs(&owner, &repo, sha).await
                } else {
                    Ok(Vec::new())
                }
            },
        );

        if let Ok(mergeable) = mergeable_result {
            pr_with_col.mergeable = mergeable;
        }

        if let Ok(reviews) = reviews_result {
            // Recompute auto_column with the raw review list — others' PRs
            // with any active approval (and no outstanding changes_requested)
            // flip to Done. determine_column needs raw (un-deduped) reviews
            // so it can find the most-recent-decisive review per reviewer
            // even when a later non-decisive review (e.g. "commented") exists.
            let updated = determine_column(Some(pr), github_username.as_deref(), &reviews);
            pr_with_col.auto_column = column_to_string(&updated);
            let deduped = dedup_reviews(reviews);
            pr_with_col.review_decision = derive_review_decision(&deduped, &pr_with_col.requested_reviewers);
            pr_with_col.reviews = deduped;
        }

        if let Ok(check_runs) = checks_result {
            let failing = check_runs.iter().filter(|cr| check_run_is_failing(cr)).count() as u32;
            pr_with_col.failing_check_count = Some(failing);
            let pending = check_runs.iter().filter(|cr| {
                cr.status != "completed"
            }).count() as u32;
            pr_with_col.pending_check_count = Some(pending);
            // Store full check run objects for the PR panel
            pr_with_col.check_runs = check_runs;
        }

        // comments remain None — fetched separately in enrich_repo_with_comments
    }

    Ok(payload_prs)
}

/// Second-pass enrichment: fetch PR comments for active PRs in a repo and update the
/// payloads in-place. Called after poll_repo so the initial emit is not delayed.
async fn enrich_repo_with_comments(
    prs: &mut [PrStatusWithColumn],
    app_data_dir: &std::path::Path,
    repo_path: &str,
    active_branches: &std::collections::HashSet<String>,
) {
    let Ok(config) = config_manager::load_personal_config(app_data_dir, repo_path).await else { return; };
    let Ok(token) = crate::github_manager::resolve_token(config.github_token.as_deref()).await else { return; };
    let Ok(manager) = GithubManager::shared(&token) else { return; };
    let Ok((owner, repo)) = crate::github_manager::resolve_owner_repo(repo_path).await else { return; };

    // Collect indices + PR numbers for active, unmerged PRs
    let targets: Vec<(usize, u64)> = prs
        .iter()
        .enumerate()
        .filter(|(_, pr)| {
            pr.repo_path == repo_path
                && should_enrich(pr)
                && active_branches.contains(&pr.branch)
        })
        .map(|(i, pr)| (i, pr.number))
        .collect();

    // Fire all comment fetches concurrently
    let futures: Vec<_> = targets
        .iter()
        .map(|&(_, pr_number)| {
            let mgr = &manager;
            let o = &owner;
            let r = &repo;
            async move {
                let (line_result, issue_result, resolution) = tokio::join!(
                    mgr.get_pr_comments(o, r, pr_number),
                    mgr.get_pr_issue_comments(o, r, pr_number),
                    mgr.get_review_thread_resolution(o, r, pr_number),
                );
                let mut comments = line_result.unwrap_or_default();
                comments.extend(issue_result.unwrap_or_default());
                if let Ok(resolution) = resolution {
                    GithubManager::apply_thread_resolution(&mut comments, &resolution);
                }
                comments
            }
        })
        .collect();

    let results = futures::future::join_all(futures).await;

    // Apply results back to the mutable slice
    for ((idx, _), comments) in targets.into_iter().zip(results) {
        prs[idx].unresolved_comment_count = Some(
            comments.iter().filter(|c| !c.resolved).count() as u32,
        );
        prs[idx].comments = Some(comments);
    }
}

/// Sync PR base branches for stacked worktrees.
///
/// For each repo, checks if any PR's base branch differs from the expected
/// stack parent. If so, updates the PR via `gh pr edit --base`.
async fn sync_pr_base_branches(
    app_data_dir: &std::path::Path,
    repo_paths: &[String],
    all_prs: &[PrStatusWithColumn],
) {
    for repo_path in repo_paths {
        let Ok(config) = config_manager::load_personal_config(app_data_dir, repo_path).await else {
            continue;
        };

        if config.stack_parent_overrides.is_empty() {
            continue;
        }

        let Ok((owner, repo)) = crate::github_manager::resolve_owner_repo(repo_path).await else {
            continue;
        };

        for (worktree_name, expected_parent) in &config.stack_parent_overrides {
            // Skip if the parent branch has already been merged — check_merged_parents
            // will handle retargeting to main and clearing the stack parent.
            let parent_is_merged = all_prs.iter().any(|p| {
                p.repo_path == *repo_path && p.merged && p.branch == *expected_parent
            });
            if parent_is_merged {
                continue;
            }

            // Find the PR for this worktree's branch
            let Some(pr) = all_prs.iter().find(|p| {
                p.repo_path == *repo_path
                    && !p.merged
                    && p.branch.replace('/', "-") == *worktree_name
            }) else {
                continue;
            };

            // Compare the PR's actual base (from the sync payload) with the expected stack parent
            let Some(actual_base) = pr.base_branch.as_deref() else {
                continue;
            };

            if actual_base == expected_parent {
                continue;
            }

            // Update the PR base branch
            eprintln!(
                "[github_sync] updating PR #{} base: {} → {}",
                pr.number, actual_base, expected_parent
            );
            if let Err(e) = update_pr_base_branch(&owner, &repo, pr.number, expected_parent).await {
                eprintln!("[github_sync] failed to update PR base: {e}");
            }
        }
    }
}

/// Update a PR's base branch via `gh pr edit`.
pub async fn update_pr_base_branch(
    owner: &str,
    repo: &str,
    pr_number: u64,
    base_branch: &str,
) -> Result<(), String> {
    let output = gh_command()
        .args([
            "pr", "edit",
            &pr_number.to_string(),
            "--repo", &format!("{owner}/{repo}"),
            "--base", base_branch,
        ])
        .output()
        .await
        .map_err(|e| format!("failed to run gh pr edit: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh pr edit failed: {stderr}"));
    }
    Ok(())
}

/// Resolve the authenticated GitHub username via `gh api user`.
/// Caches the result for the lifetime of the process.
pub async fn resolve_github_username() -> Option<String> {
    use tokio::sync::OnceCell;

    static CACHED_USERNAME: OnceCell<Option<String>> = OnceCell::const_new();

    CACHED_USERNAME
        .get_or_init(|| async {
            gh_command()
                .args(["api", "user", "--jq", ".login"])
                .output()
                .await
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
                    } else {
                        None
                    }
                })
        })
        .await
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CheckRun, PrStatus};

    fn check_run(status: &str, conclusion: Option<&str>) -> CheckRun {
        CheckRun {
            id: 1,
            name: "ci".into(),
            status: status.into(),
            conclusion: conclusion.map(str::to_string),
            html_url: String::new(),
            started_at: None,
            completed_at: None,
            check_suite_id: None,
        }
    }

    #[test]
    fn test_check_run_is_failing_by_conclusion() {
        // Only success / skipped / neutral satisfy a required check, so those
        // are the only completed conclusions that are not failing.
        assert!(!check_run_is_failing(&check_run("completed", Some("success"))));
        assert!(!check_run_is_failing(&check_run("completed", Some("skipped"))));
        assert!(!check_run_is_failing(&check_run("completed", Some("neutral"))));
        // Every other completed conclusion blocks a merge and counts as failing.
        assert!(check_run_is_failing(&check_run("completed", Some("failure"))));
        assert!(check_run_is_failing(&check_run("completed", Some("timed_out"))));
        assert!(check_run_is_failing(&check_run("completed", Some("action_required"))));
        // cancelled — GitHub's conclusion for a cancelled/timed-out workflow (issue #52).
        assert!(check_run_is_failing(&check_run("completed", Some("cancelled"))));
        // stale needs a re-run and does not satisfy a required check.
        assert!(check_run_is_failing(&check_run("completed", Some("stale"))));
        // Fail-safe: an unknown/future conclusion counts as failing, not a silent pass.
        assert!(check_run_is_failing(&check_run("completed", Some("some_new_conclusion"))));
        // In-progress runs (no conclusion yet) are pending, not failing.
        assert!(!check_run_is_failing(&check_run("in_progress", None)));
    }

    #[test]
    fn test_pr_status_with_column_draft() {
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
        let with_col = PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe"));
        assert_eq!(with_col.auto_column, "draftPr");
    }

    #[test]
    fn test_pr_status_with_column_own_pr() {
        let pr = PrStatus {
            number: 2,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/open".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("chloe".into()),
            requested_reviewers: vec![],
        };
        let with_col = PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe"));
        assert_eq!(with_col.auto_column, "openPr");
    }

    #[test]
    fn test_pr_status_with_column_needs_review() {
        let pr = PrStatus {
            number: 2,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/review".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("teammate".into()),
            requested_reviewers: vec![],
        };
        let with_col = PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe"));
        assert_eq!(with_col.auto_column, "needsReview");
    }

    #[test]
    fn test_pr_status_with_column_merged() {
        let pr = PrStatus {
            number: 3,
            state: "closed".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: true,
            branch: "feat/done".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("chloe".into()),
            requested_reviewers: vec![],
        };
        let with_col = PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe"));
        assert_eq!(with_col.auto_column, "done");
    }
}
