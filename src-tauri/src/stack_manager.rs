use std::collections::HashMap;
use std::path::Path;
use std::sync::{LazyLock, Mutex};

use tauri::{AppHandle, Emitter};

use crate::config_manager;
use crate::git_manager;
use crate::git_manager::git_command;
use crate::types::{StackRebaseStatus};

// ── Event payloads ───────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StackStatusPayload {
    worktree_name: String,
    status: StackRebaseStatus,
}

// ── In-process memos ─────────────────────────────────────────────
//
// Both maps are keyed `<repo_path>::<worktree_name>` and deliberately live only
// for the process lifetime: a restart is cheap and retrying once after one is
// the desired behaviour.

/// Worktree → the parent tip that last conflicted for it. The background poll
/// consults this to avoid re-running a doomed rebase (and its status churn)
/// every 60s while the user has not touched anything. Any manual restack, or
/// the parent moving to a new tip, invalidates the entry.
static CONFLICT_MEMO: LazyLock<Mutex<HashMap<String, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Worktree → a status that must survive `compute_stack_statuses` recomputing
/// UpToDate/Behind later in the same poll. `PushFailed` and `SkippedDirty` are
/// both facts about the last restack attempt, not about commit counts, so the
/// recomputed status would otherwise silently erase them within milliseconds.
static STICKY_STATUS: LazyLock<Mutex<HashMap<String, StackRebaseStatus>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// The single key builder for both maps (and therefore for `forget_stack_memos`).
/// The repo path is canonicalized so `/Users/x/repo`, `/Users/x/repo/` and a
/// symlinked route to the same directory can't split one worktree across two
/// entries — which would strand a memo nothing ever clears. Canonicalization
/// failure (path deleted mid-flight) falls back to the raw string: a slightly
/// worse key beats losing the entry.
fn memo_key(repo_path: &str, worktree_name: &str) -> String {
    let repo = std::fs::canonicalize(repo_path)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| repo_path.to_string());
    format!("{repo}::{worktree_name}")
}

/// True when `parent_tip` is exactly the tip that already conflicted for this
/// worktree. A different tip means the situation changed: the entry is dropped
/// and the caller retries.
fn conflict_memo_should_skip(repo_path: &str, worktree_name: &str, parent_tip: &str) -> bool {
    let key = memo_key(repo_path, worktree_name);
    let Ok(mut memo) = CONFLICT_MEMO.lock() else { return false };
    match memo.get(&key) {
        Some(tip) if tip == parent_tip => true,
        Some(_) => {
            memo.remove(&key);
            false
        }
        None => false,
    }
}

fn record_conflict(repo_path: &str, worktree_name: &str, parent_tip: &str) {
    if let Ok(mut memo) = CONFLICT_MEMO.lock() {
        memo.insert(memo_key(repo_path, worktree_name), parent_tip.to_string());
    }
}

fn clear_conflict_memo(repo_path: &str, worktree_name: &str) {
    if let Ok(mut memo) = CONFLICT_MEMO.lock() {
        memo.remove(&memo_key(repo_path, worktree_name));
    }
}

fn set_sticky_status(repo_path: &str, worktree_name: &str, status: StackRebaseStatus) {
    if let Ok(mut map) = STICKY_STATUS.lock() {
        map.insert(memo_key(repo_path, worktree_name), status);
    }
}

fn clear_sticky_status(repo_path: &str, worktree_name: &str) {
    if let Ok(mut map) = STICKY_STATUS.lock() {
        map.remove(&memo_key(repo_path, worktree_name));
    }
}

fn sticky_status(repo_path: &str, worktree_name: &str) -> Option<StackRebaseStatus> {
    STICKY_STATUS.lock().ok()?.get(&memo_key(repo_path, worktree_name)).cloned()
}

/// Drop everything this module remembers about a worktree. Called from every
/// path that dissolves or detaches a stack: with no `stack_parent_overrides`
/// entry left, nothing would ever clear these again, and a worktree that
/// re-joins a stack (or a new worktree reusing the name) would inherit a
/// conflict badge and a rebase suppression it never earned.
pub fn forget_stack_memos(repo_path: &str, worktree_name: &str) {
    clear_conflict_memo(repo_path, worktree_name);
    clear_sticky_status(repo_path, worktree_name);
}

// ── Busy-agent gating ────────────────────────────────────────────
//
// Every path that rewrites a worktree's history — restack, merged-parent
// dissolution, stale-parent dissolution — consults the Claude registry first.
// The snapshot is taken lazily and reused for a whole poll, so a poll that
// touches no stacked repo pays nothing.

/// Populate `slot` on first use. An unavailable registry (no `claude` binary,
/// timeout, parse failure) becomes an empty map rather than an error: gating
/// degrades open to the dirty-tree checks the restack paths already do, because
/// a missing CLI must not block restacks forever.
async fn ensure_registry(slot: &mut Option<HashMap<String, String>>) {
    if slot.is_none() {
        *slot = Some(match crate::commands::claude_registry::poll_claude_registry().await {
            Ok(entries) => entries.into_iter().map(|e| (e.cwd, e.status)).collect(),
            Err(_) => HashMap::new(),
        });
    }
}

/// Whether an agent is actively working in this checkout. Unknown ⇒ not busy.
fn path_is_busy(registry: Option<&HashMap<String, String>>, path: &str) -> bool {
    registry.and_then(|r| r.get(path)).map(String::as_str) == Some("busy")
}

/// A worktree's checkout path from a `checkout_paths` map, matched on dir name
/// (worktree names are the branch with `/` → `-`).
fn checkout_path_for<'a>(
    checkouts: &'a HashMap<String, String>,
    worktree_name: &str,
) -> Option<&'a String> {
    checkouts.values().find(|path| {
        std::path::Path::new(path).file_name().and_then(|n| n.to_str()) == Some(worktree_name)
    })
}

// ── Public entry points ──────────────────────────────────────────

/// Called at the end of each sync poll. Baseline-tracked (no in-memory SHA
/// cache — restart-safe): "parent moved" is decided per child inside
/// `restack_child` by comparing its persisted baseline against the parent's
/// current tip.
pub async fn check_and_rebase(app_handle: &AppHandle, app_data_dir: &Path, repo_paths: &[String]) {
    // One registry snapshot per poll, fetched lazily on first actual need (most
    // polls touch zero stacked repos, so the common case pays no subprocess
    // spawn). Unavailable registry (no claude binary, timeout) degrades to
    // clean-tree-only gating — restacks must not be blocked forever by a
    // missing CLI.
    let mut registry: Option<HashMap<String, String>> = None;

    for repo_path in repo_paths {
        // Task 13: detect stale parents (merged into main) first. Shares this
        // poll's registry slot so the two paths never poll `claude` twice.
        if let Err(e) =
            detect_stale_parents(app_handle, app_data_dir, repo_path, &mut registry).await
        {
            eprintln!("[stack_manager] detect_stale_parents failed for {repo_path}: {e}");
        }

        let config = match config_manager::load_personal_config(app_data_dir, repo_path).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[stack_manager] load_personal_config failed for {repo_path}: {e}");
                continue;
            }
        };
        if config.stack_parent_overrides.is_empty() {
            continue;
        }

        // First repo with stacked worktrees pays for the snapshot; the rest reuse
        // it. Repos with no stack config returned above without spawning anything.
        ensure_registry(&mut registry).await;
        let agent_busy = |path: &str| path_is_busy(registry.as_ref(), path);

        let checkouts = checkout_paths(repo_path).await;
        let name_to_branch: HashMap<String, String> = checkouts
            .iter()
            .filter_map(|(branch, path)| {
                std::path::Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| (n.to_string(), branch.clone()))
            })
            .collect();
        // Worktree dir name → its checkout path, the same dir-name match
        // `restack_child` uses to find a child's own tree.
        let name_to_path: HashMap<String, String> = checkouts
            .values()
            .filter_map(|path| {
                std::path::Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|n| (n.to_string(), path.clone()))
            })
            .collect();

        // Full-repo dependency order; a mid-cascade parent's new tip is picked up
        // because restack_child re-resolves the parent tip per child.
        for child_name in restack_order(&config.stack_parent_overrides, &name_to_branch) {
            let Some(parent_branch) = config.stack_parent_overrides.get(&child_name) else {
                continue;
            };
            // Self-reference guard (historically corrupted data).
            if child_name == parent_branch.replace('/', "-") {
                continue;
            }

            // Quiet gate: skip while the parent's checkout is dirty or its agent is busy.
            if let Some(parent_path) = checkouts.get(parent_branch) {
                if agent_busy(parent_path) {
                    continue;
                }
                if worktree_is_dirty(parent_path, false).await {
                    continue;
                }
            }

            // Same gate for the child itself: rewriting history under a running
            // agent is exactly as disruptive as doing it under a running parent.
            // (Its dirty-tree case is already handled inside `run_restack`.)
            if let Some(child_path) = name_to_path.get(&child_name) {
                if agent_busy(child_path) {
                    continue;
                }
            }

            // (restack_child no-ops with UpToDate when baseline == parent tip.)
            let _ = restack_child_inner(app_handle, app_data_dir, repo_path, &child_name, true).await;
        }
    }
}

