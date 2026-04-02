use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};

use crate::config_manager;
use crate::git_manager;
use crate::git_manager::git_command;
use crate::types::{StackRebaseStatus};

// ── State ────────────────────────────────────────────────────────

/// Tracks last-known HEAD SHAs for parent branches so we only rebase when something changed.
pub struct StackState {
    /// Maps "repo_path::branch_name" → last known HEAD SHA.
    pub parent_heads: Mutex<HashMap<String, String>>,
}

impl StackState {
    pub fn new() -> Self {
        Self {
            parent_heads: Mutex::new(HashMap::new()),
        }
    }
}

// ── Event payloads ───────────────────────────────────────────────

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StackStatusPayload {
    worktree_name: String,
    status: StackRebaseStatus,
}

// ── Public entry points ──────────────────────────────────────────

/// Called at the end of each sync poll. Detects parent HEAD changes and rebases children.
pub async fn check_and_rebase(app_handle: &AppHandle, repo_paths: &[String]) {
    for repo_path in repo_paths {
        // Task 13: detect stale parents (merged into main) first
        if let Err(e) = detect_stale_parents(repo_path).await {
            eprintln!("[stack_manager] detect_stale_parents failed for {repo_path}: {e}");
        }

        let config = match config_manager::load_config(repo_path).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[stack_manager] load_config failed for {repo_path}: {e}");
                continue;
            }
        };

        if config.stack_parent_overrides.is_empty() {
            continue;
        }

        // Collect unique parent branches and map each to its children.
        // children_by_parent: parent_branch → Vec<worktree_name>
        let mut children_by_parent: HashMap<String, Vec<String>> = HashMap::new();
        for (child_name, parent_branch) in &config.stack_parent_overrides {
            children_by_parent
                .entry(parent_branch.clone())
                .or_default()
                .push(child_name.clone());
        }

        // For each parent, check if its remote HEAD has changed.
        for (parent_branch, children) in &children_by_parent {
            let current_head = match get_branch_head(repo_path, parent_branch).await {
                Some(h) => h,
                None => {
                    eprintln!("[stack_manager] could not resolve HEAD for origin/{parent_branch}");
                    continue;
                }
            };

            let cache_key = format!("{repo_path}::{parent_branch}");
            let last_head: Option<String> = app_handle
                .try_state::<StackState>()
                .and_then(|s| s.parent_heads.lock().ok().map(|m| m.get(&cache_key).cloned()))
                .flatten();

            // Update cached HEAD
            if let Some(state) = app_handle.try_state::<StackState>() {
                if let Ok(mut heads) = state.parent_heads.lock() {
                    heads.insert(cache_key, current_head.clone());
                }
            }

            // Only rebase if HEAD actually changed (or was unknown)
            if last_head.as_deref() == Some(current_head.as_str()) {
                continue;
            }

            // Sort children topologically so parents-in-stack come before their children.
            let sorted = topological_sort(children, &config.stack_parent_overrides);

            for child_name in &sorted {
                rebase_child(child_name, repo_path, parent_branch, app_handle, config.worktree_base_path.as_deref()).await;
            }
        }
    }
}

/// Called after Phase 1 emit. Checks if any merged PR's branch is a stack parent,
/// and if so rebases children onto the default branch and clears the stack parent.
pub async fn check_merged_parents(
    app_handle: &AppHandle,
    repo_paths: &[String],
    prs: &[crate::github_sync::PrStatusWithColumn],
) {
    for repo_path in repo_paths {
        let mut config = match config_manager::load_config(repo_path).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[stack_manager] load_config failed for {repo_path}: {e}");
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

        let mut config_changed = false;
        for (child_name, _merged_parent) in &affected {
            // Rebase child onto the default branch instead
            rebase_child(child_name, repo_path, &default_short, app_handle, config.worktree_base_path.as_deref()).await;

            // Emit parent-merged event
            let _ = app_handle.emit("stack:parent-merged", child_name.clone());

            // Clear the stack parent from config
            config.stack_parent_overrides.remove(child_name);
            config_changed = true;
        }

        if config_changed {
            if let Err(e) = config_manager::save_config(repo_path, &config).await {
                eprintln!("[stack_manager] failed to save config after clearing merged parents: {e}");
            }
        }
    }
}

/// Called at the end of each poll. Computes commits-behind for all stacked worktrees
/// and emits `stack:status-update` events.
pub async fn compute_stack_statuses(app_handle: &AppHandle, repo_paths: &[String]) {
    for repo_path in repo_paths {
        let config = match config_manager::load_config(repo_path).await {
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

            let wt_path = worktree_path.clone();
            let parent = parent_branch.clone();
            let count = tokio::task::spawn_blocking(move || {
                git_manager::commits_behind(&wt_path, Some(&parent))
            })
            .await
            .ok()
            .and_then(std::result::Result::ok);

            let status = match count {
                Some(0) => StackRebaseStatus::UpToDate,
                Some(n) => StackRebaseStatus::Behind { count: n },
                None => continue,
            };

            let payload = StackStatusPayload {
                worktree_name: worktree_name.clone(),
                status,
            };
            let _ = app_handle.emit("stack:status-update", payload);
        }
    }
}

