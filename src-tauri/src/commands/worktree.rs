use std::path::PathBuf;

use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::Mutex;

use crate::config_manager;
use crate::git_manager;
use crate::git_manager::git_command;
use crate::git_manager::get_diff_stats;
use crate::github_manager::{self, GithubManager};
use crate::linear_manager;
use crate::types::{AgentState, AppError, KanbanColumn, PortClaimResult, PortHolder, SetupScript, TakePortResult, Worktree, WorktreeSource};

type Result<T> = std::result::Result<T, AppError>;

/// Serializes port claim / release / column-move operations across the whole
/// app. These operations read + mutate + write `config.json` — without a lock,
/// two concurrent claims for the last free slot can both observe the same
/// on-disk state and double-assign (last writer wins). Contention is
/// negligible (personal desktop app, short file I/O), so a single app-wide
/// lock is simpler than a per-repo map.
#[derive(Default)]
pub struct PortConfigLock(pub Mutex<()>);

const DEFAULT_CI_FAILURE_CMD: &str = include_str!("../assets/slash_commands/ci-failure.md");
const DEFAULT_INVESTIGATE_LOG_CMD: &str = include_str!("../assets/slash_commands/investigate-log.md");
const DEFAULT_DIFF_SUMMARY_CMD: &str = include_str!("../assets/slash_commands/diff-summary.md");

/// Create a worktree from any supported source (branch, PR, Linear ticket).
#[tauri::command]
pub async fn create_worktree_from(
    app: AppHandle,
    repo_path: String,
    source: WorktreeSource,
) -> Result<Worktree> {
    match source {
        WorktreeSource::NewBranch { name, base } => {
            git_manager::validate_branch_name(&name)?;
            create_worktree(app, repo_path, name, base).await
        }
        WorktreeSource::ExistingBranch { name, new_name } => {
            match new_name {
                // Custom name: create a new branch from the existing one
                Some(new) => {
                    git_manager::validate_branch_name(&new)?;
                    create_worktree(app, repo_path, new, name).await
                }
                // No custom name: check out the existing branch as-is
                None => create_worktree(app, repo_path, name.clone(), name).await,
            }
        }
        WorktreeSource::PullRequest { number } => {
            create_worktree_from_pr(&app, repo_path, number).await
        }
        WorktreeSource::LinearTicket { id, base } => {
            create_worktree_from_linear(&app, repo_path, &id, base).await
        }
    }
}

/// Determine whether a branch is stacked on another feature branch
/// (i.e. its base is neither the repo default branch nor itself).
fn is_stacked_branch(base_branch: &str, default_remote: &str, branch_name: &str) -> bool {
    let default_short = default_remote.strip_prefix("origin/").unwrap_or(default_remote);
    base_branch != default_short
        && base_branch != default_remote
        && base_branch != branch_name
        && !base_branch.is_empty()
}

/// Payload for the `worktree:setup-complete` event emitted when a worktree's
/// background setup scripts finish. `error` is `None` on success, or the
/// script failure message on failure (surfaced by the existing error UI).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct WorktreeSetupComplete {
    worktree_id: String,
    worktree_path: String,
    error: Option<String>,
}

/// Shared create/adopt provisioning: `.claude` git excludes, seeded default
/// slash commands, and background `run_on == "create"` setup scripts emitting
/// `worktree:setup-complete` when done. Returns whether scripts are running.
async fn provision_worktree(
    app: &AppHandle,
    repo_path: &str,
    worktree_path: &str,
    worktree_id: String,
    create_scripts: Vec<SetupScript>,
) -> bool {
    // Ensure .claude/CLAUDE.local.md and .claude/settings.local.json are in git
    // excludes so they don't show as uncommitted changes in the UI.
    ensure_claude_excludes(repo_path).await;

    // Seed the worktree with default slash commands. Non-fatal on failure.
    write_default_slash_commands(worktree_path).await;

    // Setup scripts (npm/bundle install, codegen) are the slow part of spin-up.
    // Run them off the critical path so the worktree is usable immediately:
    // spawn a background task, and emit `worktree:setup-complete` when done.
    // Failure is non-fatal — the worktree already exists — and is surfaced via
    // the event's `error` field (the frontend shows the existing error UI).
    let setup_in_progress = !create_scripts.is_empty();
    if setup_in_progress {
        let app = app.clone();
        let repo = repo_path.to_string();
        let path = worktree_path.to_string();
        tauri::async_runtime::spawn(async move {
            let error = match config_manager::run_setup_scripts(&repo, &path, &create_scripts).await
            {
                Ok(()) => None,
                Err(e) => Some(e.to_string()),
            };
            let _ = app.emit(
                "worktree:setup-complete",
                WorktreeSetupComplete {
                    worktree_id,
                    worktree_path: path,
                    error,
                },
            );
        });
    }
    setup_in_progress
}

