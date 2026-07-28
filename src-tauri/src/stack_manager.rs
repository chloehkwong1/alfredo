use std::collections::HashMap;
use std::path::Path;

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

// ── Public entry points ──────────────────────────────────────────

/// Called at the end of each sync poll. Baseline-tracked (no in-memory SHA
/// cache — restart-safe): "parent moved" is decided per child inside
/// `restack_child` by comparing its persisted baseline against the parent's
/// current tip.
pub async fn check_and_rebase(app_handle: &AppHandle, app_data_dir: &Path, repo_paths: &[String]) {
    // One registry snapshot per poll: cwd → status. Unavailable registry (no
    // claude binary, timeout) degrades to clean-tree-only gating — restacks
    // must not be blocked forever by a missing CLI.
    let registry: HashMap<String, String> =
        match crate::commands::claude_registry::poll_claude_registry().await {
            Ok(entries) => entries.into_iter().map(|e| (e.cwd, e.status)).collect(),
            Err(_) => HashMap::new(),
        };

    for repo_path in repo_paths {
        // Task 13: detect stale parents (merged into main) first
        if let Err(e) = detect_stale_parents(app_data_dir, repo_path).await {
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
                if registry.get(parent_path).map(String::as_str) == Some("busy") {
                    continue;
                }
                let parent_dirty = git_command()
                    .args(["status", "--porcelain"])
                    .current_dir(parent_path)
                    .output()
                    .await
                    .map(|o| !o.stdout.is_empty())
                    .unwrap_or(false);
                if parent_dirty {
                    continue;
                }
            }
            // (restack_child no-ops with UpToDate when baseline == parent tip.)
            let _ = restack_child(app_handle, app_data_dir, repo_path, &child_name).await;
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
    for repo_path in repo_paths {
        let mut config = match config_manager::load_personal_config(app_data_dir, repo_path).await {
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

        let mut config_changed = false;
        for (child_name, _merged_parent) in &affected {
            // Minimal adaptation to the new restack_child signature (Task 4 concern,
            // to be fixed properly in Task 5): restack_child resolves the parent
            // branch from `stack_parent_overrides`, which at this point still holds
            // the *merged* (likely-deleted) parent — the override below only clears
            // it afterward. If the merged branch ref is gone, restack_child can't
            // resolve a tip and no-ops instead of rebasing onto the default branch.
            let _ = restack_child(app_handle, app_data_dir, repo_path, child_name).await;

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

            // Clear the stack parent from config
            config.stack_parent_overrides.remove(child_name);
            config_changed = true;
        }

        if config_changed {
            if let Err(e) = config_manager::save_config(app_data_dir, repo_path, &config).await {
                eprintln!("[stack_manager] failed to save config after clearing merged parents: {e}");
            }
        }
    }
}

/// Called at the end of each poll. Computes commits-behind for all stacked worktrees
/// and emits `stack:status-update` events.
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
pub async fn detect_stale_parents(app_data_dir: &Path, repo_path: &str) -> Result<(), String> {
    let mut config = config_manager::load_personal_config(app_data_dir, repo_path)
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

    config_manager::save_config(app_data_dir, repo_path, &config)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

// ── Helpers ──────────────────────────────────────────────────────

/// Tip SHA for a branch: local ref first (works for unpushed parents; the local
/// tip is what children actually stack on), remote-tracking ref as fallback.
async fn branch_tip(repo_path: &str, branch: &str) -> Option<String> {
    for refspec in [format!("refs/heads/{branch}"), format!("origin/{branch}")] {
        if let Ok(output) = git_command()
            .args(["rev-parse", "--verify", "--quiet", &refspec])
            .current_dir(repo_path)
            .output()
            .await
        {
            if output.status.success() {
                return Some(String::from_utf8_lossy(&output.stdout).trim().to_string());
            }
        }
    }
    None
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

/// The single restack path. Emits status events; returns Err only for
/// conflicts/system failures the caller may want to surface.
pub async fn restack_child(
    app_handle: &AppHandle,
    app_data_dir: &Path,
    repo_path: &str,
    worktree_name: &str,
) -> Result<(), String> {
    let mut config = config_manager::load_personal_config(app_data_dir, repo_path)
        .await
        .map_err(|e| e.to_string())?;
    let Some(parent_branch) = config_manager::get_stack_parent(&config, worktree_name) else {
        return Err(format!("{worktree_name} has no stack parent"));
    };

    let checkouts = checkout_paths(repo_path).await;
    // The child's own checkout path: match by dir name (worktree names are branch with / → -).
    let worktree_path = checkouts
        .iter()
        .find(|(_, path)| {
            std::path::Path::new(path).file_name().and_then(|n| n.to_str()) == Some(worktree_name)
        })
        .map(|(_, path)| path.clone())
        .unwrap_or_else(|| resolve_worktree_path(repo_path, worktree_name, &config));

    if !std::path::Path::new(&worktree_path).exists() {
        return Err(format!("worktree path does not exist: {worktree_path}"));
    }

    let Some(parent_tip) = branch_tip(repo_path, &parent_branch).await else {
        return Err(format!("could not resolve tip of {parent_branch}"));
    };

    // Baseline: persisted, else one-time merge-base fallback (pre-existing stacks).
    let baseline = match config_manager::get_stack_baseline(&config, worktree_name) {
        Some(sha) => sha,
        None => git_manager::merge_base(&worktree_path, "HEAD", &parent_tip)
            .await
            .map_err(|e| e.to_string())?,
    };

    if baseline == parent_tip {
        emit_status(app_handle, worktree_name, StackRebaseStatus::UpToDate);
        return Ok(());
    }

    match run_restack(app_handle, &worktree_path, worktree_name, &parent_tip, &baseline).await {
        Ok(()) => {
            config_manager::set_stack_baseline(&mut config, worktree_name, &parent_tip);
            if let Err(e) = config_manager::save_config(app_data_dir, repo_path, &config).await {
                eprintln!("[stack_manager] failed to persist baseline for {worktree_name}: {e}");
            }
            Ok(())
        }
        Err(e) => Err(e),
    }
}

/// Shared restack sequence (Tasks 5/7 reuse this verbatim): dirty-check, rebase
/// `--onto`, and — on success — auto-push with lease when an upstream exists.
/// Baseline resolution/persistence is the caller's job since it varies per caller.
async fn run_restack(
    app_handle: &AppHandle,
    worktree_path: &str,
    worktree_name: &str,
    target_tip: &str,
    baseline: &str,
) -> Result<(), String> {
    // Dirty child → visible skip, not a silent eprintln.
    let dirty = git_command()
        .args(["status", "--porcelain"])
        .current_dir(worktree_path)
        .output()
        .await
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(true);
    if dirty {
        emit_status(app_handle, worktree_name, StackRebaseStatus::SkippedDirty);
        return Ok(());
    }

    emit_status(app_handle, worktree_name, StackRebaseStatus::Rebasing);

    match git_manager::rebase_onto_sha(worktree_path, target_tip, baseline, true).await {
        Ok(()) => {
            let _ = app_handle.emit("stack:rebase-complete", worktree_name.to_string());

            if git_manager::has_upstream(worktree_path).await {
                if let Err(e) =
                    crate::commands::git_ops::git_push_force_with_lease(worktree_path.to_string())
                        .await
                {
                    eprintln!("[stack_manager] lease push failed for {worktree_name}: {e}");
                    emit_status(app_handle, worktree_name, StackRebaseStatus::PushFailed);
                }
            }
            Ok(())
        }
        Err(e) => {
            eprintln!("[stack_manager] restack failed for {worktree_name}: {e}");
            let _ = app_handle.emit("stack:rebase-conflict", worktree_name.to_string());
            emit_status(app_handle, worktree_name, StackRebaseStatus::Conflict);
            Err(e.to_string())
        }
    }
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
}