// ── Task 13 ──────────────────────────────────────────────────────

/// Detects stack parents that have been merged into the default branch via manual rebase/merge
/// (not caught by the PR-merge path). Clears them from config.
pub async fn detect_stale_parents(repo_path: &str) -> Result<(), String> {
    let mut config = config_manager::load_config(repo_path)
        .await
        .map_err(|e| e.to_string())?;

    if config.stack_parent_overrides.is_empty() {
        return Ok(());
    }

    // Get the default branch ref for this repo
    let default_branch = tokio::task::spawn_blocking({
        let rp = repo_path.to_string();
        move || git_manager::resolve_default_remote_branch(&rp)
    })
    .await
    .map_err(|e| e.to_string())?;

    let mut stale_parents: Vec<String> = Vec::new();

    // Collect unique parents
    let unique_parents: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        config
            .stack_parent_overrides
            .values()
            .filter(|p| seen.insert((*p).clone()))
            .cloned()
            .collect()
    };

    for parent_branch in &unique_parents {
        let ancestor_ref = format!("origin/{parent_branch}");

        // `git merge-base --is-ancestor <ancestor> <descendant>` exits 0 if ancestor, 1 if not
        let result = git_command()
            .args(["merge-base", "--is-ancestor", &ancestor_ref, &default_branch])
            .current_dir(repo_path)
            .output()
            .await;

        let is_ancestor = result.map(|o| o.status.success()).unwrap_or(false);
        if is_ancestor {
            stale_parents.push(parent_branch.clone());
        }
    }

    if stale_parents.is_empty() {
        return Ok(());
    }

    // Remove any child→parent mapping where the parent is stale
    config
        .stack_parent_overrides
        .retain(|_, parent| !stale_parents.contains(parent));

    config_manager::save_config(repo_path, &config)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────

/// Get the current SHA for `origin/<branch>` in the given repo.
async fn get_branch_head(repo_path: &str, branch: &str) -> Option<String> {
    let refspec = format!("origin/{branch}");
    let output = git_command()
        .args(["rev-parse", &refspec])
        .current_dir(repo_path)
        .output()
        .await
        .ok()?;

    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        None
    }
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

/// Rebase a child worktree onto `parent_branch`. Emits success or conflict events.
/// `worktree_base_path` — if the caller already knows the base path, pass it to skip a
/// redundant config file read. Pass `None` to have it resolved from config.
async fn rebase_child(
    worktree_name: &str,
    repo_path: &str,
    parent_branch: &str,
    app_handle: &AppHandle,
    worktree_base_path: Option<&str>,
) {
    let worktree_path = if let Some(base) = worktree_base_path {
        std::path::Path::new(base).join(worktree_name).to_string_lossy().to_string()
    } else {
        let config = match config_manager::load_config(repo_path).await {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[stack_manager] load_config for rebase_child: {e}");
                return;
            }
        };
        resolve_worktree_path(repo_path, worktree_name, &config)
    };

    if !std::path::Path::new(&worktree_path).exists() {
        eprintln!("[stack_manager] worktree path does not exist: {worktree_path}");
        return;
    }

    // Check for dirty working tree
    let dirty_check = git_command()
        .args(["status", "--porcelain"])
        .current_dir(&worktree_path)
        .output()
        .await;

    match dirty_check {
        Ok(output) if !output.stdout.is_empty() => {
            eprintln!("[stack_manager] skipping rebase of {worktree_name}: dirty working tree");
            return;
        }
        Err(e) => {
            eprintln!("[stack_manager] failed to check dirty status for {worktree_name}: {e}");
            return;
        }
        _ => {}
    }

    match git_manager::rebase_onto(&worktree_path, Some(parent_branch)).await {
        Ok(()) => {
            let _ = app_handle.emit("stack:rebase-complete", worktree_name.to_string());
        }
        Err(e) => {
            eprintln!("[stack_manager] rebase failed for {worktree_name}: {e}");
            let _ = app_handle.emit("stack:rebase-conflict", worktree_name.to_string());
        }
    }
}

/// Sort children topologically so that if child A depends on child B (B is A's parent),
/// B comes before A. Uses the branch names stored in `all_parents` to identify siblings.
///
/// `children` – the worktree names to sort (all share the same immediate parent branch).
/// `all_parents` – the full stack_parent_overrides map (worktree_name → parent branch).
fn topological_sort(
    children: &[String],
    all_parents: &HashMap<String, String>,
) -> Vec<String> {
    // Build a set of branch names that correspond to children in this batch.
    // We don't have branch→name mapping here, so we use names as a proxy.
    // Any child whose stack_parent is the *name* of another child in the batch
    // depends on that child and must come after it.
    let child_names: std::collections::HashSet<&str> =
        children.iter().map(String::as_str).collect();

    let mut first: Vec<String> = Vec::new();
    let mut rest: Vec<String> = Vec::new();

    for child in children {
        // If this child's parent branch matches another child's *name*, defer it.
        let depends_on_sibling = all_parents
            .get(child)
            .map(|p| child_names.contains(p.as_str()))
            .unwrap_or(false);

        if depends_on_sibling {
            rest.push(child.clone());
        } else {
            first.push(child.clone());
        }
    }

    first.extend(rest);
    first
}