/// Create a worktree with an explicit branch name and base.
#[tauri::command]
pub async fn create_worktree(
    app: AppHandle,
    repo_path: String,
    branch_name: String,
    base_branch: String,
) -> Result<Worktree> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    // Setup scripts are repo-shared (live in alfredo.json after migration), so
    // read them via the effective config. The mutation+save below operates on
    // the personal layer to avoid persisting inherited values back as overrides.
    let effective = config_manager::load_effective_config(&app_data_dir, &repo_path)
        .await?
        .effective;
    let mut config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    let base_path = config.worktree_base_path.as_deref();

    let worktree_path =
        git_manager::create_worktree(&repo_path, &branch_name, &base_branch, base_path).await?;

    let path_str = worktree_path.to_string_lossy().to_string();

    let create_scripts: Vec<_> = effective
        .setup_scripts
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|s| s.run_on == "create")
        .cloned()
        .collect();
    let setup_in_progress = provision_worktree(
        &app,
        &repo_path,
        &path_str,
        git_manager::worktree_id(&repo_path, &branch_name),
        create_scripts,
    )
    .await;

    // Use the sanitized directory name as the ID/name so it matches
    // what list_worktrees returns (git uses the dir name internally).
    let dir_name = branch_name.replace('/', "-");

    // Detect stack parent: if the base branch is not the repo's default,
    // this is a stacked branch — persist the relationship.
    let default_remote = git_manager::resolve_default_remote_branch(&repo_path);
    let is_stacked = is_stacked_branch(&base_branch, &default_remote, &branch_name);

    let stack_parent = if is_stacked {
        let parent = base_branch.strip_prefix("origin/").unwrap_or(&base_branch);
        config_manager::set_stack_parent(&mut config, &dir_name, parent);

        // Record the restack baseline: the parent tip the new branch was cut from.
        // `HEAD^{}` of the fresh worktree == the base tip at creation time.
        if let Ok(output) = git_command()
            .args(["rev-parse", "HEAD"])
            .current_dir(&worktree_path)
            .output()
            .await
        {
            if output.status.success() {
                let base_sha = String::from_utf8_lossy(&output.stdout).trim().to_string();
                config_manager::set_stack_baseline(&mut config, &dir_name, &base_sha);
            }
        }

        Some(parent.to_string())
    } else {
        None
    };

    // Ports are claimed lazily the first time the worktree starts a session,
    // not eagerly on creation. See claim_worktree_port.
    let assigned_port: Option<u16> = None;

    config_manager::save_config(&app_data_dir, &repo_path, &config).await?;

    Ok(Worktree {
        id: git_manager::worktree_id(&repo_path, &branch_name),
        name: dir_name,
        path: path_str,
        branch: branch_name,
        repo_path,
        pr_status: None,
        agent_status: AgentState::NotRunning,
        column: KanbanColumn::InProgress,
        is_branch_mode: config.branch_mode,
        additions: None,
        deletions: None,
        last_commit_epoch: Some(
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0),
        ),
        last_commit_author: None,
        linear_ticket_url: None,
        linear_ticket_identifier: None,
        stack_parent,
        stack_children: vec![],
        stack_rebase_status: None,
        setup_script_error: None,
        setup_in_progress,
        assigned_port,
    })
}

/// Provision a worktree Alfredo didn't create (found on disk by the frontend
/// discovery poll): same tail as `create_worktree` — seeded slash commands,
/// `.claude` excludes, and create-time setup scripts. Returns true when setup
/// scripts are running in the background (frontend shows "Setting up…").
#[tauri::command]
pub async fn adopt_worktree(
    app: AppHandle,
    repo_path: String,
    worktree_path: String,
    worktree_id: String,
) -> Result<bool> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    let effective = config_manager::load_effective_config(&app_data_dir, &repo_path)
        .await?
        .effective;
    let create_scripts: Vec<_> = effective
        .setup_scripts
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|s| s.run_on == "create")
        .cloned()
        .collect();
    Ok(provision_worktree(&app, &repo_path, &worktree_path, worktree_id, create_scripts).await)
}

/// Delete a worktree by name.
#[tauri::command]
pub async fn delete_worktree(
    app: AppHandle,
    repo_path: String,
    worktree_name: String,
    force: bool,
) -> Result<()> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    let mut config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    let base_path = config.worktree_base_path.clone();
    // Drop any persisted Linear ticket reference regardless of whether the git
    // deletion succeeds. Leaving a stale entry behind risks it rehydrating onto
    // an unrelated worktree that later reuses the same name.
    config.linear_tickets.remove(&worktree_name);
    // Same rationale for the column override: a persisted auto-Done (or manual
    // placement) must not rehydrate onto a future worktree that reuses the name.
    config_manager::clear_column_override(&mut config, &worktree_name);
    let _ = config_manager::save_config(&app_data_dir, &repo_path, &config).await;
    git_manager::delete_worktree(&repo_path, &worktree_name, force, base_path.as_deref()).await
}

/// Report uncommitted/untracked work that deleting this worktree would destroy.
/// The delete confirm uses it to warn about work the diff-stat badge can't see —
/// untracked files (e.g. `/research` output) show +0/-0 yet are wiped on delete.
#[tauri::command]
pub async fn worktree_dirty_state(worktree_path: String) -> Result<git_manager::WorktreeDirtyState> {
    git_manager::worktree_dirty_state(&worktree_path).await
}

