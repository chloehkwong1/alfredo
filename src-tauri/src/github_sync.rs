use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};
use tokio::time;

use crate::config_manager;
use crate::github_manager::{dedup_reviews, derive_review_decision, determine_column, GithubManager};
use crate::platform::gh_command;
use crate::types::{PrStatus, CheckRun, NativeStackInfo, PrReview, PrComment, KanbanColumn};

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
    /// Repos whose poll succeeded this round — including ones with zero PRs.
    /// The reconcile pass keys repo trust off this, not off PR presence: a
    /// repo whose PRs all aged out of the sync window returns an empty list
    /// yet still needs its stale worktrees reconciled.
    pub succeeded_repos: Vec<String>,
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
    /// Native GitHub Stack membership (public preview). `Some` means this PR
    /// belongs to a server-side stack: Alfredo's override-driven automation
    /// stands down and overrides become display-only for this branch. Carries
    /// the full sibling roster since siblings usually have no local worktree.
    pub native_stack: Option<NativeStackInfo>,
    /// True when the authenticated user is a requested reviewer on someone
    /// else's open PR — drives review-request worktree auto-creation.
    pub review_requested: bool,
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
        // Initial column is computed without review data using determine_column's
        // built-in rules (draft, own PR, review-requested, etc.), which don't require
        // review-fetch enrichment. The column is recomputed in poll_repo only for
        // PRs that pass `should_enrich` AND have an active worktree, where review
        // data may flip the column (e.g., an approved other's PR moves to "Done").
        // Review-requested PRs surface as cards in the NeedsReview column from
        // this initial placement alone — the review_requested rule needs no
        // enrichment to determine the correct column.
        let column = determine_column(Some(pr), github_username, &[]);
        let review_requested = github_username.is_some_and(|user| {
            let is_own = pr.author.as_deref().is_some_and(|a| a.eq_ignore_ascii_case(user));
            pr.state == "open"
                && !is_own
                && pr.requested_reviewers.iter().any(|r| r.eq_ignore_ascii_case(user))
        });
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
            native_stack: pr.native_stack.clone(),
            review_requested,
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
    // Repos whose poll actually returned PR data this round. A repo that 403'd
    // or timed out contributes no PRs to `all_prs`, and `check_merged_parents`
    // treats "no PRs for this repo" as "nothing merged" — feeding it a failed
    // repo would sweep away that repo's valid pending entries as collateral
    // damage of an unrelated rate limit. Only repos in this list may drive that
    // sweep.
    let mut succeeded_repos: Vec<String> = Vec::new();

    for repo_path in &repo_paths {
        match poll_repo(&app_data_dir, repo_path, &active_branches).await {
            Ok(prs) => {
                any_repo_succeeded = true;
                succeeded_repos.push(repo_path.clone());
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
    // Emitted whenever any repo succeeded, even with zero PRs — an empty
    // successful round is exactly the aged-out case the reconcile pass exists
    // for, so skipping the emit would silence it.
    if any_repo_succeeded {
        app_handle
            .emit(
                "github:pr-update",
                &PrUpdatePayload { prs: all_prs.clone(), succeeded_repos: succeeded_repos.clone() },
            )
            .map_err(|e| format!("failed to emit event: {e}"))?;
    }

    // Auto-sync PR base branches for stacked worktrees
    sync_pr_base_branches(&app_data_dir, &repo_paths, &all_prs).await;

    // Task 14: keep the "Stack" navigation section in stacked PR bodies in sync
    sync_pr_stack_sections(&app_data_dir, &repo_paths, &all_prs).await;

    // Refresh the auto-push ownership gate before anything below restacks or
    // dissolves: branches whose PR belongs to someone else must never be
    // lease-pushed as a side effect. Scoped to `succeeded_repos` for the same
    // staleness reason; skipped when the gh user is unknown (no username → no
    // basis to call anything foreign, and stale entries beat none).
    if let Some(me) = resolve_github_username().await {
        crate::stack_manager::update_foreign_pr_branches(&succeeded_repos, &all_prs, &me);
    }

    // Task 11: check for merged parents and auto-clear stack parent config.
    // Scoped to `succeeded_repos`, not `repo_paths` — see the sweep-hazard
    // comment above.
    crate::stack_manager::check_merged_parents(app_handle, &app_data_dir, &succeeded_repos, &all_prs).await;

    // Phase 2: enrich with comments (separate API calls, one PR at a time)
    for repo_path in &repo_paths {
        enrich_repo_with_comments(&mut all_prs, &app_data_dir, repo_path, &active_branches).await;
    }

    // Emit again with comment data populated
    let payload = PrUpdatePayload { prs: all_prs, succeeded_repos: succeeded_repos.clone() };
    if any_repo_succeeded {
        app_handle
            .emit("github:pr-update", &payload)
            .map_err(|e| format!("failed to emit event: {e}"))?;
    }

    // Task 10: detect parent HEAD changes and auto-rebase stacked worktrees.
    // The PR payload rides along so native-stack members can be skipped —
    // which is exactly why this is scoped to `succeeded_repos` like
    // `check_merged_parents` above: a repo whose poll failed contributed no
    // PRs, so its native-member gate would vanish precisely when sync errors.
    crate::stack_manager::check_and_rebase(app_handle, &app_data_dir, &succeeded_repos, &payload.prs).await;

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

/// Last authoritative native-stack map per repo path. `fetch_native_stack_entries`
/// distinguishes "fetch failed" (`None`) from "authoritatively no stacks"
/// (`Some(empty)`); this cache carries the last `Some` across failed polls so
/// automation doesn't forget native membership because of one transient error.
/// Same process-lifetime static pattern as `stack_manager`'s memo maps.
static NATIVE_STACK_CACHE: std::sync::LazyLock<
    std::sync::Mutex<std::collections::HashMap<String, std::collections::HashMap<u64, NativeStackInfo>>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(std::collections::HashMap::new()));

/// Apply the error-vs-empty distinction: an authoritative fetch (`Some`, even
/// empty) updates the cache and wins; a failed fetch (`None`) falls back to the
/// last-known-good map for this repo, or empty when none exists yet.
fn resolve_native_stacks(
    fetched: Option<std::collections::HashMap<u64, NativeStackInfo>>,
    repo_path: &str,
) -> std::collections::HashMap<u64, NativeStackInfo> {
    match fetched {
        Some(map) => {
            if let Ok(mut cache) = NATIVE_STACK_CACHE.lock() {
                cache.insert(repo_path.to_string(), map.clone());
            }
            map
        }
        None => NATIVE_STACK_CACHE
            .lock()
            .ok()
            .and_then(|cache| cache.get(repo_path).cloned())
            .unwrap_or_default(),
    }
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

    // The REST PR sync and the GraphQL native-stack query are independent —
    // join them so the poll doesn't pay a serialized extra round-trip.
    let (prs_result, native_fetch) = tokio::join!(
        manager.sync_prs(&owner, &repo),
        manager.fetch_native_stack_entries(&owner, &repo),
    );
    let mut prs = prs_result.map_err(|e| format!("{e}"))?;

    // Stamp native GitHub Stack membership (GraphQL-only preview field) onto
    // the REST payload before `from_pr` so the flag + sibling roster reach
    // both the frontend `github:pr-update` payload and `check_merged_parents`.
    // Fail-soft for PR sync (a `None` fetch never breaks the poll), but NOT
    // "error means no stacks": a failed fetch falls back to the last-known-good
    // map so one transient 5xx of this preview API can't re-arm every
    // stand-down gate for branches GitHub still owns the restacking of.
    let native_stacks = resolve_native_stacks(native_fetch, repo_path);
    if !native_stacks.is_empty() {
        for pr in prs.iter_mut() {
            pr.native_stack = native_stacks.get(&pr.number).cloned();
        }
    }

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

        let native_members = native_member_branches(all_prs, repo_path);

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

            // Native GitHub Stack members are retargeted server-side by GitHub;
            // fighting that with `gh pr edit --base` would ping-pong the base.
            if native_members.contains(&pr.branch) {
                continue;
            }

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

/// Branch names of this repo's PRs that belong to a native GitHub Stack
/// (public preview). GitHub retargets and rebases upper stack layers
/// server-side on merge, so Alfredo's override-driven automation stands down
/// for these branches — no PR retargeting, no body splice-in, no dissolution
/// rebase. Overrides become display-only; manual actions stay allowed.
pub(crate) fn native_member_branches(
    all_prs: &[PrStatusWithColumn],
    repo_path: &str,
) -> std::collections::HashSet<String> {
    all_prs
        .iter()
        .filter(|p| p.repo_path == repo_path && p.native_stack.is_some())
        .map(|p| p.branch.clone())
        .collect()
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
/// Caches only a successful lookup for the lifetime of the process — a failure
/// (gh not authed yet, transient network) must be retried on the next call,
/// because an unknown username disables the auto-push ownership gate and
/// caching the failure would disable it for the whole session.
pub async fn resolve_github_username() -> Option<String> {
    use tokio::sync::OnceCell;

    static CACHED_USERNAME: OnceCell<String> = OnceCell::const_new();

    CACHED_USERNAME
        .get_or_try_init(|| async {
            gh_command()
                .args(["api", "user", "--jq", ".login"])
                .output()
                .await
                .ok()
                .and_then(|o| {
                    if o.status.success() {
                        String::from_utf8(o.stdout)
                            .ok()
                            .map(|s| s.trim().to_string())
                            .filter(|s| !s.is_empty())
                    } else {
                        None
                    }
                })
                .ok_or(())
        })
        .await
        .ok()
        .cloned()
}

const STACK_START: &str = "<!-- alfredo-stack-start -->";
const STACK_END: &str = "<!-- alfredo-stack-end -->";

/// Render the delimited "Stack" navigation section for a PR body.
/// `chain` is root→tip `(pr_number, branch, merged)`; `current_pr` is
/// highlighted with a bold "← this PR" marker.
fn render_stack_section(chain: &[(u64, String, bool)], current_pr: u64) -> String {
    let mut lines = vec![STACK_START.to_string(), "**Stack** (bottom → top):".to_string()];
    for (number, branch, merged) in chain {
        let suffix = if *merged { " (merged)" } else { "" };
        if *number == current_pr {
            lines.push(format!("- **#{number} `{branch}` ← this PR**"));
        } else {
            lines.push(format!("- #{number} `{branch}`{suffix}"));
        }
    }
    lines.push(STACK_END.to_string());
    lines.join("\n")
}

/// Idempotently replace the delimited stack section within `body` with
/// `section`. Appends (with two leading newlines) when markers are absent;
/// an empty `section` removes the block entirely.
///
/// Corruption-safe: only a *single* well-ordered START/END pair is treated
/// as "replace between markers". Any other marker state — an orphan START,
/// an orphan END, END appearing before START, or duplicated stray markers —
/// is repaired first (marker lines stripped, blank-line runs collapsed),
/// then the fresh section is appended. This converges in one edit and is
/// a fixed point thereafter, so a corrupted body can never grow unboundedly
/// under repeated polling.
fn splice_stack_section(body: &str, section: &str) -> String {
    let starts: Vec<usize> = body.match_indices(STACK_START).map(|(i, _)| i).collect();
    let ends: Vec<usize> = body.match_indices(STACK_END).map(|(i, _)| i).collect();
    match (starts.as_slice(), ends.as_slice()) {
        ([start], [end]) if end > start => {
            let after = &body[end + STACK_END.len()..];
            if section.is_empty() {
                format!("{}{}", body[..*start].trim_end_matches('\n'), after)
            } else {
                format!("{}{}{}", &body[..*start], section, after)
            }
        }
        ([], []) => {
            if section.is_empty() {
                body.to_string()
            } else {
                format!("{}\n\n{}", body.trim_end(), section)
            }
        }
        _ => repair_and_append_stack_section(body, section),
    }
}

/// Strip every line containing either marker string, collapse the resulting
/// blank-line runs down to at most one blank line, then append the fresh
/// section (or leave the block absent if `section` is empty). The text
/// between orphaned markers can't be reliably attributed to "before" or
/// "after" the stack block, so it is left in place — only the marker lines
/// themselves are removed.
fn repair_and_append_stack_section(body: &str, section: &str) -> String {
    let stripped: String = body
        .lines()
        .filter(|line| !line.contains(STACK_START) && !line.contains(STACK_END))
        .collect::<Vec<_>>()
        .join("\n");
    let collapsed = collapse_blank_line_runs(&stripped);
    if section.is_empty() {
        collapsed.trim_end().to_string()
    } else {
        format!("{}\n\n{}", collapsed.trim_end(), section)
    }
}

/// Collapse runs of 3+ consecutive newlines down to 2 (i.e. at most one
/// blank line between text blocks).
fn collapse_blank_line_runs(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut newline_run = 0usize;
    for ch in s.chars() {
        if ch == '\n' {
            newline_run += 1;
            if newline_run <= 2 {
                out.push(ch);
            }
        } else {
            newline_run = 0;
            out.push(ch);
        }
    }
    out
}

/// Assemble a stack chain root→tip as branch names, starting from `pr_branch`.
/// Walks root-ward via `stack_parent_overrides` (worktree name = branch with
/// `/` → `-`), reverses to root-first order, then extends tip-ward by
/// reverse-looking-up children whose parent is the current tip.
///
/// Guards both walks with a visited set so a cycle in `stack_parent_overrides`
/// (e.g. A's parent is B and B's parent is A) breaks immediately instead of
/// duplicating a branch in the returned chain.
///
/// At a fork (one parent, several children) the tip-ward walk follows the
/// lexicographically smallest child branch, mirroring `stackChain.ts`'s
/// `localeCompare` sort so both surfaces render the same linear chain. Picking
/// by `HashMap` iteration order instead would return a different child from
/// poll to poll and rewrite every PR body in the chain each time.
fn assemble_chain(
    stack_parent_overrides: &std::collections::HashMap<String, String>,
    name_to_branch: &std::collections::HashMap<String, String>,
    pr_branch: &str,
) -> Vec<String> {
    let mut visited: std::collections::HashSet<String> = std::collections::HashSet::new();
    visited.insert(pr_branch.to_string());

    // Walk to the root.
    let mut chain_branches: Vec<String> = vec![pr_branch.to_string()];
    let mut cursor = pr_branch.replace('/', "-");
    while let Some(parent_branch) = stack_parent_overrides.get(&cursor) {
        if !visited.insert(parent_branch.clone()) {
            break; // cycle: this branch is already in the chain
        }
        chain_branches.push(parent_branch.clone());
        cursor = parent_branch.replace('/', "-");
    }
    chain_branches.reverse(); // root→…→this PR

    // Extend tip-ward: children whose parent is this PR's branch, transitively.
    // Children whose branch can't be resolved are dropped rather than ending the
    // walk, so an unknown worktree can't hide a resolvable sibling.
    let mut tipward = pr_branch.to_string();
    while let Some(child_branch) = stack_parent_overrides
        .iter()
        .filter(|(_, parent)| **parent == tipward)
        .filter_map(|(child_name, _)| name_to_branch.get(child_name))
        .min()
        .cloned()
    {
        if !visited.insert(child_branch.clone()) {
            break; // cycle: this branch is already in the chain
        }
        chain_branches.push(child_branch.clone());
        tipward = child_branch;
    }
    chain_branches
}

/// True when a PR body still carries an Alfredo stack block — or a stray half
/// of one, which `splice_stack_section` repairs away for free. Drives both the
/// cheap repo-level skip and the per-PR "this section must be removed" branch.
fn has_stack_section(body: Option<&str>) -> bool {
    body.is_some_and(|b| b.contains(STACK_START) || b.contains(STACK_END))
}

/// Keep a delimited "Stack" section in every stacked PR's description in sync,
/// in BOTH directions: PRs that qualify get the current chain spliced in, and
/// PRs that no longer qualify (chain shrank below 2 after merges, or the stack
/// was dissolved entirely) get their stale section spliced out. Only non-merged
/// PRs authored by the current gh user are touched — a merged PR keeps the
/// section it had when it landed.
async fn sync_pr_stack_sections(
    app_data_dir: &std::path::Path,
    repo_paths: &[String],
    all_prs: &[PrStatusWithColumn],
) {
    let Some(me) = resolve_github_username().await else { return };
    for repo_path in repo_paths {
        let Ok(config) = config_manager::load_personal_config(app_data_dir, repo_path).await else {
            continue;
        };
        // A repo with no stack config is only skippable once no PR of its own is
        // still carrying a section: dissolving a stack empties the overrides, and
        // skipping on that alone is what used to strand those sections forever.
        if config.stack_parent_overrides.is_empty()
            && !all_prs
                .iter()
                .any(|p| p.repo_path == *repo_path && !p.merged && has_stack_section(p.body.as_deref()))
        {
            continue;
        }
        let Ok((owner, repo)) = crate::github_manager::resolve_owner_repo(repo_path).await else {
            continue;
        };

        let native_members = native_member_branches(all_prs, repo_path);

        // branch → PR for this repo (merged PRs included: they render as "(merged)").
        let pr_by_branch: std::collections::HashMap<&str, &PrStatusWithColumn> = all_prs
            .iter()
            .filter(|p| p.repo_path == *repo_path)
            .map(|p| (p.branch.as_str(), p))
            .collect();

        // Build each stack chain root→tip as (number, branch, merged), one chain
        // per tip (a worktree that is nobody's parent).
        let parents: std::collections::HashSet<&str> = config
            .stack_parent_overrides
            .values()
            .map(String::as_str)
            .collect();
        let name_to_parent = &config.stack_parent_overrides;
        // worktree name → branch, for resolving tip-ward children in assemble_chain.
        let name_to_branch: std::collections::HashMap<String, String> = all_prs
            .iter()
            .filter(|p| p.repo_path == *repo_path)
            .map(|p| (p.branch.replace('/', "-"), p.branch.clone()))
            .collect();
        // Chain assembly keyed on branches from the PR list: every non-merged PR
        // that is stacked (has a parent) or is a stack root (is someone's parent)
        // gets a section; every other one gets any section it still carries
        // removed.
        for pr in all_prs.iter().filter(|p| p.repo_path == *repo_path && !p.merged) {
            // Author gate first: it applies to removals exactly as it does to
            // writes — never edit someone else's PR body in either direction.
            let is_author = pr.author.as_deref().is_some_and(|a| a.eq_ignore_ascii_case(&me));
            if !is_author {
                continue;
            }

            let wt_name = pr.branch.replace('/', "-");
            let is_stacked = name_to_parent.contains_key(&wt_name);
            let is_parent = parents.contains(pr.branch.as_str());
            // Native GitHub Stack members never qualify for a splice-in — GitHub
            // renders its own stack navigation on those PRs. An empty chain routes
            // any stale Alfredo section into the existing splice-OUT path below
            // (covered by `stale_section_is_removed_and_is_a_fixed_point`).
            let is_native = native_members.contains(&pr.branch);
            let chain: Vec<(u64, String, bool)> = if !is_native && (is_stacked || is_parent) {
                assemble_chain(name_to_parent, &name_to_branch, &pr.branch)
                    .iter()
                    .filter_map(|b| pr_by_branch.get(b.as_str()).map(|p| (p.number, b.clone(), p.merged)))
                    .collect()
            } else {
                Vec::new()
            };

            let body = pr.body.clone().unwrap_or_default();
            // A chain of fewer than 2 members is no stack worth announcing. That
            // is the removal trigger as much as the skip trigger: an empty
            // section makes `splice_stack_section` delete the block. Nothing to
            // add and nothing to delete ⇒ this PR is left alone entirely.
            let section = if chain.len() < 2 {
                if !has_stack_section(Some(&body)) {
                    continue;
                }
                String::new()
            } else {
                render_stack_section(&chain, pr.number)
            };
            let new_body = splice_stack_section(&body, &section);
            if new_body == body {
                continue;
            }
            let output = gh_command()
                .args([
                    "pr", "edit", &pr.number.to_string(),
                    "--repo", &format!("{owner}/{repo}"),
                    "--body", &new_body,
                ])
                .output()
                .await;
            match output {
                Ok(o) if o.status.success() => {}
                Ok(o) => eprintln!(
                    "[github_sync] stack-section edit failed for #{}: {}",
                    pr.number, String::from_utf8_lossy(&o.stderr)
                ),
                Err(e) => eprintln!("[github_sync] stack-section edit spawn failed: {e}"),
            }
        }
    }
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
            native_stack: None,
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
            native_stack: None,
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
            native_stack: None,
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
            native_stack: None,
        };
        let with_col = PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe"));
        assert_eq!(with_col.auto_column, "done");
    }

    #[test]
    fn splice_appends_when_no_markers() {
        let out = splice_stack_section("Original body.", "<!-- alfredo-stack-start -->\nS\n<!-- alfredo-stack-end -->");
        assert!(out.starts_with("Original body."));
        assert!(out.contains("alfredo-stack-start"));
    }

    #[test]
    fn splice_replaces_between_markers_idempotently() {
        let body = "Top\n\n<!-- alfredo-stack-start -->\nOLD\n<!-- alfredo-stack-end -->\n\nBottom";
        let section = "<!-- alfredo-stack-start -->\nNEW\n<!-- alfredo-stack-end -->";
        let out = splice_stack_section(body, section);
        assert!(out.contains("NEW") && !out.contains("OLD"));
        assert!(out.contains("Top") && out.contains("Bottom"));
        assert_eq!(splice_stack_section(&out, section), out);
    }

    #[test]
    fn splice_empty_section_removes_block() {
        let body = "Top\n\n<!-- alfredo-stack-start -->\nOLD\n<!-- alfredo-stack-end -->";
        let out = splice_stack_section(body, "");
        assert!(!out.contains("alfredo-stack"));
        assert!(out.contains("Top"));
    }

    #[test]
    fn render_marks_current_and_merged() {
        let chain = vec![(41, "feat/auth-api".to_string(), true), (42, "feat/auth-ui".to_string(), false)];
        let s = render_stack_section(&chain, 42);
        assert!(s.contains("#41 `feat/auth-api` (merged)"));
        assert!(s.contains("**#42 `feat/auth-ui` ← this PR**"));
        assert!(s.starts_with("<!-- alfredo-stack-start -->"));
        assert!(s.trim_end().ends_with("<!-- alfredo-stack-end -->"));
    }

    /// Critical repro: an orphan END marker (human deleted the START comment)
    /// used to make the append arm fire on every poll — the leftmost END stayed
    /// before the freshly appended START forever, so `new_body != body` held
    /// unboundedly and `gh pr edit` ran without limit. One `splice_stack_section`
    /// call must now repair it into a single valid pair, and a repeat call with
    /// the same section must be a no-op fixed point.
    #[test]
    fn splice_repairs_orphan_end_without_unbounded_growth() {
        let body = "Notes.\n\n<!-- alfredo-stack-end -->\nMore notes.";
        let section = "<!-- alfredo-stack-start -->\nS\n<!-- alfredo-stack-end -->";

        let fixed = splice_stack_section(body, section);
        assert!(fixed.contains("Notes.") && fixed.contains("More notes."));
        assert!(fixed.contains("S"));
        assert_eq!(fixed.matches("alfredo-stack-start").count(), 1);
        assert_eq!(fixed.matches("alfredo-stack-end").count(), 1);

        // Fixed point: a second splice with the same section changes nothing further.
        let fixed_again = splice_stack_section(&fixed, section);
        assert_eq!(fixed_again, fixed);
    }

    #[test]
    fn splice_repairs_orphan_start() {
        let body = "Notes.\n\n<!-- alfredo-stack-start -->\nOLD\nMore notes.";
        let section = "<!-- alfredo-stack-start -->\nS\n<!-- alfredo-stack-end -->";

        let fixed = splice_stack_section(body, section);
        assert!(fixed.contains("Notes.") && fixed.contains("More notes."));
        assert_eq!(fixed.matches("alfredo-stack-start").count(), 1);
        assert_eq!(fixed.matches("alfredo-stack-end").count(), 1);

        let fixed_again = splice_stack_section(&fixed, section);
        assert_eq!(fixed_again, fixed);
    }

    #[test]
    fn splice_repairs_end_before_start() {
        let body = "<!-- alfredo-stack-end -->\nNotes.\n<!-- alfredo-stack-start -->\nOLD";
        let section = "<!-- alfredo-stack-start -->\nS\n<!-- alfredo-stack-end -->";

        let fixed = splice_stack_section(body, section);
        assert!(fixed.contains("Notes."));
        assert_eq!(fixed.matches("alfredo-stack-start").count(), 1);
        assert_eq!(fixed.matches("alfredo-stack-end").count(), 1);

        let fixed_again = splice_stack_section(&fixed, section);
        assert_eq!(fixed_again, fixed);
    }

    fn branch_map(pairs: &[(&str, &str)]) -> std::collections::HashMap<String, String> {
        pairs.iter().map(|(a, b)| ((*a).to_string(), (*b).to_string())).collect()
    }

    #[test]
    fn assemble_chain_walks_root_ward_and_tip_ward() {
        let overrides = branch_map(&[("feat-b", "feat/a"), ("feat-c", "feat/b")]);
        let name_to_branch = branch_map(&[("feat-a", "feat/a"), ("feat-b", "feat/b"), ("feat-c", "feat/c")]);
        let chain = assemble_chain(&overrides, &name_to_branch, "feat/b");
        assert_eq!(chain, vec!["feat/a".to_string(), "feat/b".to_string(), "feat/c".to_string()]);
    }

    /// A fork (two children of the same parent) must resolve to the same linear
    /// chain on every call: `HashMap` iteration order used to decide it, which
    /// rewrote every PR body in the chain from poll to poll. Lexicographically
    /// smallest child wins, mirroring `stackChain.ts`'s sort.
    #[test]
    fn assemble_chain_picks_smallest_child_at_a_fork_deterministically() {
        let name_to_branch =
            branch_map(&[("feat-a", "feat/a"), ("feat-x", "feat/x"), ("feat-y", "feat/y")]);
        let expected = vec!["feat/a".to_string(), "feat/x".to_string()];
        for _ in 0..32 {
            // Rebuilt (not cloned) each iteration: a clone reuses the original's
            // hasher state, so only a fresh map exercises a fresh iteration order.
            let overrides = branch_map(&[("feat-y", "feat/a"), ("feat-x", "feat/a")]);
            assert_eq!(assemble_chain(&overrides, &name_to_branch, "feat/a"), expected);
        }
    }

    /// The walk keeps going past a fork: smallest child at the fork, then that
    /// child's own child, all still deterministic.
    #[test]
    fn assemble_chain_continues_past_a_fork() {
        let name_to_branch = branch_map(&[
            ("feat-a", "feat/a"),
            ("feat-b", "feat/b"),
            ("feat-c", "feat/c"),
            ("feat-d", "feat/d"),
        ]);
        let expected = vec!["feat/a".to_string(), "feat/b".to_string(), "feat/d".to_string()];
        for _ in 0..32 {
            let overrides =
                branch_map(&[("feat-c", "feat/a"), ("feat-b", "feat/a"), ("feat-d", "feat/b")]);
            assert_eq!(assemble_chain(&overrides, &name_to_branch, "feat/a"), expected);
        }
    }

    #[test]
    fn has_stack_section_detects_full_and_orphaned_blocks() {
        assert!(has_stack_section(Some(
            "Top\n<!-- alfredo-stack-start -->\nS\n<!-- alfredo-stack-end -->"
        )));
        // Orphan halves count: splice repairs them away with an empty section.
        assert!(has_stack_section(Some("Top\n<!-- alfredo-stack-end -->")));
        assert!(has_stack_section(Some("<!-- alfredo-stack-start -->\nS")));
        assert!(!has_stack_section(Some("Just a normal body.")));
        assert!(!has_stack_section(None));
    }

    /// A PR that dropped out of its stack must have the stale block spliced out
    /// — the removal branch feeds `splice_stack_section` an empty section.
    #[test]
    fn stale_section_is_removed_and_is_a_fixed_point() {
        let body = "Top\n\n<!-- alfredo-stack-start -->\n**Stack** (bottom → top):\n- #1 `feat/a`\n<!-- alfredo-stack-end -->\n\nBottom";
        assert!(has_stack_section(Some(body)));
        let removed = splice_stack_section(body, "");
        assert!(!has_stack_section(Some(&removed)));
        assert!(removed.contains("Top") && removed.contains("Bottom"));
        // The no-op guard then keeps later polls from re-editing it.
        assert_eq!(splice_stack_section(&removed, ""), removed);
    }

    /// Minimal native-stack fixture: only membership (`Some` vs `None`) matters
    /// to the stand-down gates.
    fn native_stack_info() -> crate::types::NativeStackInfo {
        crate::types::NativeStackInfo {
            id: "PRS_1".into(),
            number: 7,
            position: 2,
            size: 2,
            members: Vec::new(),
        }
    }

    fn pr_with_native(number: u64, branch: &str, repo_path: &str, native: bool) -> PrStatusWithColumn {
        let pr = PrStatus {
            number,
            state: "open".into(),
            title: "test".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: branch.into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("chloe".into()),
            requested_reviewers: vec![],
            native_stack: native.then(native_stack_info),
        };
        PrStatusWithColumn::from_pr(&pr, repo_path, Some("chloe"))
    }

    /// The stand-down guard predicate: only PRs of the requested repo with a
    /// `native_stack` entry qualify; everything else stays under Alfredo's
    /// automation.
    #[test]
    fn native_member_branches_filters_by_repo_and_membership() {
        let prs = vec![
            pr_with_native(1, "feat/native", "/repo/a", true),
            pr_with_native(2, "feat/plain", "/repo/a", false),
            pr_with_native(3, "feat/other-repo", "/repo/b", true),
        ];

        let members = native_member_branches(&prs, "/repo/a");
        assert_eq!(members.len(), 1);
        assert!(members.contains("feat/native"));
        assert!(!members.contains("feat/plain"));
        assert!(!members.contains("feat/other-repo"), "other repos' PRs must not leak in");

        assert!(native_member_branches(&prs, "/repo/c").is_empty());
    }

    // Error ≠ empty: `None` (fetch/shape failure) must fall back to the last
    // authoritative map, while `Some(empty)` is authoritative and overwrites
    // it — a transient 5xx must not re-arm the stand-down gates, but a real
    // stack dissolution must not be shadowed by a stale cache either.
    #[test]
    fn resolve_native_stacks_distinguishes_fetch_failure_from_authoritative_empty() {
        // Distinct key from any other test — the cache is process-global.
        let repo = "/tmp/alfredo-test-native-cache";

        // No cache yet: a failed fetch degrades to empty (old behaviour).
        assert!(resolve_native_stacks(None, repo).is_empty());

        let mut map = std::collections::HashMap::new();
        map.insert(7u64, native_stack_info());
        assert_eq!(resolve_native_stacks(Some(map.clone()), repo).len(), 1);

        // Failed fetch: last-known-good map survives.
        let fallback = resolve_native_stacks(None, repo);
        assert_eq!(fallback.len(), 1);
        assert!(fallback.contains_key(&7));

        // Authoritatively empty: cache is overwritten, not preserved.
        assert!(resolve_native_stacks(Some(std::collections::HashMap::new()), repo).is_empty());
        assert!(resolve_native_stacks(None, repo).is_empty());
    }

    #[test]
    fn assemble_chain_breaks_cycle_without_duplicating_members() {
        // 2-cycle: feat-a's parent is feat/b, feat-b's parent is feat/a.
        let overrides = branch_map(&[("feat-a", "feat/b"), ("feat-b", "feat/a")]);
        let name_to_branch = branch_map(&[("feat-a", "feat/a"), ("feat-b", "feat/b")]);
        let chain = assemble_chain(&overrides, &name_to_branch, "feat/a");

        let mut seen = std::collections::HashSet::new();
        assert!(chain.iter().all(|b| seen.insert(b.clone())), "chain has duplicate members: {chain:?}");
    }

    #[test]
    fn test_from_pr_flags_review_requested() {
        let mut pr = PrStatus {
            number: 7,
            state: "open".into(),
            title: "teammate's PR".into(),
            url: String::new(),
            draft: false,
            merged: false,
            branch: "feat/theirs".into(),
            base_branch: None,
            merged_at: None,
            head_sha: None,
            merge_commit_sha: None,
            body: None,
            updated_at: None,
            author: Some("teammate".into()),
            requested_reviewers: vec!["Chloe".into()], // case-insensitive match
            native_stack: None,
        };
        let with_col = PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe"));
        assert!(with_col.review_requested);

        // Own PR → never flagged, even if GitHub somehow lists me.
        pr.author = Some("chloe".into());
        assert!(!PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe")).review_requested);

        // Closed PR → not flagged.
        pr.author = Some("teammate".into());
        pr.state = "closed".into();
        assert!(!PrStatusWithColumn::from_pr(&pr, "/test/repo", Some("chloe")).review_requested);

        // Unknown username → not flagged.
        pr.state = "open".into();
        assert!(!PrStatusWithColumn::from_pr(&pr, "/test/repo", None).review_requested);
    }
}