/// Called after Phase 1 emit. Checks if any merged PR's branch is a stack parent,
/// and if so rebases children onto the default branch and clears the stack parent.
pub async fn check_merged_parents(
    app_handle: &AppHandle,
    app_data_dir: &Path,
    repo_paths: &[String],
    prs: &[crate::github_sync::PrStatusWithColumn],
) {
    // Same lazy-once semantics as `check_and_rebase`, scoped to this call: only a
    // repo that actually has a merged parent to dissolve pays for the snapshot.
    let mut registry: Option<HashMap<String, String>> = None;

    for repo_path in repo_paths {
        let config = match config_manager::load_personal_config(app_data_dir, repo_path).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[stack_manager] load_personal_config failed for {repo_path}: {e}");
                continue;
            }
        };

        if config.stack_parent_overrides.is_empty() {
            continue;
        }

        // Find merged PRs that belong to this repo
        let merged_branches: Vec<String> = prs
            .iter()
            .filter(|pr| pr.repo_path == *repo_path && pr.merged)
            .map(|pr| pr.branch.clone())
            .collect();

        if merged_branches.is_empty() {
            continue;
        }

        // Find entries in stack_parent_overrides whose parent value is a merged branch
        let affected: Vec<(String, String)> = config
            .stack_parent_overrides
            .iter()
            .filter(|(_, parent)| merged_branches.contains(parent))
            .map(|(child, parent)| (child.clone(), parent.clone()))
            .collect();

        if affected.is_empty() {
            continue;
        }

        // Resolve the default branch once for this repo before iterating children
        let default_remote = tokio::task::spawn_blocking({
            let rp = repo_path.clone();
            move || git_manager::resolve_default_remote_branch(&rp)
        })
        .await
        .unwrap_or_else(|_| "origin/main".to_string());
        let default_short = default_remote.strip_prefix("origin/").unwrap_or(&default_remote).to_string();

        // Resolve owner/repo once for PR base updates
        let owner_repo = match crate::github_manager::resolve_owner_repo(repo_path).await {
            Ok(pair) => Some(pair),
            Err(e) => {
                eprintln!("[stack_manager] could not resolve owner/repo for {repo_path}: {e}");
                None
            }
        };

        // A dissolution is pending for this repo, so the snapshot is now worth
        // its subprocess. Also needed for the busy gate below.
        ensure_registry(&mut registry).await;
        let checkouts = checkout_paths(repo_path).await;

        let mut dissolved: Vec<String> = Vec::new();
        for (child_name, _merged_parent) in &affected {
            // Dissolving rebases and force-pushes the child, so it gets the same
            // quiet gate as a routine restack: never rewrite history under a
            // running agent. The parent stays merged, so this retries next poll.
            if let Some(child_path) = checkout_path_for(&checkouts, child_name) {
                if path_is_busy(registry.as_ref(), child_path) {
                    eprintln!(
                        "[stack_manager] merged-parent restack deferred for {child_name}: agent busy"
                    );
                    continue;
                }
            }

            // `restack_child` resolves its parent from `stack_parent_overrides`,
            // which at this point still holds the *merged* branch (cleared only
            // below) — so it can't be reused here. `restack_onto_default`
            // targets `default_short` directly instead.
            let outcome = restack_onto_default(
                app_handle, app_data_dir, repo_path, child_name, &default_short,
            ).await;

            match outcome {
                // Rebased: the child now sits on the default branch, so the stack
                // relationship really is over.
                Ok(RestackOutcome::Rebased) => {}
                // Nothing was rebased — the child is still stacked on the merged
                // parent's commits. Retargeting the PR and dropping the config
                // here would strand it with a base it never got rebased onto.
                // The parent stays merged, so this child reappears in `affected`
                // on the next poll and dissolves once the tree is clean.
                Ok(RestackOutcome::SkippedDirty) => {
                    eprintln!(
                        "[stack_manager] merged-parent restack deferred for {child_name}: worktree dirty"
                    );
                    continue;
                }
                // Same reasoning: git was never asked to rebase (missing
                // worktree, unresolvable default tip, config read failure), so
                // nothing moved and nothing may be dissolved.
                Err(DissolveFailure::NotAttempted(e)) => {
                    eprintln!(
                        "[stack_manager] merged-parent restack deferred for {child_name}: {e}"
                    );
                    continue;
                }
                // A rebase was attempted and hit conflicts (already aborted).
                // Deliberate: retarget + dissolve anyway so the child isn't left
                // pointing at a merged branch. Recovery is manual.
                Err(DissolveFailure::Conflicted(e)) => {
                    eprintln!("[stack_manager] merged-parent restack failed for {child_name}: {e}");
                }
            }

            // Update the child's PR base branch to the default branch
            if let Some((ref owner, ref repo)) = owner_repo {
                if let Some(child_pr) = prs.iter().find(|p| {
                    p.repo_path == *repo_path
                        && !p.merged
                        && p.branch.replace('/', "-") == *child_name
                }) {
                    eprintln!(
                        "[stack_manager] parent merged — updating PR #{} base to {default_short}",
                        child_pr.number
                    );
                    if let Err(e) = crate::github_sync::update_pr_base_branch(
                        owner, repo, child_pr.number, &default_short,
                    ).await {
                        eprintln!("[stack_manager] failed to update PR base: {e}");
                    }
                }
            }

            // Emit parent-merged event
            let _ = app_handle.emit("stack:parent-merged", child_name.clone());

            // The stack relationship is dissolved now that the child sits on the
            // default branch; the config write itself is batched below.
            dissolved.push(child_name.clone());
        }

        if dissolved.is_empty() {
            continue;
        }

        // Reload rather than save the snapshot taken at the top of this repo's
        // iteration: each `restack_onto_default` above ran a rebase + push
        // (seconds) and wrote config itself, so the stale copy would clobber any
        // baseline, port claim or column change that landed meanwhile. Same
        // pattern as `detect_stale_parents`/`restack_child_inner`.
        let mut config = match config_manager::load_personal_config(app_data_dir, repo_path).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[stack_manager] reload before clearing merged parents failed for {repo_path}: {e}");
                continue;
            }
        };
        for child_name in &dissolved {
            config_manager::clear_stack_entry(&mut config, child_name);
            forget_stack_memos(repo_path, child_name);
        }
        if let Err(e) = config_manager::save_config(app_data_dir, repo_path, &config).await {
            eprintln!("[stack_manager] failed to save config after clearing merged parents: {e}");
        }
    }
}

/// Called at the end of each poll. Computes commits-behind for all stacked worktrees
/// and emits `stack:status-update` events.
///
/// Runs immediately after `check_and_rebase` in the same poll, so a commit-count
/// status would overwrite whatever that just reported. Statuses describing the
/// last *attempt* (`PushFailed`, `SkippedDirty`) are therefore re-emitted from
/// the sticky map instead of the computed one until a later attempt clears them.
pub async fn compute_stack_statuses(app_handle: &AppHandle, app_data_dir: &Path, repo_paths: &[String]) {
    for repo_path in repo_paths {
        let config = match config_manager::load_personal_config(app_data_dir, repo_path).await {
            Ok(c) => c,
            Err(_) => continue,
        };

        if config.stack_parent_overrides.is_empty() {
            continue;
        }

        for (worktree_name, parent_branch) in &config.stack_parent_overrides {
            let worktree_path = resolve_worktree_path(repo_path, worktree_name, &config);

            if !std::path::Path::new(&worktree_path).exists() {
                continue;
            }

            let status = match sticky_status(repo_path, worktree_name) {
                Some(sticky) => sticky,
                None => {
                    let wt_path = worktree_path.clone();
                    let parent = parent_branch.clone();
                    let count = tokio::task::spawn_blocking(move || {
                        git_manager::commits_behind(&wt_path, Some(&parent))
                    })
                    .await
                    .ok()
                    .and_then(std::result::Result::ok);

                    match count {
                        Some(0) => StackRebaseStatus::UpToDate,
                        Some(n) => StackRebaseStatus::Behind { count: n },
                        None => continue,
                    }
                }
            };

            let payload = StackStatusPayload {
                worktree_name: worktree_name.clone(),
                status,
            };
            let _ = app_handle.emit("stack:status-update", payload);
        }
    }
}

/// Run the full dependency-ordered cascade for one repo (used by the
/// restack_stack command; same body as the per-repo loop in check_and_rebase
/// but without the quiet gate — the user explicitly asked).
pub async fn restack_repo(app_handle: &AppHandle, app_data_dir: &Path, repo_path: &str) -> Result<(), String> {
    let config = config_manager::load_personal_config(app_data_dir, repo_path)
        .await
        .map_err(|e| e.to_string())?;
    if config.stack_parent_overrides.is_empty() {
        return Ok(());
    }
    let checkouts = checkout_paths(repo_path).await;
    let name_to_branch: HashMap<String, String> = checkouts
        .iter()
        .filter_map(|(branch, path)| {
            std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| (n.to_string(), branch.clone()))
        })
        .collect();
    let mut first_err: Option<String> = None;
    for child in restack_order(&config.stack_parent_overrides, &name_to_branch) {
        if let Err(e) = restack_child(app_handle, app_data_dir, repo_path, &child).await {
            first_err.get_or_insert(e);
        }
    }
    match first_err {
        None => Ok(()),
        Some(e) => Err(e),
    }
}

// ── Task 13 ──────────────────────────────────────────────────────

/// Stack parents that look merged into the default branch by manual rebase/merge
/// — the case the PR-merge path can't see because there's no merged PR event.
///
/// This is a heuristic, and it dissolves stacks, so it is deliberately narrow.
/// A parent qualifies only when all three hold:
///
/// 1. **No local checkout.** A parent with a live worktree means the user is
///    still working there, whatever the SHAs say. This is the backstop for the
///    residual of the zero-commit case (a parent pushed before any commits is an
///    ancestor of main by definition) and for any future SHA-shaped surprise.
///    Genuinely merged parents that still have a worktree open are handled by
///    `check_merged_parents`, which has a real merged-PR signal rather than a guess.
/// 2. **A remote-tracking ref exists.** Never pushed ⇒ cannot have been merged.
/// 3. **That ref is an ancestor of the default branch.**
///
/// Fails closed on an empty `checkouts` map: any repo reaching here has at least
/// its own main checkout, so empty means `git worktree list` failed — and taking
/// condition 1 as "no parent has a checkout" would silently turn the guard off
/// on a path that dissolves stacks. Nothing is stale until we can see again.
async fn stale_parent_branches(
    repo_path: &str,
    overrides: &HashMap<String, String>,
    checkouts: &HashMap<String, String>,
) -> Vec<String> {
    if checkouts.is_empty() {
        eprintln!(
            "[stack_manager] skipping stale-parent scan for {repo_path}: no checkouts listed \
             (git worktree list failed?) — the liveness guard would be blind"
        );
        return Vec::new();
    }

    let default_branch = tokio::task::spawn_blocking({
        let rp = repo_path.to_string();
        move || git_manager::resolve_default_remote_branch(&rp)
    })
    .await
    .unwrap_or_else(|_| "origin/main".to_string());

    let unique_parents: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        overrides.values().filter(|p| seen.insert((*p).clone())).cloned().collect()
    };

    let mut stale: Vec<String> = Vec::new();
    for parent_branch in &unique_parents {
        if checkouts.contains_key(parent_branch) {
            continue;
        }
        // Remote-tracking resolution ONLY here — deliberately not the local-first
        // `branch_tip` the restack paths use, whose local tip for a zero-commit
        // parent is still the default branch's tip.
        let Some(ancestor_sha) = remote_branch_tip(repo_path, parent_branch).await else { continue };

        // `git merge-base --is-ancestor <ancestor> <descendant>` exits 0 if ancestor, 1 if not
        let result = git_command()
            .args(["merge-base", "--is-ancestor", &ancestor_sha, &default_branch])
            .current_dir(repo_path)
            .output()
            .await;

        if result.map(|o| o.status.success()).unwrap_or(false) {
            stale.push(parent_branch.clone());
        }
    }
    stale
}