/// List all worktrees for a repository, filtered to the configured base path
/// (or repo parent directory if not configured).
#[tauri::command]
pub async fn list_worktrees(app: AppHandle, repo_path: String) -> Result<Vec<Worktree>> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    let config = config_manager::load_personal_config(&app_data_dir, &repo_path)
        .await
        .map_err(|e| {
            // Diagnostic for the cold-start "empty sidebar" race: when this
            // step is the transient failure, the frontend retry recovers but
            // we want the source pinned. See useSessionRestore Effect 1.
            tracing::warn!(repo = %repo_path, step = "load_personal_config", error = %e, "[list_worktrees] failed");
            e
        })?;
    let base_path = config.worktree_base_path.clone().unwrap_or_else(|| {
        std::path::Path::new(&repo_path)
            .parent()
            .unwrap_or(std::path::Path::new(&repo_path))
            .to_string_lossy()
            .to_string()
    });

    // git2 operations are blocking — run on a blocking thread
    let repo_path_clone = repo_path.clone();
    let worktrees =
        tokio::task::spawn_blocking(move || git_manager::list_worktrees(&repo_path_clone, Some(&base_path)))
            .await
            .map_err(|e| AppError::Git(format!("task join error: {e}")))?;

    // Pin the transient cold-start trigger (see useSessionRestore Effect 1's
    // retry): an enumeration error is otherwise invisible — the frontend's
    // only log of it goes to the browser console, not alfredo.log. An empty
    // result is a common legitimate state (libgit2 excludes the primary
    // checkout) and is no longer retried, so it is intentionally not logged.
    if let Err(e) = &worktrees {
        tracing::warn!(repo = %repo_path, step = "git_enumeration", error = %e, "[list_worktrees] failed");
    }

    // Apply persisted column overrides from .alfredo.json so worktrees
    // arrive on the frontend with the correct kanban column immediately.
    worktrees.map(|mut wts| {
        // Apply column overrides
        for wt in &mut wts {
            if let Some(col) = config_manager::get_column_override(&config, &wt.name) {
                wt.column = col;
            }
        }
        // Apply stack parents from config, ignoring self-references
        for wt in &mut wts {
            if let Some(parent) = config_manager::get_stack_parent(&config, &wt.name) {
                if parent != wt.branch {
                    wt.stack_parent = Some(parent);
                }
            }
        }
        // Hydrate Linear ticket metadata from persisted config so the StatusBar
        // "Open in Linear" button survives app restart.
        for wt in &mut wts {
            if let Some(ticket) = config_manager::get_linear_ticket(&config, &wt.name) {
                wt.linear_ticket_url = Some(ticket.url);
                wt.linear_ticket_identifier = Some(ticket.identifier);
            }
        }
        // Hydrate assigned port from config only when auto-assign is enabled.
        // Leaving stored assignments in place means toggling the feature back
        // on restores prior ports; toggling off hides them so dev servers fall
        // back to their default port (e.g. 3000).
        if config.auto_assign_ports {
            for wt in &mut wts {
                wt.assigned_port = config_manager::get_assigned_port(&config, &wt.name);
            }
        }
        // Compute stack children: for each worktree, find others whose stack_parent matches this branch
        let parent_map: Vec<(String, String)> = wts
            .iter()
            .filter_map(|wt| wt.stack_parent.as_ref().map(|p| (wt.id.clone(), p.clone())))
            .collect();
        for wt in &mut wts {
            wt.stack_children = parent_map
                .iter()
                .filter(|(id, parent)| *parent == wt.branch && *id != wt.id)
                .map(|(id, _)| id.clone())
                .collect();
        }
        wts
    })
}

/// Count worktrees for a repo, filtered to the configured base path. Cheaper
/// than `list_worktrees` — backs the repo-selector dropdown badges so repos
/// that aren't currently selected still show an accurate count without
/// populating the workspace store.
#[tauri::command]
pub async fn count_worktrees(app: AppHandle, repo_path: String) -> Result<usize> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    let config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    let base_path = config.worktree_base_path.clone().unwrap_or_else(|| {
        std::path::Path::new(&repo_path)
            .parent()
            .unwrap_or(std::path::Path::new(&repo_path))
            .to_string_lossy()
            .to_string()
    });

    let repo_path_clone = repo_path.clone();
    tokio::task::spawn_blocking(move || git_manager::count_worktrees(&repo_path_clone, Some(&base_path)))
        .await
        .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Get diff stats (additions, deletions) for a single worktree. Lightweight — no config or status loading.
#[tauri::command]
pub async fn get_worktree_diff_stats(
    worktree_path: String,
    stack_parent: Option<String>,
) -> Result<(u32, u32)> {
    let parent = stack_parent;
    tokio::task::spawn_blocking(move || get_diff_stats(&worktree_path, parent.as_deref()))
        .await
        .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Get the current status of a specific worktree.
#[tauri::command]
pub async fn get_worktree_status(
    app: AppHandle,
    repo_path: String,
    worktree_name: String,
) -> Result<Worktree> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    let config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;

    // Resolve worktree path using configured base or repo parent
    let worktree_path = config
        .worktree_base_path
        .as_ref()
        .map(|p| std::path::Path::new(p).to_path_buf())
        .unwrap_or_else(|| {
            std::path::Path::new(&repo_path)
                .parent()
                .unwrap_or(std::path::Path::new(&repo_path))
                .to_path_buf()
        })
        .join(&worktree_name);

    let wt_name = worktree_name.clone();
    let wt_path_str = worktree_path.to_string_lossy().to_string();
    let status = tokio::task::spawn_blocking(move || git_manager::get_status(&wt_path_str))
        .await
        .map_err(|e| AppError::Git(format!("task join error: {e}")))?;

    let status = status?;

    let path_str = worktree_path.to_string_lossy().to_string();
    let diff_path = path_str.clone();
    let (additions, deletions) = tokio::task::spawn_blocking(move || get_diff_stats(&diff_path, None))
        .await
        .map_err(|e| AppError::Git(format!("task join error: {e}")))?
        .map(|(a, d)| (Some(a), Some(d)))
        .unwrap_or((None, None));

    // Determine column from config overrides or default
    let column = config_manager::get_column_override(&config, &wt_name)
        .unwrap_or(KanbanColumn::InProgress);

    let id = git_manager::worktree_id(&repo_path, &status.branch);
    let mut wt = Worktree {
        id,
        name: wt_name.clone(),
        path: path_str,
        branch: status.branch,
        repo_path,
        pr_status: None,
        agent_status: AgentState::NotRunning,
        column,
        is_branch_mode: config.branch_mode,
        additions,
        deletions,
        last_commit_epoch: None, // Will be populated by list_worktrees on next refresh
        last_commit_author: None,
        linear_ticket_url: None,
        linear_ticket_identifier: None,
        stack_parent: None,
        stack_children: vec![],
        stack_rebase_status: None,
        setup_script_error: None,
        setup_in_progress: false,
        assigned_port: None,
    };
    if config.auto_assign_ports {
        wt.assigned_port = config_manager::get_assigned_port(&config, &wt_name);
    }
    Ok(wt)
}

/// Count how many commits a worktree's branch is behind origin/main (or the stack parent).
#[tauri::command]
pub async fn get_commits_behind_main(
    worktree_path: String,
    stack_parent: Option<String>,
) -> Result<u32> {
    let parent = stack_parent;
    tokio::task::spawn_blocking(move || git_manager::commits_behind(&worktree_path, parent.as_deref()))
        .await
        .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Return (ahead, behind) for a worktree's branch vs its upstream tracking branch.
/// Returns None when no upstream is set. Triggers a throttled background fetch
/// keyed on `repo_path` (so N worktrees of one repo share one fetch every 30 s).
/// Set `force_fetch: true` to bypass the throttle — used for post-action
/// refetches that need fresh remote state immediately.
#[tauri::command]
pub async fn get_ahead_behind_origin(
    worktree_path: String,
    repo_path: String,
    force_fetch: Option<bool>,
) -> Result<Option<(u32, u32)>> {
    git_manager::fetch_upstream_throttled(&repo_path, force_fetch.unwrap_or(false)).await;
    let path = worktree_path.clone();
    tokio::task::spawn_blocking(move || git_manager::ahead_behind_vs_upstream(&path))
        .await
        .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Rebase a worktree's branch onto a target branch (or the default branch if None).
#[tauri::command]
pub async fn rebase_worktree(
    worktree_path: String,
    stack_parent: Option<String>,
) -> Result<()> {
    git_manager::rebase_onto(&worktree_path, stack_parent.as_deref()).await
}

/// Drop a single commit from a worktree's branch history (dirty-tree-safe).
#[tauri::command]
pub async fn drop_commit(worktree_path: String, commit_hash: String) -> Result<()> {
    git_manager::drop_commit(&worktree_path, &commit_hash).await
}

/// Whether a commit already exists on any remote-tracking branch.
#[tauri::command]
pub async fn is_commit_pushed(worktree_path: String, commit_hash: String) -> Result<bool> {
    git_manager::is_commit_pushed(&worktree_path, &commit_hash).await
}

/// Set or clear the stack parent for a worktree.
#[tauri::command]
pub async fn set_stack_parent(
    app: AppHandle,
    repo_path: String,
    worktree_name: String,
    parent_branch: Option<String>,
) -> Result<()> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    let mut config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    match parent_branch {
        Some(parent) => config_manager::set_stack_parent(&mut config, &worktree_name, &parent),
        None => config_manager::clear_stack_parent(&mut config, &worktree_name),
    }
    config_manager::save_config(&app_data_dir, &repo_path, &config).await?;
    Ok(())
}

/// Restack a single worktree onto its stack parent now.
#[tauri::command]
pub async fn restack_now(
    app: AppHandle,
    repo_path: String,
    worktree_name: String,
) -> Result<()> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    crate::stack_manager::restack_child(&app, &app_data_dir, &repo_path, &worktree_name)
        .await
        .map_err(AppError::Git)
}

/// Restack every stacked worktree of the repo in dependency order.
/// `worktree_name` is accepted for future scoping/API stability and to anchor
/// error messages — the cascade itself is repo-wide.
#[tauri::command]
pub async fn restack_stack(
    app: AppHandle,
    repo_path: String,
    worktree_name: String,
) -> Result<()> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    crate::stack_manager::restack_repo(&app, &app_data_dir, &repo_path)
        .await
        .map_err(|e| AppError::Git(format!("restack stack (from {worktree_name}): {e}")))
}

/// Migrate a worktree's stack base: rebase its own commits onto the new parent
/// (or the default branch when `new_parent` is None) and persist the change.
#[tauri::command]
pub async fn change_stack_base(
    app: AppHandle,
    repo_path: String,
    worktree_name: String,
    new_parent: Option<String>,
) -> Result<()> {
    let app_data_dir = resolve_app_data_dir(&app)?;
    crate::stack_manager::change_base(&app, &app_data_dir, &repo_path, &worktree_name, new_parent.as_deref())
        .await
        .map_err(AppError::Git)
}

/// Manually override a worktree's kanban column (e.g. drag to "Blocked").
#[tauri::command]
pub async fn set_worktree_column(
    app: AppHandle,
    port_lock: State<'_, PortConfigLock>,
    repo_path: String,
    worktree_name: String,
    column: KanbanColumn,
) -> Result<()> {
    // port_lock is held to serialize this command's whole-config save_config
    // against concurrent port claims/releases. Port release on Done now lives
    // in the frontend (releasePortFor, keyed on worktree id) — the backend
    // can't derive the id (`repo::branch`) from the worktree name alone.
    let _guard = port_lock.0.lock().await;
    let app_data_dir = resolve_app_data_dir(&app)?;
    let mut config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    config_manager::set_column_override(&mut config, &worktree_name, column);
    config_manager::save_config(&app_data_dir, &repo_path, &config).await?;
    Ok(())
}