/// Dissolve stacks whose parent was merged into the default branch outside the
/// PR-merge path. Mirrors `check_merged_parents`: each affected child is rebased
/// onto the default branch first, and the stack config is cleared only when that
/// rebase actually ran. Dropping the config without moving the child would strand
/// it on a merged parent's commits with no relationship left to retry.
///
/// PR retargeting is deliberately NOT done here — this path has no PR signal;
/// that stays `check_merged_parents`' job.
pub async fn detect_stale_parents(
    app_handle: &AppHandle,
    app_data_dir: &Path,
    repo_path: &str,
    registry: &mut Option<HashMap<String, String>>,
) -> Result<(), String> {
    let config = config_manager::load_personal_config(app_data_dir, repo_path)
        .await
        .map_err(|e| e.to_string())?;

    if config.stack_parent_overrides.is_empty() {
        return Ok(());
    }

    let checkouts = checkout_paths(repo_path).await;
    let stale_parents =
        stale_parent_branches(repo_path, &config.stack_parent_overrides, &checkouts).await;
    if stale_parents.is_empty() {
        return Ok(());
    }

    let default_remote = tokio::task::spawn_blocking({
        let rp = repo_path.to_string();
        move || git_manager::resolve_default_remote_branch(&rp)
    })
    .await
    .unwrap_or_else(|_| "origin/main".to_string());
    let default_short =
        default_remote.strip_prefix("origin/").unwrap_or(&default_remote).to_string();

    let affected: Vec<String> = config
        .stack_parent_overrides
        .iter()
        .filter(|(_, parent)| stale_parents.contains(parent))
        .map(|(child, _)| child.clone())
        .collect();

    // Only now that a dissolution is actually pending is the registry worth
    // polling — the vast majority of calls return above.
    ensure_registry(registry).await;

    let mut dissolved: Vec<String> = Vec::new();
    for child_name in &affected {
        // Dissolving runs a rebase and a force-push, so it gets the same quiet
        // gate as a routine restack: never rewrite history under a running agent.
        if let Some(child_path) = checkout_path_for(&checkouts, child_name) {
            if path_is_busy(registry.as_ref(), child_path) {
                eprintln!(
                    "[stack_manager] stale-parent restack deferred for {child_name}: agent busy"
                );
                continue;
            }
        }

        match restack_onto_default(app_handle, app_data_dir, repo_path, child_name, &default_short)
            .await
        {
            // Child sits on the default branch now — the relationship is over.
            Ok(RestackOutcome::Rebased) => {}
            // Nothing moved. The parent stays stale, so this retries next poll.
            Ok(RestackOutcome::SkippedDirty) => {
                eprintln!(
                    "[stack_manager] stale-parent restack deferred for {child_name}: worktree dirty"
                );
                continue;
            }
            Err(DissolveFailure::NotAttempted(e)) => {
                eprintln!("[stack_manager] stale-parent restack deferred for {child_name}: {e}");
                continue;
            }
            // Rebase ran and conflicted (already aborted). Same deliberate ruling
            // as the merged-parent path: dissolve anyway rather than leave the
            // child pointing at a branch that's already in main. Recovery is manual.
            Err(DissolveFailure::Conflicted(e)) => {
                eprintln!("[stack_manager] stale-parent restack failed for {child_name}: {e}");
            }
        }
        dissolved.push(child_name.clone());
    }

    if dissolved.is_empty() {
        return Ok(());
    }

    // Reload: the restacks above each took seconds and wrote config themselves.
    let mut config = config_manager::load_personal_config(app_data_dir, repo_path)
        .await
        .map_err(|e| e.to_string())?;
    for child in &dissolved {
        config_manager::clear_stack_entry(&mut config, child);
        forget_stack_memos(repo_path, child);
    }
    config_manager::save_config(app_data_dir, repo_path, &config)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────

/// Tip SHA for a branch: local ref first (works for unpushed parents; the local
/// tip is what children actually stack on), remote-tracking ref as fallback.
///
/// With no local ref the branch only exists on the remote (a parent pushed from
/// another machine, or a worktree that was removed locally), and whatever
/// `origin/<branch>` holds may be arbitrarily old — the old `rebase_onto` path
/// fetched before rebasing, so restacking against a stale ref would silently
/// no-op as UpToDate. Fetch first in that case only; a present local ref is
/// authoritative and costs no network.
async fn branch_tip(repo_path: &str, branch: &str) -> Option<String> {
    if let Some(sha) = rev_parse(repo_path, &format!("refs/heads/{branch}")).await {
        return Some(sha);
    }

    // Best-effort: offline/auth-broken remotes must not block the restack, they
    // just leave the cached ref in place. `kill_on_drop` so a hung fetch is
    // reaped when the timeout fires rather than orphaning a `git fetch` child.
    let fetch = git_command()
        .args(["fetch", "origin", branch, "--quiet", "--no-auto-maintenance"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .current_dir(repo_path)
        .kill_on_drop(true)
        .output();
    let _ = tokio::time::timeout(std::time::Duration::from_secs(10), fetch).await;

    rev_parse(repo_path, &format!("origin/{branch}")).await
}

/// Tip SHA of a branch's remote-tracking ref, without touching the local ref.
async fn remote_branch_tip(repo_path: &str, branch: &str) -> Option<String> {
    rev_parse(repo_path, &format!("origin/{branch}")).await
}

async fn rev_parse(repo_path: &str, refspec: &str) -> Option<String> {
    let output = git_command()
        .args(["rev-parse", "--verify", "--quiet", refspec])
        .current_dir(repo_path)
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// Resolve the filesystem path for a worktree given its name and the repo config.
fn resolve_worktree_path(repo_path: &str, worktree_name: &str, config: &crate::types::AppConfig) -> String {
    let base = config
        .worktree_base_path
        .as_deref()
        .map(std::path::Path::new)
        .map(std::path::Path::to_path_buf)
        .unwrap_or_else(|| {
            std::path::Path::new(repo_path)
                .parent()
                .unwrap_or(std::path::Path::new(repo_path))
                .to_path_buf()
        });
    base.join(worktree_name).to_string_lossy().to_string()
}

/// The checkout path of a worktree: ask git first (matching on dir name, since
/// worktree names are the branch with `/` → `-`), and only fall back to the
/// `worktree_base_path` convention when git doesn't know it. The fallback alone
/// misses externally created worktrees, which live wherever the user put them.
async fn worktree_checkout_path(
    repo_path: &str,
    worktree_name: &str,
    config: &crate::types::AppConfig,
) -> String {
    checkout_paths(repo_path)
        .await
        .into_iter()
        .find(|(_, path)| {
            std::path::Path::new(path).file_name().and_then(|n| n.to_str()) == Some(worktree_name)
        })
        .map(|(_, path)| path)
        .unwrap_or_else(|| resolve_worktree_path(repo_path, worktree_name, config))
}

/// The single restack path, as invoked by the user ("Restack now", or the
/// repo-wide cascade). Emits status events; returns Err only for
/// conflicts/system failures the caller may want to surface.
///
/// Explicit user action always retries, so any memoised conflict is discarded
/// first — that memo exists purely to stop the background poll from re-running
/// a rebase it already knows will fail.
pub async fn restack_child(
    app_handle: &AppHandle,
    app_data_dir: &Path,
    repo_path: &str,
    worktree_name: &str,
) -> Result<(), String> {
    clear_conflict_memo(repo_path, worktree_name);
    restack_child_inner(app_handle, app_data_dir, repo_path, worktree_name, false).await
}

/// `auto = true` marks the 60s background poll: it skips children whose current
/// parent tip is already memoised as conflicting and records new conflicts.
/// Manual callers pass `false` and always attempt the rebase.
async fn restack_child_inner(
    app_handle: &AppHandle,
    app_data_dir: &Path,
    repo_path: &str,
    worktree_name: &str,
    auto: bool,
) -> Result<(), String> {
    let config = config_manager::load_personal_config(app_data_dir, repo_path)
        .await
        .map_err(|e| e.to_string())?;
    let Some(parent_branch) = config_manager::get_stack_parent(&config, worktree_name) else {
        return Err(format!("{worktree_name} has no stack parent"));
    };

    let worktree_path = worktree_checkout_path(repo_path, worktree_name, &config).await;

    if !std::path::Path::new(&worktree_path).exists() {
        return Err(format!("worktree path does not exist: {worktree_path}"));
    }

    let Some(parent_tip) = branch_tip(repo_path, &parent_branch).await else {
        return Err(format!("could not resolve tip of {parent_branch}"));
    };

    // A conflict against this exact parent tip will conflict again identically;
    // retrying it every poll only churns Rebasing→Conflict events. Checked even
    // when `auto` is false so a moved parent tip invalidates the memo.
    let memoised_conflict = conflict_memo_should_skip(repo_path, worktree_name, &parent_tip);
    if auto && memoised_conflict {
        return Ok(());
    }

    // Baseline: persisted, else one-time merge-base fallback (pre-existing stacks).
    let baseline = match config_manager::get_stack_baseline(&config, worktree_name) {
        Some(sha) => sha,
        None => git_manager::merge_base(&worktree_path, "HEAD", &parent_tip)
            .await
            .map_err(|e| e.to_string())?,
    };

    if baseline == parent_tip {
        // No rebase is pending, so notes about a rebase that didn't happen —
        // "deferred because the tree was dirty", "the last one conflicted" — are
        // obsolete, and nothing below would ever clear them. A `PushFailed` is
        // NOT obsolete: the local branch being up to date is exactly the state in
        // which a stale remote goes unnoticed, so it survives until a push
        // succeeds or a new attempt starts.
        match sticky_status(repo_path, worktree_name) {
            Some(StackRebaseStatus::SkippedDirty | StackRebaseStatus::Conflict) | None => {
                clear_sticky_status(repo_path, worktree_name);
                emit_status(app_handle, worktree_name, StackRebaseStatus::UpToDate);
            }
            // "Restack now" on a branch with nothing to rebase is the recovery
            // action for a failed push: retry the push itself rather than
            // no-oping. `push_with_lease_or_flag` clears the sticky entry when
            // the push lands (or there's no upstream) and re-arms it when it
            // doesn't, so the badge tracks reality either way — including the
            // case where the user pushed from a terminal and this converges to a
            // successful no-op. Poll-driven calls skip it: silently retrying a
            // failing push every 60s is network churn with no new information.
            Some(StackRebaseStatus::PushFailed) if !auto => {
                push_with_lease_or_flag(app_handle, repo_path, &worktree_path, worktree_name).await;
                if sticky_status(repo_path, worktree_name).is_none() {
                    emit_status(app_handle, worktree_name, StackRebaseStatus::UpToDate);
                }
            }
            // Emitting UpToDate here would flicker it in and out every poll,
            // since `compute_stack_statuses` re-emits the sticky one moments later.
            Some(_) => {}
        }
        return Ok(());
    }

    match run_restack(app_handle, repo_path, &worktree_path, worktree_name, &parent_tip, &baseline).await {
        // Only a real rebase moves the child's history onto `parent_tip` — only
        // that outcome may advance the persisted baseline. A dirty-skip performs
        // no rebase at all, so persisting here would make every later poll
        // short-circuit `UpToDate` forever and desync the baseline from HEAD.
        Ok(RestackOutcome::Rebased) => {
            // Reload rather than reuse the snapshot taken before the rebase: the
            // rebase + push above take seconds, and any config write that landed
            // meanwhile (port claim, column drag, a sibling's baseline) would be
            // clobbered by saving the stale copy.
            let mut config = config_manager::load_personal_config(app_data_dir, repo_path)
                .await
                .map_err(|e| e.to_string())?;
            config_manager::set_stack_baseline(&mut config, worktree_name, &parent_tip);
            if let Err(e) = config_manager::save_config(app_data_dir, repo_path, &config).await {
                eprintln!("[stack_manager] failed to persist baseline for {worktree_name}: {e}");
            }
            Ok(())
        }
        Ok(RestackOutcome::SkippedDirty) => Ok(()),
        Err(e) => {
            if auto {
                record_conflict(repo_path, worktree_name, &parent_tip);
            }
            Err(e)
        }
    }
}

/// Outcome of `run_restack`'s attempt, distinct from a bare `Result<(), _>` so
/// callers can gate baseline persistence on an actual rebase having happened.
enum RestackOutcome {
    Rebased,
    SkippedDirty,
}

/// Detects a `git rebase` already in progress in `worktree_path`, via `git
/// rev-parse --git-path rebase-merge`/`rebase-apply` rather than joining
/// `<worktree_path>/.git/rebase-merge` by hand: in a linked worktree `.git` is
/// a *file* (a gitdir pointer), and the real `rebase-merge`/`rebase-apply`
/// state lives under the main checkout's `.git/worktrees/<name>/`, not under
/// the worktree path itself. `--git-path` resolves that indirection for us
/// (and returns an absolute path when it does, though a relative one is
/// handled too).
async fn rebase_in_progress(worktree_path: &str) -> bool {
    for marker in ["rebase-merge", "rebase-apply"] {
        let Ok(output) = git_command()
            .args(["rev-parse", "--git-path", marker])
            .current_dir(worktree_path)
            .output()
            .await
        else {
            continue;
        };
        if !output.status.success() {
            continue;
        }
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if raw.is_empty() {
            continue;
        }
        let path = std::path::Path::new(&raw);
        let resolved = if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::path::Path::new(worktree_path).join(path)
        };
        if resolved.exists() {
            return true;
        }
    }
    false
}

/// Shared restack sequence (Tasks 5/7 reuse this verbatim): dirty-check, rebase
/// `--onto`, and — on success — auto-push with lease when an upstream exists.
/// Baseline resolution/persistence is the caller's job since it varies per caller.
async fn run_restack(
    app_handle: &AppHandle,
    repo_path: &str,
    worktree_path: &str,
    worktree_name: &str,
    target_tip: &str,
    baseline: &str,
) -> Result<RestackOutcome, String> {
    // Checked BEFORE the sticky-clear/dirty-check below, and deliberately
    // returns early without touching sticky status or emitting anything: a
    // rebase already in progress here means `begin_conflict_handoff` left
    // conflict markers for the worktree's Claude session to resolve via
    // `git rebase --continue`. If this fell through to the ordinary
    // clear-then-dirty-check sequence below, the sticky `Conflict` status that
    // sent the user to that handoff would get silently overwritten with
    // `SkippedDirty` the moment a poll catches the worktree between
    // busy-registry ticks — hiding the popover's resolve/retry buttons for the
    // entire resolution. Leaving sticky status untouched here lets
    // `compute_stack_statuses` keep re-emitting `Conflict` until the agent's
    // `rebase --continue` actually finishes it (or the rebase is aborted).
    if rebase_in_progress(worktree_path).await {
        return Ok(RestackOutcome::SkippedDirty);
    }

    // A fresh attempt supersedes whatever the last one reported.
    clear_sticky_status(repo_path, worktree_name);

    // Dirty child → visible skip, not a silent eprintln. Unknown status
    // (spawn failure) defaults to "dirty": skip rather than risk rebasing an
    // uncertain tree.
    if worktree_is_dirty(worktree_path, true).await {
        set_sticky_status(repo_path, worktree_name, StackRebaseStatus::SkippedDirty);
        emit_status(app_handle, worktree_name, StackRebaseStatus::SkippedDirty);
        return Ok(RestackOutcome::SkippedDirty);
    }

    emit_status(app_handle, worktree_name, StackRebaseStatus::Rebasing);

    match git_manager::rebase_onto_sha(worktree_path, target_tip, baseline, true).await {
        Ok(()) => {
            let _ = app_handle.emit("stack:rebase-complete", worktree_name.to_string());
            push_with_lease_or_flag(app_handle, repo_path, worktree_path, worktree_name).await;
            Ok(RestackOutcome::Rebased)
        }
        Err(e) => {
            eprintln!("[stack_manager] restack failed for {worktree_name}: {e}");
            let _ = app_handle.emit("stack:rebase-conflict", worktree_name.to_string());
            set_sticky_status(repo_path, worktree_name, StackRebaseStatus::Conflict);
            emit_status(app_handle, worktree_name, StackRebaseStatus::Conflict);
            Err(e.to_string())
        }
    }
}

/// Push with `--force-with-lease` when the branch has been published (an
/// upstream matching its own name — an upstream inherited from the start
/// point, like origin/main, means unpublished and there is nothing to keep in
/// sync); on failure, emit `PushFailed` rather than propagating — the rebase
/// already succeeded locally, so a push failure is surfaced as a status, not
/// an error. Shared by `run_restack` and `change_base`, whose success paths
/// both do this.
///
/// A failure is also recorded as sticky, because `compute_stack_statuses` runs
/// moments later in the same poll and would otherwise replace it with the
/// commit-count status of a branch that is, locally, perfectly up to date.
async fn push_with_lease_or_flag(
    app_handle: &AppHandle,
    repo_path: &str,
    worktree_path: &str,
    worktree_name: &str,
) {
    if git_manager::has_matching_upstream(worktree_path).await {
        if let Err(e) =
            crate::commands::git_ops::git_push_force_with_lease(worktree_path.to_string()).await
        {
            eprintln!("[stack_manager] lease push failed for {worktree_name}: {e}");
            set_sticky_status(repo_path, worktree_name, StackRebaseStatus::PushFailed);
            emit_status(app_handle, worktree_name, StackRebaseStatus::PushFailed);
            return;
        }
    }
    // Pushed cleanly (or nothing to push) — drop any earlier failure.
    clear_sticky_status(repo_path, worktree_name);
}

/// Why a merged-parent dissolution produced no rebased child. The distinction is
/// load-bearing: only `Conflicted` — a rebase that actually ran — still dissolves
/// the stack (deliberate; recovery is manual). Everything else must leave the
/// relationship standing so a later poll retries.
enum DissolveFailure {
    /// Preconditions failed; git was never asked to rebase anything.
    NotAttempted(String),
    /// Rebase ran, hit conflicts, and was aborted.
    Conflicted(String),
}

/// Rebase a child onto the default branch after its parent merged/dissolved.
/// Same baseline mechanics as `restack_child`, but the target is the default
/// branch's tip rather than the recorded parent.
///
/// Returns the outcome rather than a bare `Ok`: only `Rebased` means the child
/// actually sits on the default branch now, and only then may the caller
/// dissolve the stack relationship.
async fn restack_onto_default(
    app_handle: &AppHandle,
    app_data_dir: &Path,
    repo_path: &str,
    worktree_name: &str,
    default_short: &str,
) -> Result<RestackOutcome, DissolveFailure> {
    let config = config_manager::load_personal_config(app_data_dir, repo_path)
        .await
        .map_err(|e| DissolveFailure::NotAttempted(e.to_string()))?;
    let worktree_path = worktree_checkout_path(repo_path, worktree_name, &config).await;
    if !std::path::Path::new(&worktree_path).exists() {
        return Err(DissolveFailure::NotAttempted(format!(
            "worktree path does not exist: {worktree_path}"
        )));
    }
    let Some(target_tip) = branch_tip(repo_path, default_short).await else {
        return Err(DissolveFailure::NotAttempted(format!(
            "could not resolve tip of {default_short}"
        )));
    };
    let baseline = match config_manager::get_stack_baseline(&config, worktree_name) {
        Some(sha) => sha,
        None => git_manager::merge_base(&worktree_path, "HEAD", &target_tip)
            .await
            .map_err(|e| DissolveFailure::NotAttempted(e.to_string()))?,
    };

    // `rebase_onto_sha` validates both revisions itself, but it does so *inside*
    // the call whose failure this function reports as `Conflicted` — so a
    // corrupted baseline in config would read as "the user has merge conflicts"
    // and dissolve the stack. Validate first so it lands in `NotAttempted`.
    for sha in [&target_tip, &baseline] {
        git_manager::validate_commit_hash(sha)
            .map_err(|e| DissolveFailure::NotAttempted(e.to_string()))?;
    }

    run_restack(app_handle, repo_path, &worktree_path, worktree_name, &target_tip, &baseline)
        .await
        .map_err(DissolveFailure::Conflicted)
}

/// `git merge-base --is-ancestor a b` — true when `a` is reachable from `b`.
async fn is_ancestor(worktree_path: &str, a: &str, b: &str) -> bool {
    git_command()
        .args(["merge-base", "--is-ancestor", a, b])
        .current_dir(worktree_path)
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Where an adopted (previously unstacked) branch's own commits start: the
/// ancestry-LATEST fork point among the plausible old bases — the default
/// branch's remote-tracking ref, its local ref (which is ahead of the remote
/// for anyone committing to the default branch locally), and the new parent's
/// tip (for a branch that was cut from the parent itself in a terminal).
/// Preferring any single candidate corrupts the others' shapes: merge-basing
/// only against the new parent reaches back to the stack's own fork from the
/// default branch and replays/grafts every default-branch commit the stack's
/// base predates (the Mills-script incident), while merge-basing only against
/// the default branch does the mirror image to a branch cut from the parent.
/// Candidates that don't resolve are skipped; two incomparable fork points
/// keep the earlier-listed (default-branch) candidate.
async fn adoption_baseline(
    worktree_path: &str,
    default_remote: &str,
    target_tip: &str,
) -> Result<String, String> {
    let local_default = default_remote.strip_prefix("origin/").unwrap_or(default_remote);
    let local_ref = format!("refs/heads/{local_default}");
    let mut best: Option<String> = None;
    for candidate in [default_remote, local_ref.as_str(), target_tip] {
        let Ok(fork) = git_manager::merge_base(worktree_path, "HEAD", candidate).await else {
            continue;
        };
        best = match best {
            Some(b) if !is_ancestor(worktree_path, &b, &fork).await => Some(b),
            _ => Some(fork),
        };
    }
    best.ok_or_else(|| {
        format!("could not derive an adoption baseline (no merge-base with {default_remote} or the new parent)")
    })
}

/// Re-parent with migration: rebase the child's own commits onto the new base
/// NOW (`--onto <new-tip> <old-baseline>`), then persist parent + baseline.
///
/// Metadata ordering differs by case, because "what does the user retry with?"
/// differs by case:
///
/// - `Some(new_parent)` — the new parent AND the old baseline are persisted
///   BEFORE the rebase, so a conflicted migration still leaves a stack
///   relationship for "Restack now" to retry against, with the same `--onto`
///   floor this attempt used. Error returned for the dialog to surface.
/// - `None` (re-base onto the default branch) — the parent is cleared only once
///   the rebase actually succeeds. Clearing it up front would dissolve the stack
///   on a conflict, taking the stack UI and every retry path with it, while the
///   branch itself was left untouched by the aborted rebase.
///
/// Deliberately does NOT route through `run_restack`: this is an explicit user
/// action, not a background poll, so there is no dirty-skip — `rebase_onto_sha`
/// wip-stashes any uncommitted changes instead. It shares only the lease-push
/// tail (`push_with_lease_or_flag`) with `run_restack`; the surrounding
/// persist-then-emit ordering is bespoke to this caller.
pub async fn change_base(
    app_handle: &AppHandle,
    app_data_dir: &Path,
    repo_path: &str,
    worktree_name: &str,
    new_parent: Option<&str>,
) -> Result<(), String> {
    // Explicit user action: always retry, never honour a memoised conflict, and
    // supersede whatever the last background attempt reported.
    clear_conflict_memo(repo_path, worktree_name);
    clear_sticky_status(repo_path, worktree_name);

    let mut config = config_manager::load_personal_config(app_data_dir, repo_path)
        .await
        .map_err(|e| e.to_string())?;
    let worktree_path = worktree_checkout_path(repo_path, worktree_name, &config).await;
    if !std::path::Path::new(&worktree_path).exists() {
        return Err(format!("worktree path does not exist: {worktree_path}"));
    }

    // Resolved once for both the dissolve target and the adoption baseline.
    let rp = repo_path.to_string();
    let default_remote =
        tokio::task::spawn_blocking(move || git_manager::resolve_default_remote_branch(&rp))
            .await
            .map_err(|e| e.to_string())?;

    let target_branch: String = match new_parent {
        Some(p) => p.to_string(),
        None => default_remote.strip_prefix("origin/").unwrap_or(&default_remote).to_string(),
    };
    let Some(target_tip) = branch_tip(repo_path, &target_branch).await else {
        return Err(format!("could not resolve tip of {target_branch}"));
    };

    // Old baseline: persisted; else merge-base against the OLD parent when it
    // still resolves, else the adoption derivation — this is what makes
    // retroactive re-parenting replay only the child's commits.
    let old_baseline = match config_manager::get_stack_baseline(&config, worktree_name) {
        Some(sha) => sha,
        None => {
            let old_parent_tip = match config_manager::get_stack_parent(&config, worktree_name) {
                Some(p) => branch_tip(repo_path, &p).await,
                None => None,
            };
            match old_parent_tip {
                Some(old_ref) => git_manager::merge_base(&worktree_path, "HEAD", &old_ref)
                    .await
                    .map_err(|e| e.to_string())?,
                // Unstacked branch, or a stale entry whose old parent is gone
                // (merged + pruned): both fall to the fork-point derivation —
                // merge-basing against the NEW parent here was the live-incident
                // corruption.
                None => adoption_baseline(&worktree_path, &default_remote, &target_tip).await?,
            }
        }
    };

    // Re-parenting persists the new parent FIRST (see the doc comment), and
    // pins `old_baseline` alongside it. Pinning matters for the stack that had
    // no persisted baseline: `old_baseline` was just derived by merge-base
    // against the OLD parent, and once the new parent is written that
    // computation is unreproducible — a retry after a conflict would merge-base
    // against the NEW parent and replay the old parent's commits on top of
    // themselves. Writing it here makes the retry's `--onto <new-tip>
    // <old-baseline>` identical to this attempt's. On success the block below
    // overwrites it with `target_tip`. Dissolving (`None`) deliberately writes
    // nothing until the rebase succeeds: clearing or pinning up front would
    // dissolve the stack UI (and every retry path) on a conflict that left the
    // branch untouched.
    if let Some(p) = new_parent {
        config_manager::set_stack_parent(&mut config, worktree_name, p);
        config_manager::set_stack_baseline(&mut config, worktree_name, &old_baseline);
        config_manager::save_config(app_data_dir, repo_path, &config)
            .await
            .map_err(|e| e.to_string())?;
    }

    if old_baseline == target_tip {
        // Nothing to replay — the branch already starts at the target tip. For a
        // dissolve that IS the whole migration, so the entry goes now; leaving
        // the baseline behind would seed the next stack with a stale `--onto` floor.
        if new_parent.is_none() {
            let mut config = config_manager::load_personal_config(app_data_dir, repo_path)
                .await
                .map_err(|e| e.to_string())?;
            config_manager::clear_stack_entry(&mut config, worktree_name);
            config_manager::save_config(app_data_dir, repo_path, &config)
                .await
                .map_err(|e| e.to_string())?;
            forget_stack_memos(repo_path, worktree_name);
        }
        emit_status(app_handle, worktree_name, StackRebaseStatus::UpToDate);
        return Ok(());
    }

    emit_status(app_handle, worktree_name, StackRebaseStatus::Rebasing);
    match git_manager::rebase_onto_sha(&worktree_path, &target_tip, &old_baseline, true).await {
        Ok(()) => {
            let mut config = config_manager::load_personal_config(app_data_dir, repo_path)
                .await
                .map_err(|e| e.to_string())?;
            match new_parent {
                Some(_) => config_manager::set_stack_baseline(&mut config, worktree_name, &target_tip),
                // The migration landed — only now is the stack relationship over.
                None => config_manager::clear_stack_entry(&mut config, worktree_name),
            }
            config_manager::save_config(app_data_dir, repo_path, &config)
                .await
                .map_err(|e| e.to_string())?;
            let _ = app_handle.emit("stack:rebase-complete", worktree_name.to_string());
            push_with_lease_or_flag(app_handle, repo_path, &worktree_path, worktree_name).await;
            // Dissolved: no `stack_parent_overrides` entry survives, so
            // `compute_stack_statuses` will never visit this worktree again and
            // any sticky entry (including a `PushFailed` just set above) would
            // outlive every path that could clear it.
            if new_parent.is_none() {
                forget_stack_memos(repo_path, worktree_name);
            }
            Ok(())
        }
        // Aborted, branch unchanged. Nothing is written here: a re-parent kept the
        // new parent and pinned baseline it persisted above, and a dissolve still
        // has its old parent, so both remain visible in the stack UI and retryable.
        Err(e) => {
            let _ = app_handle.emit("stack:rebase-conflict", worktree_name.to_string());
            set_sticky_status(repo_path, worktree_name, StackRebaseStatus::Conflict);
            emit_status(app_handle, worktree_name, StackRebaseStatus::Conflict);
            Err(format!("re-base migration hit conflicts (aborted; branch unchanged): {e}"))
        }
    }
}

/// Re-run the failing restack WITHOUT aborting, leaving the conflict in the
/// worktree for an agent to resolve. Returns the resolution prompt, or the
/// sentinel `"__no_conflict__"` if the rebase succeeded after all (e.g. the
/// user already fixed the parent and this is a retry).
///
/// Deliberately does NOT route through `run_restack`: `rebase_onto_sha` is
/// called here with `abort_on_failure: false` so a genuine conflict is left in
/// the tree instead of aborted — exactly what `run_restack` must never do.
///
/// The conflict path does not record a new conflict-memo entry, and actively
/// *clears* any existing one. No new entry is needed because that memo exists
/// purely to stop the *poll* from re-attempting a rebase it already knows is
/// doomed, and nothing here needs suppressing — the poll's own guards inside
/// `run_restack` (`rebase_in_progress` first, then the dirty-check) already
/// refuse to touch a worktree mid-conflicted-rebase, since a conflicted
/// `git status --porcelain` is never empty (see `worktree_is_dirty`, and
/// `rebase_onto_sha`'s own test coverage for the left-in-place case).
///
/// Clearing the *old* entry is what keeps the handoff from being a dead end.
/// The background poll that first hit this conflict memoised the parent tip;
/// once the agent finishes `git rebase --continue`, the branch is already on
/// that tip but the persisted baseline still isn't — and a live memo for the
/// same tip would make every future auto-restack return early, so the baseline
/// would never advance and the promised push would never happen. Dropping the
/// memo here means the first poll after the resolution re-attempts, converges,
/// and pushes. It is safe to drop while the rebase is still in flight because
/// `rebase_in_progress` — not the memo — is what protects the in-flight
/// resolution.
///
/// The sticky `Conflict` status that got the user to this action is left
/// untouched: it's still true.
pub async fn begin_conflict_handoff(
    app_handle: &AppHandle,
    app_data_dir: &Path,
    repo_path: &str,
    worktree_name: &str,
) -> Result<String, String> {
    let config = config_manager::load_personal_config(app_data_dir, repo_path)
        .await
        .map_err(|e| e.to_string())?;
    let Some(parent_branch) = config_manager::get_stack_parent(&config, worktree_name) else {
        return Err(format!("{worktree_name} has no stack parent"));
    };
    let worktree_path = worktree_checkout_path(repo_path, worktree_name, &config).await;
    let Some(parent_tip) = branch_tip(repo_path, &parent_branch).await else {
        return Err(format!("could not resolve tip of {parent_branch}"));
    };
    let baseline = match config_manager::get_stack_baseline(&config, worktree_name) {
        Some(sha) => sha,
        None => git_manager::merge_base(&worktree_path, "HEAD", &parent_tip)
            .await
            .map_err(|e| e.to_string())?,
    };

    match git_manager::rebase_onto_sha(&worktree_path, &parent_tip, &baseline, false).await {
        Ok(()) => {
            // No conflict after all. Persist baseline like a normal successful
            // restack, and clear this worktree's conflict bookkeeping —
            // mirroring what a successful `restack_child`/`run_restack` does —
            // since the rebase completed and the baseline now advances past
            // whatever the sticky Conflict/memo were about.
            clear_conflict_memo(repo_path, worktree_name);
            clear_sticky_status(repo_path, worktree_name);
            let mut config = config_manager::load_personal_config(app_data_dir, repo_path)
                .await
                .map_err(|e| e.to_string())?;
            config_manager::set_stack_baseline(&mut config, worktree_name, &parent_tip);
            let _ = config_manager::save_config(app_data_dir, repo_path, &config).await;
            let _ = app_handle.emit("stack:rebase-complete", worktree_name.to_string());
            Ok("__no_conflict__".to_string())
        }
        Err(_) => {
            // Left in place: do not clear the sticky Conflict (still true), and
            // do not record a conflict-memo entry. Any memo the background poll
            // recorded for this parent tip IS dropped — the agent is about to
            // finish the rebase, and a live memo would suppress the follow-up
            // auto-restack that advances the baseline and pushes (see doc
            // comment above; `rebase_in_progress` guards the in-flight resolve).
            clear_conflict_memo(repo_path, worktree_name);
            let short_parent = &parent_tip[..12.min(parent_tip.len())];
            Ok(format!(
                "A `git rebase --onto {short_parent} <baseline>` restacking this branch onto \
                 `{parent_branch}` stopped on conflicts, which are now in the working tree. \
                 Resolve every conflict preserving the intent of BOTH sides, then run \
                 `git add -A && git rebase --continue` (repeat if further commits conflict) \
                 until the rebase completes. Do NOT push — Alfredo handles pushing. \
                 Do NOT run `git rebase --abort` unless the conflicts are genuinely unresolvable, \
                 and say so clearly if you do."
            ))
        }
    }
}

/// True when `git status --porcelain` reports any changes. `default_if_unknown`
/// is the fail-safe when the check itself errors (spawn failure): callers that
/// need "don't rebase on an uncertain tree" pass `true`; callers that use this
/// only as a soft gating heuristic (don't block forever on a transient error)
/// pass `false`.
async fn worktree_is_dirty(worktree_path: &str, default_if_unknown: bool) -> bool {
    git_command()
        .args(["status", "--porcelain"])
        .current_dir(worktree_path)
        .output()
        .await
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(default_if_unknown)
}

fn emit_status(app_handle: &AppHandle, worktree_name: &str, status: StackRebaseStatus) {
    let _ = app_handle.emit(
        "stack:status-update",
        StackStatusPayload { worktree_name: worktree_name.to_string(), status },
    );
}

/// branch name → checkout path for every worktree of the repo (incl. the main checkout).
pub async fn checkout_paths(repo_path: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Ok(output) = git_command()
        .args(["worktree", "list", "--porcelain"])
        .current_dir(repo_path)
        .output()
        .await
    else {
        return out;
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut current_path: Option<String> = None;
    for line in text.lines() {
        if let Some(p) = line.strip_prefix("worktree ") {
            current_path = Some(p.to_string());
        } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
            if let Some(p) = current_path.take() {
                out.insert(b.to_string(), p);
            }
        } else if line.is_empty() {
            current_path = None;
        }
    }
    out
}

/// Walk child→parent edges up from `start` to the branch the stack is rooted
/// on. The root is the first worktree with no `stack_parent_overrides` entry —
/// roots are never in that map (creating or re-basing onto the default branch
/// deliberately writes no entry), which is exactly why the restack cascade has
/// never touched them.
///
/// `None` means "don't sync anything": either a parent branch has no local
/// checkout (nothing to rebase, and guessing a different root would rewrite the
/// wrong branch) or the chain cycles.
fn stack_root_name(
    overrides: &HashMap<String, String>,
    name_to_branch: &HashMap<String, String>,
    start: &str,
) -> Option<String> {
    let branch_to_name: HashMap<&str, &str> = name_to_branch
        .iter()
        .map(|(n, b)| (b.as_str(), n.as_str()))
        .collect();

    let mut current = start.to_string();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    seen.insert(current.clone());

    loop {
        let Some(parent_branch) = overrides.get(&current) else {
            return Some(current);
        };
        let parent_name = (*branch_to_name.get(parent_branch.as_str())?).to_string();
        if !seen.insert(parent_name.clone()) {
            return None;
        }
        current = parent_name;
    }
}

/// What a root sync should do, decided before any history is touched so the
/// decision is testable without an `AppHandle`.
enum RootSyncPlan {
    /// Nothing to do; the payload is the reason, for the skip log.
    Skip(&'static str),
    Rebase {
        root_name: String,
        root_path: String,
        target_tip: String,
        baseline: String,
    },
}

/// Resolve the root of `anchor_name`'s stack and work out whether it needs
/// rebasing onto the default branch. Reads local refs only — the caller is
/// responsible for fetching first, which keeps this testable offline.
///
/// The target is deliberately `origin/<default>`, not the local default branch:
/// "sync with main" means the remote's main, and the local ref may be days old.
/// The baseline comes from `adoption_baseline`, which already rules on the
/// awkward cases (a default branch committed to locally, a stale
/// remote-tracking ref) and is covered by its own tests.
async fn plan_root_sync(
    repo_path: &str,
    overrides: &HashMap<String, String>,
    checkouts: &HashMap<String, String>,
    anchor_name: &str,
) -> Result<RootSyncPlan, String> {
    let name_to_branch: HashMap<String, String> = checkouts
        .iter()
        .filter_map(|(branch, path)| {
            std::path::Path::new(path)
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| (n.to_string(), branch.clone()))
        })
        .collect();

    let Some(root_name) = stack_root_name(overrides, &name_to_branch, anchor_name) else {
        return Ok(RootSyncPlan::Skip("no resolvable stack root (missing checkout or cycle)"));
    };
    let Some(root_branch) = name_to_branch.get(&root_name) else {
        return Ok(RootSyncPlan::Skip("stack root has no checkout"));
    };
    let Some(root_path) = checkouts.get(root_branch) else {
        return Ok(RootSyncPlan::Skip("stack root has no checkout"));
    };

    let default_remote = git_manager::resolve_default_remote_branch(repo_path);
    let default_short = default_remote.strip_prefix("origin/").unwrap_or(&default_remote);
    if root_branch == default_short {
        return Ok(RootSyncPlan::Skip("stack root is the default branch"));
    }

    let Some(target_tip) = remote_branch_tip(repo_path, default_short).await else {
        return Ok(RootSyncPlan::Skip("default branch has no remote-tracking ref"));
    };

    let baseline = adoption_baseline(root_path, &default_remote, &target_tip).await?;
    if baseline == target_tip {
        return Ok(RootSyncPlan::Skip("root already sits on the default branch tip"));
    }

    Ok(RootSyncPlan::Rebase {
        root_name,
        root_path: root_path.clone(),
        target_tip,
        baseline,
    })
}

/// Kahn's algorithm over child→parent edges. Returns every stacked worktree name
/// with parents before children; members of cycles are dropped (logged).
fn restack_order(
    overrides: &HashMap<String, String>,
    name_to_branch: &HashMap<String, String>,
) -> Vec<String> {
    use std::collections::BTreeMap;
    // branch → worktree name (only for names we know the branch of)
    let branch_to_name: HashMap<&str, &str> = name_to_branch
        .iter()
        .map(|(n, b)| (b.as_str(), n.as_str()))
        .collect();

    // child name → parent name, only when the parent is itself a stacked-or-known worktree
    let mut depends_on: BTreeMap<&str, Option<&str>> = BTreeMap::new();
    for (child, parent_branch) in overrides {
        let parent_name = branch_to_name.get(parent_branch.as_str()).copied()
            .filter(|p| overrides.contains_key(*p)); // only in-graph parents create edges
        depends_on.insert(child.as_str(), parent_name);
    }

    let mut order: Vec<String> = Vec::new();
    let mut placed: std::collections::HashSet<&str> = std::collections::HashSet::new();
    loop {
        let mut progressed = false;
        for (child, parent) in &depends_on {
            if placed.contains(child) {
                continue;
            }
            let ready = match parent {
                None => true,
                Some(p) => placed.contains(p),
            };
            if ready {
                order.push((*child).to_string());
                placed.insert(child);
                progressed = true;
            }
        }
        if !progressed {
            break;
        }
    }
    let dropped: Vec<&&str> = depends_on.keys().filter(|k| !placed.contains(**k)).collect();
    if !dropped.is_empty() {
        eprintln!("[stack_manager] dropping cyclic stack members from restack order: {dropped:?}");
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(a, b)| ((*a).to_string(), (*b).to_string())).collect()
    }

    #[test]
    fn restack_order_sorts_three_level_stack() {
        // grandchild → child → parent; branch names contain '/' so dir names differ.
        let overrides = map(&[
            ("feat-c", "feat/b"), // worktree feat-c is stacked on branch feat/b
            ("feat-b", "feat/a"),
        ]);
        let name_to_branch = map(&[("feat-c", "feat/c"), ("feat-b", "feat/b"), ("feat-a", "feat/a")]);
        let order = restack_order(&overrides, &name_to_branch);
        assert_eq!(order, vec!["feat-b".to_string(), "feat-c".to_string()]);
    }

    #[test]
    fn restack_order_handles_independent_stacks_and_forks() {
        // two children on one parent + an unrelated child; children of the same
        // parent keep deterministic (sorted) order.
        let overrides = map(&[("wt-x", "feat/a"), ("wt-y", "feat/a"), ("wt-z", "other/root")]);
        let name_to_branch = map(&[("wt-x", "feat/x"), ("wt-y", "feat/y"), ("wt-z", "feat/z")]);
        let order = restack_order(&overrides, &name_to_branch);
        assert_eq!(order.len(), 3);
        let (ix, iy) = (order.iter().position(|n| n == "wt-x").unwrap(), order.iter().position(|n| n == "wt-y").unwrap());
        assert!(ix < iy, "same-parent children sort deterministically");
    }

    #[test]
    fn restack_order_drops_cycles() {
        let overrides = map(&[("wt-a", "feat/b"), ("wt-b", "feat/a")]);
        let name_to_branch = map(&[("wt-a", "feat/a"), ("wt-b", "feat/b")]);
        assert!(restack_order(&overrides, &name_to_branch).is_empty());
    }

    #[test]
    fn stack_root_name_walks_to_the_top_of_a_three_level_stack() {
        // grandchild → child → parent; only the two children have entries.
        let overrides = map(&[("feat-c", "feat/b"), ("feat-b", "feat/a")]);
        let name_to_branch =
            map(&[("feat-c", "feat/c"), ("feat-b", "feat/b"), ("feat-a", "feat/a")]);

        assert_eq!(
            stack_root_name(&overrides, &name_to_branch, "feat-c"),
            Some("feat-a".to_string())
        );
    }

    #[test]
    fn stack_root_name_returns_the_anchor_when_it_is_already_the_root() {
        let overrides = map(&[("feat-b", "feat/a")]);
        let name_to_branch = map(&[("feat-b", "feat/b"), ("feat-a", "feat/a")]);

        assert_eq!(
            stack_root_name(&overrides, &name_to_branch, "feat-a"),
            Some("feat-a".to_string())
        );
    }

    #[test]
    fn stack_root_name_bails_when_a_parent_has_no_checkout() {
        // feat/a was removed locally: there is no tree to rebase, so the whole
        // sync must be skipped rather than syncing the wrong branch.
        let overrides = map(&[("feat-b", "feat/a")]);
        let name_to_branch = map(&[("feat-b", "feat/b")]);

        assert_eq!(stack_root_name(&overrides, &name_to_branch, "feat-b"), None);
    }

    #[test]
    fn stack_root_name_bails_on_a_cycle() {
        let overrides = map(&[("feat-a", "feat/b"), ("feat-b", "feat/a")]);
        let name_to_branch = map(&[("feat-a", "feat/a"), ("feat-b", "feat/b")]);

        assert_eq!(stack_root_name(&overrides, &name_to_branch, "feat-a"), None);
    }

    // `worktree_is_dirty` is the discriminator `run_restack` gates
    // `RestackOutcome::Rebased` vs `SkippedDirty` on — and `restack_child` only
    // persists a new baseline for `Rebased`. These cover the actual
    // state-corruption case from the review: a dirty child must be detected as
    // dirty so its baseline is never silently advanced without a real rebase.
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    fn init_test_repo() -> TempDir {
        let dir = TempDir::new().expect("create temp dir");
        let path = dir.path();
        StdCommand::new("git")
            .args(["init", "-b", "main"])
            .current_dir(path)
            .output()
            .expect("git init");
        StdCommand::new("git")
            .args([
                "-c", "user.name=Test", "-c", "user.email=test@test.com",
                "commit", "--allow-empty", "-m", "init",
            ])
            .current_dir(path)
            .output()
            .expect("git initial commit");
        dir
    }

    #[tokio::test]
    async fn worktree_is_dirty_false_for_clean_tree() {
        let dir = init_test_repo();
        assert!(!worktree_is_dirty(dir.path().to_str().expect("utf8 path"), true).await);
    }

    #[tokio::test]
    async fn worktree_is_dirty_true_for_uncommitted_changes() {
        let dir = init_test_repo();
        std::fs::write(dir.path().join("uncommitted.txt"), "wip").expect("write file");
        assert!(worktree_is_dirty(dir.path().to_str().expect("utf8 path"), false).await);
    }

    /// Build a repo whose `feat/parent` has been merged into main and pushed:
    /// the one shape `stale_parent_branches` is allowed to flag. `checkout_parent`
    /// leaves the repo checked out on `feat/parent` (so it has a live checkout)
    /// instead of on main.
    fn merged_pushed_parent_repo(checkout_parent: bool) -> TempDir {
        let repo = init_test_repo();
        let repo_path = repo.path().to_str().expect("utf8 path");

        for args in [
            vec!["checkout", "-b", "feat/parent"],
            vec![
                "-c", "user.name=Test", "-c", "user.email=test@test.com",
                "commit", "--allow-empty", "-m", "parent work",
            ],
            vec!["checkout", "main"],
            vec!["merge", "--ff-only", "feat/parent"],
            // No real `origin` remote in this fixture — synthesize the
            // remote-tracking refs. `origin/main` is what
            // `resolve_default_remote_branch`'s fallback probes for;
            // `origin/feat/parent` is what makes the parent a *pushed* branch.
            vec!["update-ref", "refs/remotes/origin/main", "refs/heads/main"],
            vec!["update-ref", "refs/remotes/origin/feat/parent", "refs/heads/feat/parent"],
        ] {
            StdCommand::new("git").args(&args).current_dir(repo_path).output().expect("git");
        }

        if checkout_parent {
            StdCommand::new("git")
                .args(["checkout", "feat/parent"])
                .current_dir(repo_path)
                .output()
                .expect("git checkout");
        }
        repo
    }

    /// Test-repo git runner: enforced identity, asserted exit status, trimmed stdout.
    fn run_git(repo_path: &str, args: &[&str]) -> String {
        let out = StdCommand::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@test.com"])
            .args(args)
            .current_dir(repo_path)
            .output()
            .expect("git");
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    // The live-incident shape (Mills-script graft): a stack parent cut from old
    // main, main advances with a novel commit, then a branch cut from the NEW
    // main tip is adopted into the stack. Its own commits start at its fork
    // from the default branch (= its HEAD here — zero own commits), NOT at the
    // stack's older fork point; merge-basing against the new parent returns
    // the latter and drags the novel main commit through the adoption rebase.
    #[tokio::test]
    async fn adoption_baseline_is_default_branch_fork_point_not_stack_fork_point() {
        let repo = init_test_repo();
        let repo_path = repo.path().to_str().expect("utf8 path");

        run_git(repo_path, &["checkout", "-b", "feat/parent"]);
        run_git(repo_path, &["commit", "--allow-empty", "-m", "parent work"]);
        let parent_tip = run_git(repo_path, &["rev-parse", "HEAD"]);
        run_git(repo_path, &["checkout", "main"]);
        run_git(repo_path, &["commit", "--allow-empty", "-m", "novel main commit (Jack's script)"]);
        let main_tip = run_git(repo_path, &["rev-parse", "HEAD"]);
        run_git(repo_path, &["update-ref", "refs/remotes/origin/main", "refs/heads/main"]);
        run_git(repo_path, &["checkout", "-b", "feat/child"]);

        let baseline = adoption_baseline(repo_path, "origin/main", &parent_tip)
            .await
            .expect("adoption_baseline");

        assert_eq!(baseline, main_tip, "baseline must be the child's fork from main");
        // Regression guard: the old derivation (merge-base vs the new parent)
        // lands on the stack's fork point instead, before the novel commit.
        let stack_fork = git_manager::merge_base(repo_path, "HEAD", &parent_tip).await.unwrap();
        assert_ne!(baseline, stack_fork);
    }

    // The mirror shape: a branch cut from the PARENT itself in a terminal, then
    // adopted. Its fork from the default branch is the stack's old fork point —
    // baselining there would replay the parent's own commits onto the child.
    // The parent-tip candidate is the descendant and must win.
    #[tokio::test]
    async fn adoption_baseline_prefers_parent_fork_for_branch_cut_from_parent() {
        let repo = init_test_repo();
        let repo_path = repo.path().to_str().expect("utf8 path");

        run_git(repo_path, &["update-ref", "refs/remotes/origin/main", "refs/heads/main"]);
        run_git(repo_path, &["checkout", "-b", "feat/parent"]);
        run_git(repo_path, &["commit", "--allow-empty", "-m", "parent work"]);
        let parent_tip = run_git(repo_path, &["rev-parse", "HEAD"]);
        run_git(repo_path, &["checkout", "-b", "feat/child"]);

        let baseline = adoption_baseline(repo_path, "origin/main", &parent_tip)
            .await
            .expect("adoption_baseline");

        assert_eq!(baseline, parent_tip, "child cut from the parent replays nothing");
    }

    // A default branch committed to locally (or a stale remote-tracking ref):
    // the child was cut from LOCAL main while origin/main lags. The local
    // default candidate is the descendant and must win, or the unpushed main
    // commits get replayed onto the new parent.
    #[tokio::test]
    async fn adoption_baseline_prefers_local_default_when_ahead_of_remote() {
        let repo = init_test_repo();
        let repo_path = repo.path().to_str().expect("utf8 path");

        let old_main = run_git(repo_path, &["rev-parse", "HEAD"]);
        run_git(repo_path, &["checkout", "-b", "feat/parent"]);
        run_git(repo_path, &["commit", "--allow-empty", "-m", "parent work"]);
        let parent_tip = run_git(repo_path, &["rev-parse", "HEAD"]);
        run_git(repo_path, &["checkout", "main"]);
        run_git(repo_path, &["commit", "--allow-empty", "-m", "unpushed local main commit"]);
        let local_main_tip = run_git(repo_path, &["rev-parse", "HEAD"]);
        // origin/main pinned at the OLD tip — the unpushed/stale-remote window.
        run_git(repo_path, &["update-ref", "refs/remotes/origin/main", &old_main]);
        run_git(repo_path, &["checkout", "-b", "feat/child"]);

        let baseline = adoption_baseline(repo_path, "origin/main", &parent_tip)
            .await
            .expect("adoption_baseline");

        assert_eq!(baseline, local_main_tip, "baseline must be the fork from local main");
    }

    // With no resolvable default refs at all, adopting must still work —
    // degrade to the merge-base with the new parent rather than erroring.
    #[tokio::test]
    async fn adoption_baseline_falls_back_to_parent_merge_base_without_default() {
        let repo = init_test_repo();
        let repo_path = repo.path().to_str().expect("utf8 path");

        let fork = run_git(repo_path, &["rev-parse", "HEAD"]);
        run_git(repo_path, &["checkout", "-b", "feat/parent"]);
        run_git(repo_path, &["commit", "--allow-empty", "-m", "parent work"]);
        let parent_tip = run_git(repo_path, &["rev-parse", "HEAD"]);
        // Detach main entirely so neither origin/develop nor refs/heads/develop resolves.
        run_git(repo_path, &["checkout", "-b", "feat/child", &fork]);

        let baseline = adoption_baseline(repo_path, "origin/develop", &parent_tip)
            .await
            .expect("adoption_baseline");

        assert_eq!(baseline, fork);
    }

    /// Repo shaped like a real stack: root `feat/root` cut from main, child
    /// `feat/child` on top of it, and `origin/main` advanced past the fork.
    /// Returns (repo, root_worktree_path, expected_target_tip).
    fn stack_with_advanced_main() -> (TempDir, String, String) {
        let repo = init_test_repo();
        let repo_path = repo.path().to_str().expect("utf8 path").to_string();

        run_git(&repo_path, &["update-ref", "refs/remotes/origin/main", "refs/heads/main"]);
        run_git(&repo_path, &["checkout", "-b", "feat/root"]);
        run_git(&repo_path, &["commit", "--allow-empty", "-m", "root work"]);
        run_git(&repo_path, &["checkout", "main"]);
        run_git(&repo_path, &["commit", "--allow-empty", "-m", "someone landed on main"]);
        let main_tip = run_git(&repo_path, &["rev-parse", "HEAD"]);
        run_git(&repo_path, &["update-ref", "refs/remotes/origin/main", "refs/heads/main"]);
        run_git(&repo_path, &["checkout", "feat/root"]);

        (repo, repo_path.clone(), main_tip)
    }

    #[tokio::test]
    async fn plan_root_sync_targets_origin_default_from_a_child_anchor() {
        let (_repo, repo_path, main_tip) = stack_with_advanced_main();
        // The child is anchored on the root's branch; only the child has an entry.
        let overrides = map(&[("feat-child", "feat/root")]);
        let checkouts = map(&[("feat/root", &repo_path), ("feat/child", "/nonexistent/feat-child")]);

        let plan = plan_root_sync(&repo_path, &overrides, &checkouts, "feat-child")
            .await
            .expect("plan_root_sync");

        match plan {
            RootSyncPlan::Rebase { root_name, root_path, target_tip, baseline } => {
                // checkout dir name for the root is the temp dir's own name
                assert!(root_path == repo_path, "root path must be the root's checkout");
                assert_eq!(target_tip, main_tip, "must target origin/main, not local refs");
                assert_ne!(baseline, main_tip, "root has its own commit to replay");
                assert!(!root_name.is_empty());
            }
            RootSyncPlan::Skip(reason) => panic!("expected a rebase, got skip: {reason}"),
        }
    }

    #[tokio::test]
    async fn plan_root_sync_skips_a_root_already_on_the_default_tip() {
        let repo = init_test_repo();
        let repo_path = repo.path().to_str().expect("utf8 path").to_string();
        run_git(&repo_path, &["update-ref", "refs/remotes/origin/main", "refs/heads/main"]);
        run_git(&repo_path, &["checkout", "-b", "feat/root"]);
        // No commits on the root and no movement on main: nothing to replay.
        let overrides = map(&[("feat-child", "feat/root")]);
        let checkouts = map(&[("feat/root", &repo_path)]);

        let plan = plan_root_sync(&repo_path, &overrides, &checkouts, "feat-child")
            .await
            .expect("plan_root_sync");

        assert!(matches!(plan, RootSyncPlan::Skip(_)), "an up-to-date root must not rebase");
    }

    #[tokio::test]
    async fn plan_root_sync_never_rebases_the_default_branch() {
        let repo = init_test_repo();
        let repo_path = repo.path().to_str().expect("utf8 path").to_string();
        run_git(&repo_path, &["update-ref", "refs/remotes/origin/main", "refs/heads/main"]);
        // A (historically corrupt) entry pointing a child straight at main.
        let overrides = map(&[("feat-child", "main")]);
        let checkouts = map(&[("main", &repo_path)]);

        let plan = plan_root_sync(&repo_path, &overrides, &checkouts, "feat-child")
            .await
            .expect("plan_root_sync");

        assert!(matches!(plan, RootSyncPlan::Skip(_)), "main must never be rebased onto itself");
    }

    #[tokio::test]
    async fn plan_root_sync_skips_when_the_root_has_no_checkout() {
        let (_repo, repo_path, _tip) = stack_with_advanced_main();
        let overrides = map(&[("feat-child", "feat/root")]);
        // feat/root absent from the checkout list — removed locally.
        let checkouts = map(&[("feat/child", "/nonexistent/feat-child")]);

        let plan = plan_root_sync(&repo_path, &overrides, &checkouts, "feat-child")
            .await
            .expect("plan_root_sync");

        assert!(matches!(plan, RootSyncPlan::Skip(_)));
    }

    // The heuristic's positive case: pushed, merged into main, and no worktree
    // still sitting on it. This is the only shape allowed to dissolve a stack
    // without a merged-PR event.
    #[tokio::test]
    async fn stale_parent_branches_flags_merged_pushed_parent() {
        let repo = merged_pushed_parent_repo(false);
        let repo_path = repo.path().to_str().expect("utf8 path");
        let overrides = map(&[("feat-child", "feat/parent")]);

        let stale =
            stale_parent_branches(repo_path, &overrides, &checkout_paths(repo_path).await).await;

        assert_eq!(stale, vec!["feat/parent".to_string()]);
    }

    // Fail closed: an empty checkouts map means `git worktree list` failed, not
    // that no parent has a worktree. Reading it the second way would turn the
    // liveness guard off exactly when we can least justify a destructive guess —
    // same fixture as the positive case, so the SHAs alone would flag it.
    #[tokio::test]
    async fn stale_parent_branches_bails_when_no_checkouts_listed() {
        let repo = merged_pushed_parent_repo(false);
        let repo_path = repo.path().to_str().expect("utf8 path");
        let overrides = map(&[("feat-child", "feat/parent")]);

        let stale = stale_parent_branches(repo_path, &overrides, &HashMap::new()).await;

        assert!(stale.is_empty(), "an unreadable worktree list must dissolve nothing");
    }

    // Liveness guard: identical SHAs to the test above, but the parent still has
    // a checkout. A live worktree means the user is still working there, and no
    // SHA heuristic gets to overrule that — `check_merged_parents` handles the
    // genuinely-merged-with-worktree-open case, where a real PR event says so.
    #[tokio::test]
    async fn stale_parent_branches_spares_parent_with_live_checkout() {
        let repo = merged_pushed_parent_repo(true);
        let repo_path = repo.path().to_str().expect("utf8 path");
        let overrides = map(&[("feat-child", "feat/parent")]);

        let checkouts = checkout_paths(repo_path).await;
        assert!(checkouts.contains_key("feat/parent"), "fixture must have the parent checked out");

        let stale = stale_parent_branches(repo_path, &overrides, &checkouts).await;

        assert!(
            stale.is_empty(),
            "a parent with a live checkout must never be auto-dissolved by the heuristic"
        );
    }

    fn test_config(repo_path: &str) -> crate::types::AppConfig {
        crate::types::AppConfig {
            repo_path: repo_path.to_string(),
            setup_scripts: None,
            github_token: None,
            linear_api_key: None,
            branch_mode: false,
            column_overrides: HashMap::new(),
            theme: None,
            notifications: None,
            worktree_base_path: None,
            claude_defaults: None,
            worktree_overrides: None,
            run_script: None,
            stack_parent_overrides: HashMap::new(),
            stack_baselines: HashMap::new(),
            archive_script: None,
            linear_tickets: HashMap::new(),
            port_assignments: HashMap::new(),
            auto_assign_ports: false,
            port_env_var: None,
            port_range_start: None,
            port_range_end: None,
            linear_prompt_template: None,
            linear_auto_submit: false,
            worktree_order: HashMap::new(),
        }
    }

    // The brand-new-stack regression: a parent worktree created seconds ago has
    // zero commits of its own, so its LOCAL tip is still exactly main's tip and
    // `merge-base --is-ancestor` reports it as merged. Resolving the parent
    // through `origin/<parent>` instead means an unpushed branch is simply not a
    // candidate, and the stack survives its first poll.
    #[tokio::test]
    async fn stale_parent_branches_ignores_unpushed_parent(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = init_test_repo();
        let repo_path = repo.path().to_str().expect("utf8 path");

        // Zero-commit branch off main: local tip == main tip, never pushed.
        StdCommand::new("git")
            .args(["branch", "feat/parent", "main"])
            .current_dir(repo_path)
            .output()?;
        StdCommand::new("git")
            .args(["update-ref", "refs/remotes/origin/main", "refs/heads/main"])
            .current_dir(repo_path)
            .output()?;

        let overrides = map(&[("feat-child", "feat/parent")]);
        let stale =
            stale_parent_branches(repo_path, &overrides, &checkout_paths(repo_path).await).await;

        assert!(
            stale.is_empty(),
            "an unpushed parent cannot have been merged — the stack must survive"
        );
        Ok(())
    }

    // Externally created worktrees live wherever the user put them, not under
    // `worktree_base_path` — `git worktree list` is the only source that knows.
    #[tokio::test]
    async fn worktree_checkout_path_finds_external_worktree(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = init_test_repo();
        let repo_path = repo.path().to_str().expect("utf8 path");
        let elsewhere = TempDir::new()?;
        let external = elsewhere.path().join("feat-child");

        StdCommand::new("git")
            .args(["worktree", "add", "-b", "feat/child", &external.to_string_lossy(), "main"])
            .current_dir(repo_path)
            .output()?;

        let config = test_config(repo_path);
        let found = worktree_checkout_path(repo_path, "feat-child", &config).await;
        assert_eq!(
            std::fs::canonicalize(&found)?,
            std::fs::canonicalize(&external)?,
            "should resolve via `git worktree list`, not the base-path convention"
        );

        // The convention fallback still answers for names git doesn't know.
        let unknown = worktree_checkout_path(repo_path, "not-a-worktree", &config).await;
        assert_eq!(unknown, resolve_worktree_path(repo_path, "not-a-worktree", &config));
        Ok(())
    }

    // `run_restack` needs an `AppHandle` this test module has no fixture for,
    // so this exercises `rebase_in_progress` directly — the detection helper
    // that guards it — against a real *linked* worktree with a genuinely
    // conflicted, left-in-place rebase. The linked-worktree shape is the one
    // that matters: `.git` there is a file (a gitdir pointer), so a naive
    // `<worktree_path>/.git/rebase-merge` join would never find the state,
    // which actually lives under the main checkout's `.git/worktrees/<name>/`.
    // Mirrors the fixture in
    // `git_manager::rebase_onto_sha_conflict_leaves_rebase_in_place_when_abort_on_failure_false`,
    // one level up (linked worktree instead of the repo root).
    #[tokio::test]
    async fn rebase_in_progress_detects_conflicted_rebase_in_linked_worktree(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let repo = init_test_repo();
        let repo_path = repo.path().to_str().expect("utf8 path");

        StdCommand::new("git").args(["checkout", "-b", "parent"]).current_dir(repo_path).output()?;
        std::fs::write(repo.path().join("s.txt"), "base")?;
        StdCommand::new("git").args(["add", "."]).current_dir(repo_path).output()?;
        StdCommand::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@test.com", "commit", "-m", "p1"])
            .current_dir(repo_path)
            .output()?;
        let old_parent_tip = StdCommand::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(repo_path)
            .output()?;
        let old_parent_tip = String::from_utf8_lossy(&old_parent_tip.stdout).trim().to_string();

        let elsewhere = TempDir::new()?;
        let child_path = elsewhere.path().join("child");
        StdCommand::new("git")
            .args(["worktree", "add", "-b", "child", &child_path.to_string_lossy(), "parent"])
            .current_dir(repo_path)
            .output()?;
        let child_path_str = child_path.to_str().expect("utf8 path");
        std::fs::write(child_path.join("s.txt"), "child-edit")?;
        StdCommand::new("git").args(["add", "."]).current_dir(child_path_str).output()?;
        StdCommand::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@test.com", "commit", "-m", "c1"])
            .current_dir(child_path_str)
            .output()?;

        StdCommand::new("git").args(["checkout", "parent"]).current_dir(repo_path).output()?;
        std::fs::write(repo.path().join("s.txt"), "parent-edit")?;
        StdCommand::new("git").args(["add", "."]).current_dir(repo_path).output()?;
        StdCommand::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@test.com", "commit", "-m", "p2"])
            .current_dir(repo_path)
            .output()?;
        let new_parent_tip = StdCommand::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(repo_path)
            .output()?;
        let new_parent_tip = String::from_utf8_lossy(&new_parent_tip.stdout).trim().to_string();

        assert!(!rebase_in_progress(child_path_str).await, "no rebase attempted yet");

        git_manager::rebase_onto_sha(child_path_str, &new_parent_tip, &old_parent_tip, false)
            .await
            .expect_err("conflicting rebase must fail");

        assert!(
            rebase_in_progress(child_path_str).await,
            "a conflicted rebase left in place must be detected"
        );

        StdCommand::new("git").args(["rebase", "--abort"]).current_dir(child_path_str).output()?;
        assert!(
            !rebase_in_progress(child_path_str).await,
            "aborting the rebase must clear the in-progress state"
        );

        Ok(())
    }

    // The memo must be tip-scoped: the same tip is a guaranteed repeat conflict,
    // a moved tip is a genuinely new situation and has to be retried.
    #[test]
    fn conflict_memo_skips_only_the_tip_that_failed() {
        let repo = "/tmp/memo-test-repo";
        let name = "memo-child";
        clear_conflict_memo(repo, name);

        assert!(!conflict_memo_should_skip(repo, name, "aaa"), "no memo → attempt");

        record_conflict(repo, name, "aaa");
        assert!(conflict_memo_should_skip(repo, name, "aaa"), "same tip → skip");

        assert!(!conflict_memo_should_skip(repo, name, "bbb"), "moved tip → attempt");
        assert!(
            !conflict_memo_should_skip(repo, name, "aaa"),
            "the moved tip invalidated the memo entirely"
        );

        record_conflict(repo, name, "ccc");
        clear_conflict_memo(repo, name);
        assert!(!conflict_memo_should_skip(repo, name, "ccc"), "manual retry clears the memo");
    }

    // `compute_stack_statuses` runs milliseconds after a restack in the same
    // poll; without the sticky entry it would recompute PushFailed away.
    #[test]
    fn sticky_status_round_trips_and_clears() {
        let repo = "/tmp/sticky-test-repo";
        let name = "sticky-child";
        clear_sticky_status(repo, name);

        assert!(sticky_status(repo, name).is_none());

        set_sticky_status(repo, name, StackRebaseStatus::PushFailed);
        assert_eq!(sticky_status(repo, name), Some(StackRebaseStatus::PushFailed));

        set_sticky_status(repo, name, StackRebaseStatus::SkippedDirty);
        assert_eq!(sticky_status(repo, name), Some(StackRebaseStatus::SkippedDirty));

        // Conflict is the one the user acts on. With the conflict memo
        // suppressing the retry, it is emitted exactly once — so if it isn't
        // sticky, `compute_stack_statuses` erases the badge moments later and
        // the conflict becomes invisible.
        set_sticky_status(repo, name, StackRebaseStatus::Conflict);
        assert_eq!(sticky_status(repo, name), Some(StackRebaseStatus::Conflict));

        clear_sticky_status(repo, name);
        assert!(sticky_status(repo, name).is_none(), "a new attempt supersedes the last one");
    }

    // Dissolution removes the `stack_parent_overrides` entry, so no later poll
    // would ever visit this worktree to clear its memos. A name that re-joins a
    // stack must not inherit a conflict badge or a suppressed rebase.
    #[test]
    fn forget_stack_memos_clears_conflict_and_sticky_together() {
        let repo = "/tmp/forget-test-repo";
        let name = "forget-child";

        record_conflict(repo, name, "aaa");
        set_sticky_status(repo, name, StackRebaseStatus::Conflict);

        forget_stack_memos(repo, name);

        assert!(sticky_status(repo, name).is_none(), "sticky status must not outlive the stack");
        assert!(
            !conflict_memo_should_skip(repo, name, "aaa"),
            "a dissolved worktree must not keep suppressing rebases"
        );
    }
}