/// Drop a worktree's persisted column override, reverting it to the auto-derived
/// kanban column. The PR sync calls this to self-heal a stale auto-Done when a
/// worktree's branch goes live again (reopened, or reused with a new PR).
#[tauri::command]
pub async fn clear_worktree_column(
    app: AppHandle,
    port_lock: State<'_, PortConfigLock>,
    repo_path: String,
    worktree_name: String,
) -> Result<()> {
    // Mirror set_worktree_column: hold port_lock to serialize the whole-config
    // save against concurrent port claims/releases.
    let _guard = port_lock.0.lock().await;
    let app_data_dir = resolve_app_data_dir(&app)?;
    let mut config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    config_manager::clear_column_override(&mut config, &worktree_name);
    config_manager::save_config(&app_data_dir, &repo_path, &config).await?;
    Ok(())
}

/// Claim a dev server port for a worktree. Returns the existing sticky port
/// if one is persisted, otherwise assigns the next free port from the global
/// range and persists it. Exhaustion is returned as `PortClaimResult::RangeFull`
/// (not an error) so the frontend can render a choice dialog.
#[tauri::command]
pub async fn claim_worktree_port(
    app: AppHandle,
    port_lock: State<'_, PortConfigLock>,
    repo_path: String,
    worktree_name: String,
) -> Result<PortClaimResult> {
    let _guard = port_lock.0.lock().await;
    let app_data_dir = resolve_app_data_dir(&app)?;

    // Read port range from effective config so alfredo.json values are visible.
    let effective = config_manager::load_effective_config(&app_data_dir, &repo_path).await?.effective;

    if !effective.auto_assign_ports {
        return Ok(PortClaimResult::Disabled);
    }

    // A missing or inverted range means the repo hasn't been configured yet —
    // treat as disabled. The settings UI prompts the user to fill in a range
    // when they flip the toggle on.
    let (range_start, range_end) = match (effective.port_range_start, effective.port_range_end) {
        (Some(s), Some(e)) if s <= e => (s, e),
        _ => return Ok(PortClaimResult::Disabled),
    };

    // Mutate personal config for port_assignments so save_config writes only
    // the personal layer (not inherited alfredo.json values).
    let mut config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;

    if let Some(port) = config_manager::get_assigned_port(&config, &worktree_name) {
        tracing::info!(key = %worktree_name, port, "[ports] claim: already assigned");
        return Ok(PortClaimResult::Assigned { port });
    }

    match config_manager::assign_next_port(&mut config, &worktree_name, range_start, range_end) {
        Some(port) => {
            config_manager::save_config(&app_data_dir, &repo_path, &config).await?;
            tracing::info!(key = %worktree_name, port, "[ports] claimed port");
            Ok(PortClaimResult::Assigned { port })
        }
        None => {
            tracing::warn!(key = %worktree_name, range_start, range_end, "[ports] claim: range full");
            let holders = config
                .port_assignments
                .iter()
                .filter(|(_, &p)| p >= range_start && p <= range_end)
                .map(|(name, &port)| PortHolder {
                    worktree_name: name.clone(),
                    port,
                })
                .collect();
            Ok(PortClaimResult::RangeFull {
                range_start,
                range_end,
                holders,
            })
        }
    }
}

/// Read-only lookup of the persisted port for a worktree. Returns `None` if
/// auto-assign is disabled, the range is unset, or no claim exists. Never
/// assigns — used on session spawn so opening a worktree never triggers the
/// exhaustion dialog (port claim moves to the explicit "Start server" path).
#[tauri::command]
pub async fn get_assigned_worktree_port(
    app: AppHandle,
    port_lock: State<'_, PortConfigLock>,
    repo_path: String,
    worktree_name: String,
) -> Result<Option<u16>> {
    let _guard = port_lock.0.lock().await;
    let app_data_dir = resolve_app_data_dir(&app)?;
    let config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    if !config.auto_assign_ports {
        return Ok(None);
    }
    Ok(config_manager::get_assigned_port(&config, &worktree_name))
}

/// Release a worktree's port assignment. Called from the exhaustion dialog
/// when the user frees up a slot to claim for a different worktree.
#[tauri::command]
pub async fn release_worktree_port(
    app: AppHandle,
    port_lock: State<'_, PortConfigLock>,
    repo_path: String,
    worktree_name: String,
) -> Result<()> {
    let _guard = port_lock.0.lock().await;
    let app_data_dir = resolve_app_data_dir(&app)?;
    let mut config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    match config_manager::release_port(&mut config, &worktree_name) {
        Some(port) => tracing::info!(key = %worktree_name, port, "[ports] released assignment"),
        None => tracing::info!(key = %worktree_name, "[ports] release: no assignment found for key"),
    }
    config_manager::save_config(&app_data_dir, &repo_path, &config).await?;
    Ok(())
}

/// Drop port assignments whose worktree no longer exists. Enumerates git
/// worktrees *without* the base-path filter (so a worktree outside the
/// configured base is still treated as live and never pruned), then removes
/// any `port_assignments` key not in that set. Returns the pruned keys.
///
/// Only mutates on a successful enumeration — a transient git error returns
/// `Err` and frees nothing. Called once per repo on load; also clears
/// assignments orphaned before the release-key fix landed.
#[tauri::command]
pub async fn reconcile_worktree_ports(
    app: AppHandle,
    port_lock: State<'_, PortConfigLock>,
    repo_path: String,
) -> Result<Vec<String>> {
    let _guard = port_lock.0.lock().await;
    let app_data_dir = resolve_app_data_dir(&app)?;

    let repo = repo_path.clone();
    let worktrees =
        tokio::task::spawn_blocking(move || git_manager::list_worktrees(&repo, None))
            .await
            .map_err(|e| AppError::Git(format!("task join error: {e}")))??;
    let live_ids: std::collections::HashSet<String> =
        worktrees.into_iter().map(|wt| wt.id).collect();

    let mut config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    let pruned = config_manager::prune_orphan_ports(&mut config, &live_ids);
    if !pruned.is_empty() {
        config_manager::save_config(&app_data_dir, &repo_path, &config).await?;
        tracing::info!(count = pruned.len(), keys = ?pruned, "[ports] reconcile pruned orphan assignments");
    }
    Ok(pruned)
}

/// Atomically reassign a specific port to a worktree, releasing whichever
/// worktree currently holds it (if any). Used by the port picker when the
/// user explicitly takes a port. Returns the previous holder's name so the
/// frontend can stop their dev server and surface an Undo affordance.
///
/// Validates that the port falls within the configured range. Returns
/// `Disabled` if auto-assign is off or the range is unset, mirroring
/// `claim_worktree_port`'s contract so the frontend has a single shape to
/// branch on.
#[tauri::command]
pub async fn take_worktree_port(
    app: AppHandle,
    port_lock: State<'_, PortConfigLock>,
    repo_path: String,
    worktree_name: String,
    port: u16,
) -> Result<TakePortResult> {
    let _guard = port_lock.0.lock().await;
    let app_data_dir = resolve_app_data_dir(&app)?;

    // Read port range from effective config so alfredo.json values are visible.
    let effective = config_manager::load_effective_config(&app_data_dir, &repo_path).await?.effective;

    if !effective.auto_assign_ports {
        return Ok(TakePortResult::Disabled);
    }

    let (range_start, range_end) = match (effective.port_range_start, effective.port_range_end) {
        (Some(s), Some(e)) if s <= e => (s, e),
        _ => return Ok(TakePortResult::Disabled),
    };

    // Mutate personal config for port_assignments so save_config writes only
    // the personal layer (not inherited alfredo.json values).
    let mut config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;

    if port < range_start || port > range_end {
        return Err(AppError::Config(format!(
            "Port {port} is outside the configured range {range_start}–{range_end}"
        )));
    }

    let previous_holder: Option<String> = config
        .port_assignments
        .iter()
        .find(|(name, &p)| p == port && name.as_str() != worktree_name)
        .map(|(name, _)| name.clone());

    if let Some(ref name) = previous_holder {
        config_manager::release_port(&mut config, name);
    }
    // Drop any other port currently held by the target so they don't end up
    // with two assignments. release_port is a no-op when nothing's held.
    config_manager::release_port(&mut config, &worktree_name);
    config
        .port_assignments
        .insert(worktree_name.clone(), port);

    config_manager::save_config(&app_data_dir, &repo_path, &config).await?;
    tracing::info!(key = %worktree_name, port, previous_holder = ?previous_holder, "[ports] took port");
    Ok(TakePortResult::Taken {
        port,
        previous_holder,
    })
}

/// Create a worktree from a Linear ticket, injecting ticket context.
async fn create_worktree_from_linear(app: &AppHandle, repo_path: String, issue_id: &str, base_override: Option<String>) -> Result<Worktree> {
    // 1. Resolve Linear API token (OAuth first, then config fallback)
    let app_data = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))?;
    let api_key = linear_manager::resolve_token(&app_data, &repo_path).await?;

    // 2. Fetch full ticket details
    let ticket = linear_manager::get_issue(&api_key, issue_id).await?;

    // 3. Use Linear's branchName field (matches "Copy git branch name" exactly),
    //    falling back to {identifier}-{slugified-title} if unavailable.
    let branch_name = ticket.branch_name.clone().unwrap_or_else(|| {
        let slug = linear_manager::slugify(&ticket.title);
        format!("{}-{}", ticket.identifier.to_lowercase(), slug)
    });

    // 4. Create the worktree from the specified base (or repo's default branch)
    let base_branch = match base_override {
        Some(b) if !b.is_empty() => b,
        _ => crate::commands::diff::get_default_branch(repo_path.clone()).await?,
    };
    let mut worktree = create_worktree(app.clone(), repo_path.clone(), branch_name.clone(), base_branch).await?;

    // 4b. Attach Linear ticket metadata so the frontend can link back
    worktree.linear_ticket_url = Some(ticket.url.clone());
    worktree.linear_ticket_identifier = Some(ticket.identifier.clone());

    // 4c. Persist to repo config so the metadata survives app restart. The
    // worktree itself is already on disk; a persistence failure here (e.g.
    // keychain hiccup inside save_config) would otherwise leave the user with
    // a created worktree *and* an error — so we log and continue. On next
    // successful save the in-memory fields still light up the StatusBar for
    // the current session.
    if let Ok(app_data_dir) = resolve_app_data_dir(app) {
        if let Ok(mut config) = config_manager::load_personal_config(&app_data_dir, &repo_path).await {
            config_manager::set_linear_ticket(
                &mut config,
                &worktree.name,
                crate::types::LinearTicketRef {
                    url: ticket.url.clone(),
                    identifier: ticket.identifier.clone(),
                },
            );
            if let Err(e) = config_manager::save_config(&app_data_dir, &repo_path, &config).await {
                eprintln!("warning: failed to persist linear ticket metadata for {}: {e}", worktree.name);
            }
        }
    }

    // 5. Inject .claude/CLAUDE.local.md into the worktree so Claude Code
    //    automatically picks up the ticket context at conversation start.
    let claude_dir = std::path::Path::new(&worktree.path).join(".claude");
    tokio::fs::create_dir_all(&claude_dir)
        .await
        .map_err(|e| AppError::Linear(format!("failed to create .claude dir: {e}")))?;

    let context_md = linear_manager::generate_context_md(&ticket);
    tokio::fs::write(claude_dir.join("CLAUDE.local.md"), context_md)
        .await
        .map_err(|e| AppError::Linear(format!("failed to write CLAUDE.local.md: {e}")))?;

    // Also seed default slash commands for the Linear-created worktree.
    // Idempotent — `create_worktree` above already wrote them, but call again
    // to keep the two creation paths visibly symmetrical.
    write_default_slash_commands(&worktree.path).await;

    Ok(worktree)
}

/// Persist a Linear ticket link for an already-created worktree so the StatusBar
/// chip shows and survives restart. Pure persistence: the caller (the Linear
/// "open issue" flow) has already fetched the ticket, so this never touches the
/// Linear API and can't fail the worktree just because Linear is unreachable.
#[tauri::command]
pub async fn set_worktree_linear_ticket(
    app: AppHandle,
    port_lock: State<'_, PortConfigLock>,
    repo_path: String,
    worktree_name: String,
    url: String,
    identifier: String,
) -> Result<()> {
    // Mirror set_worktree_column: hold port_lock to serialize the whole-config
    // save against concurrent port claims/releases — this fires from the Linear
    // open-issue flow right when the fresh worktree may be claiming a port.
    let _guard = port_lock.0.lock().await;
    let app_data_dir = resolve_app_data_dir(&app)?;
    let mut config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    config_manager::set_linear_ticket(
        &mut config,
        &worktree_name,
        crate::types::LinearTicketRef { url, identifier },
    );
    config_manager::save_config(&app_data_dir, &repo_path, &config).await?;
    Ok(())
}

/// Create a worktree from a GitHub pull request by fetching the PR's head branch.
async fn create_worktree_from_pr(app: &AppHandle, repo_path: String, pr_number: u64) -> Result<Worktree> {
    // 1. Get GitHub token (gh CLI or config)
    let app_data_dir = resolve_app_data_dir(app)?;
    let config = config_manager::load_personal_config(&app_data_dir, &repo_path).await?;
    let token = crate::github_manager::resolve_token(config.github_token.as_deref()).await?;

    // 2. Resolve owner/repo from git remote
    let (owner, repo) = github_manager::resolve_owner_repo(&repo_path).await?;

    // 3. Fetch the PR to get the head branch name
    let manager = GithubManager::shared(&token)?;
    let prs = manager.sync_prs(&owner, &repo).await?;
    let pr = prs
        .iter()
        .find(|p| p.number == pr_number)
        .ok_or_else(|| AppError::Github(format!("PR #{pr_number} not found")))?;

    let branch_name = pr.branch.clone();
    let default_branch = git_manager::resolve_default_remote_branch(&repo_path);
    let default_short = default_branch.strip_prefix("origin/").unwrap_or(&default_branch).to_string();
    let base = pr.base_branch.clone().unwrap_or(default_short);

    // 4. Defensive check: bail if a worktree already tracks this branch.
    // Frontend normally intercepts via the picker, but a direct caller hitting
    // this path would otherwise fail later with a confusing libgit2 error.
    let base_path = config.worktree_base_path.clone().unwrap_or_else(|| {
        std::path::Path::new(&repo_path)
            .parent()
            .unwrap_or(std::path::Path::new(&repo_path))
            .to_string_lossy()
            .to_string()
    });
    let repo_path_clone = repo_path.clone();
    let base_path_clone = base_path.clone();
    let existing = tokio::task::spawn_blocking(move || {
        git_manager::list_worktrees(&repo_path_clone, Some(&base_path_clone))
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))??;
    if existing.iter().any(|wt| wt.branch == branch_name) {
        return Err(AppError::Git(format!(
            "branch '{branch_name}' already has a worktree — open it from the sidebar, \
             or delete it first to re-import this PR"
        )));
    }

    // 5. Fetch the branch from remote so it's available locally
    let fetch_output = git_command()
        .args(["fetch", "origin", &format!("{branch_name}:{branch_name}")])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to fetch PR branch: {e}")))?;

    if !fetch_output.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_output.stderr);
        let lower = stderr.to_lowercase();
        if lower.contains("[rejected]") && lower.contains("non-fast-forward") {
            return Err(AppError::Git(format!(
                "branch '{branch_name}' diverged from origin — delete the existing \
                 worktree first to re-import this PR"
            )));
        }
        return Err(AppError::Git(format!(
            "failed to fetch PR branch: {}",
            stderr.trim()
        )));
    }

    // 6. Create the worktree from the PR's head branch, using the PR's base for stack detection
    create_worktree(app.clone(), repo_path, branch_name, base).await
}

/// Resolve `app_data_dir` from an `AppHandle`.
fn resolve_app_data_dir(app: &AppHandle) -> Result<PathBuf> {
    app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))
}

/// Seed a newly created worktree with Alfredo's default slash commands under
/// `.claude/commands/`. Failures are non-fatal — the worktree is already usable
/// without these helpers, so we just log and move on.
async fn write_default_slash_commands(worktree_path: &str) {
    let commands_dir = std::path::Path::new(worktree_path)
        .join(".claude")
        .join("commands");

    if let Err(e) = tokio::fs::create_dir_all(&commands_dir).await {
        eprintln!(
            "[alfredo] failed to create slash commands dir at {}: {e}",
            commands_dir.display()
        );
        return;
    }

    let files = [
        ("ci-failure.md", DEFAULT_CI_FAILURE_CMD),
        ("investigate-log.md", DEFAULT_INVESTIGATE_LOG_CMD),
        ("diff-summary.md", DEFAULT_DIFF_SUMMARY_CMD),
    ];

    for (name, contents) in &files {
        let path = commands_dir.join(name);
        if let Err(e) = tokio::fs::write(&path, contents).await {
            eprintln!(
                "[alfredo] failed to write default slash command {}: {e}",
                path.display()
            );
        }
    }
}

/// Ensure the repo's `.git/info/exclude` contains entries for AI tool artifacts
/// that Alfredo injects into worktrees (CLAUDE.local.md, settings.local.json).
/// These should never appear as uncommitted changes in the UI.
async fn ensure_claude_excludes(repo_path: &str) {
    let exclude_path = std::path::Path::new(repo_path)
        .join(".git")
        .join("info")
        .join("exclude");

    let entries = [
        ".claude/CLAUDE.local.md",
        ".claude/settings.local.json",
        ".claude/commands/",
    ];

    let existing = tokio::fs::read_to_string(&exclude_path)
        .await
        .unwrap_or_default();

    let missing: Vec<&str> = entries
        .iter()
        .filter(|e| !existing.lines().any(|line| line.trim() == **e))
        .copied()
        .collect();

    if missing.is_empty() {
        return;
    }

    let mut append = String::new();
    if !existing.is_empty() && !existing.ends_with('\n') {
        append.push('\n');
    }
    if !existing.contains("# Alfredo AI tool artifacts") {
        append.push_str("\n# Alfredo AI tool artifacts\n");
    }
    for entry in &missing {
        append.push_str(entry);
        append.push('\n');
    }

    if let Some(parent) = exclude_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    if let Err(e) = tokio::fs::write(&exclude_path, format!("{existing}{append}")).await {
        eprintln!(
            "[alfredo] failed to update git excludes at {}: {e}",
            exclude_path.display()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_stacked_branch ──────────────────────────────────────

    #[test]
    fn not_stacked_when_base_is_default_short() {
        assert!(!is_stacked_branch("main", "origin/main", "feature-1"));
    }

    #[test]
    fn not_stacked_when_base_is_default_remote() {
        assert!(!is_stacked_branch("origin/main", "origin/main", "feature-1"));
    }

    #[test]
    fn not_stacked_when_base_equals_branch() {
        assert!(!is_stacked_branch("feature-1", "origin/main", "feature-1"));
    }

    #[test]
    fn not_stacked_when_base_empty() {
        assert!(!is_stacked_branch("", "origin/main", "feature-1"));
    }

    #[test]
    fn stacked_when_base_is_different_feature() {
        assert!(is_stacked_branch("feature-base", "origin/main", "feature-child"));
    }

    #[test]
    fn stacked_with_develop_default() {
        assert!(is_stacked_branch("feature-1", "origin/develop", "feature-2"));
    }

    // ── ensure_claude_excludes ─────────────────────────────────

    #[tokio::test]
    async fn adds_exclude_entries_to_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path().to_str().unwrap();

        let info_dir = dir.path().join(".git").join("info");
        std::fs::create_dir_all(&info_dir).unwrap();
        std::fs::write(info_dir.join("exclude"), "").unwrap();

        ensure_claude_excludes(repo_path).await;

        let content = std::fs::read_to_string(info_dir.join("exclude")).unwrap();
        assert!(content.contains(".claude/CLAUDE.local.md"));
        assert!(content.contains(".claude/settings.local.json"));
    }

    #[tokio::test]
    async fn does_not_duplicate_entries() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path().to_str().unwrap();

        let info_dir = dir.path().join(".git").join("info");
        std::fs::create_dir_all(&info_dir).unwrap();
        std::fs::write(info_dir.join("exclude"), "").unwrap();

        ensure_claude_excludes(repo_path).await;
        ensure_claude_excludes(repo_path).await;

        let content = std::fs::read_to_string(info_dir.join("exclude")).unwrap();
        let count = content.matches(".claude/CLAUDE.local.md").count();
        assert_eq!(count, 1, "entry should appear exactly once");
    }

    #[tokio::test]
    async fn preserves_existing_content() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path().to_str().unwrap();

        let info_dir = dir.path().join(".git").join("info");
        std::fs::create_dir_all(&info_dir).unwrap();
        std::fs::write(info_dir.join("exclude"), "*.log\n").unwrap();

        ensure_claude_excludes(repo_path).await;

        let content = std::fs::read_to_string(info_dir.join("exclude")).unwrap();
        assert!(content.contains("*.log"));
        assert!(content.contains(".claude/CLAUDE.local.md"));
    }

    #[tokio::test]
    async fn handles_file_without_trailing_newline() {
        let dir = tempfile::tempdir().unwrap();
        let repo_path = dir.path().to_str().unwrap();

        let info_dir = dir.path().join(".git").join("info");
        std::fs::create_dir_all(&info_dir).unwrap();
        std::fs::write(info_dir.join("exclude"), "*.log").unwrap();

        ensure_claude_excludes(repo_path).await;

        let content = std::fs::read_to_string(info_dir.join("exclude")).unwrap();
        assert!(content.contains("*.log"));
        assert!(content.contains(".claude/CLAUDE.local.md"));
        // Should have a newline between existing and new content
        assert!(!content.contains("*.log.claude"));
    }
}

