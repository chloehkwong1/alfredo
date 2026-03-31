use tauri::{AppHandle, Manager};

use crate::config_manager;
use crate::git_manager;
use crate::git_manager::get_diff_stats;
use crate::github_manager::{self, GithubManager};
use crate::linear_manager;
use crate::types::{AgentState, AppError, KanbanColumn, Worktree, WorktreeSource};

type Result<T> = std::result::Result<T, AppError>;

/// Create a worktree from any supported source (branch, PR, Linear ticket).
#[tauri::command]
pub async fn create_worktree_from(
    app: AppHandle,
    repo_path: String,
    source: WorktreeSource,
) -> Result<Worktree> {
    match source {
        WorktreeSource::NewBranch { name, base } => {
            create_worktree(repo_path, name, base).await
        }
        WorktreeSource::ExistingBranch { name } => {
            // For an existing branch, use it as both branch and base
            // (git worktree add will check it out)
            create_worktree(repo_path, name.clone(), name).await
        }
        WorktreeSource::PullRequest { number } => {
            create_worktree_from_pr(repo_path, number).await
        }
        WorktreeSource::LinearTicket { id } => {
            create_worktree_from_linear(&app, repo_path, &id).await
        }
    }
}

/// Create a worktree with an explicit branch name and base.
#[tauri::command]
pub async fn create_worktree(
    repo_path: String,
    branch_name: String,
    base_branch: String,
) -> Result<Worktree> {
    let config = config_manager::load_config(&repo_path).await?;
    let base_path = config.worktree_base_path.as_deref();

    let worktree_path =
        git_manager::create_worktree(&repo_path, &branch_name, &base_branch, base_path).await?;

    // Ensure .claude/context.md and .claude/settings.local.json are in git
    // excludes so they don't show as uncommitted changes in the UI.
    ensure_claude_excludes(&repo_path).await;

    let path_str = worktree_path.to_string_lossy().to_string();
    let create_scripts: Vec<_> = config
        .setup_scripts
        .iter()
        .filter(|s| s.run_on == "create")
        .cloned()
        .collect();
    if !create_scripts.is_empty() {
        config_manager::run_setup_scripts(&path_str, &create_scripts).await?;
    }

    // Use the sanitized directory name as the ID/name so it matches
    // what list_worktrees returns (git uses the dir name internally).
    let dir_name = branch_name.replace('/', "-");
    Ok(Worktree {
        id: dir_name.clone(),
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
    })
}

/// Delete a worktree by name.
#[tauri::command]
pub async fn delete_worktree(
    repo_path: String,
    worktree_name: String,
    force: bool,
) -> Result<()> {
    let config = config_manager::load_config(&repo_path).await?;
    let base_path = config.worktree_base_path.as_deref();
    git_manager::delete_worktree(&repo_path, &worktree_name, force, base_path).await
}

/// List all worktrees for a repository, filtered to the configured base path
/// (or repo parent directory if not configured).
#[tauri::command]
pub async fn list_worktrees(repo_path: String) -> Result<Vec<Worktree>> {
    let config = config_manager::load_config(&repo_path).await?;
    let base_path = config.worktree_base_path.clone().unwrap_or_else(|| {
        std::path::Path::new(&repo_path)
            .parent()
            .unwrap_or(std::path::Path::new(&repo_path))
            .to_string_lossy()
            .to_string()
    });

    // git2 operations are blocking — run on a blocking thread
    let worktrees =
        tokio::task::spawn_blocking(move || git_manager::list_worktrees(&repo_path, Some(&base_path)))
            .await
            .map_err(|e| AppError::Git(format!("task join error: {e}")))?;

    // Apply persisted column overrides from .alfredo.json so worktrees
    // arrive on the frontend with the correct kanban column immediately.
    worktrees.map(|mut wts| {
        for wt in &mut wts {
            if let Some(col) = config_manager::get_column_override(&config, &wt.name) {
                wt.column = col;
            }
        }
        wts
    })
}

/// Get diff stats (additions, deletions) for a single worktree. Lightweight — no config or status loading.
#[tauri::command]
pub async fn get_worktree_diff_stats(worktree_path: String) -> Result<(u32, u32)> {
    tokio::task::spawn_blocking(move || get_diff_stats(&worktree_path))
        .await
        .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Get the current status of a specific worktree.
#[tauri::command]
pub async fn get_worktree_status(
    repo_path: String,
    worktree_name: String,
) -> Result<Worktree> {
    let config = config_manager::load_config(&repo_path).await?;

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
    let (additions, deletions) = match get_diff_stats(&path_str) {
        Ok((a, d)) => (Some(a), Some(d)),
        Err(_) => (None, None),
    };

    // Determine column from config overrides or default
    let column = config_manager::get_column_override(&config, &wt_name)
        .unwrap_or(KanbanColumn::InProgress);

    Ok(Worktree {
        id: wt_name.clone(),
        name: wt_name,
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
    })
}

/// Manually override a worktree's kanban column (e.g. drag to "Blocked").
#[tauri::command]
pub async fn set_worktree_column(
    repo_path: String,
    worktree_name: String,
    column: KanbanColumn,
) -> Result<()> {
    let mut config = config_manager::load_config(&repo_path).await?;
    config_manager::set_column_override(&mut config, &worktree_name, column);
    config_manager::save_config(&repo_path, &config).await?;
    Ok(())
}

/// Create a worktree from a Linear ticket, injecting ticket context.
async fn create_worktree_from_linear(app: &AppHandle, repo_path: String, issue_id: &str) -> Result<Worktree> {
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

    // 4. Create the worktree
    let worktree = create_worktree(repo_path, branch_name.clone(), "main".into()).await?;

    // 5. Inject .claude/context.md into the worktree
    let claude_dir = std::path::Path::new(&worktree.path).join(".claude");
    tokio::fs::create_dir_all(&claude_dir)
        .await
        .map_err(|e| AppError::Linear(format!("failed to create .claude dir: {e}")))?;

    let context_md = linear_manager::generate_context_md(&ticket);
    tokio::fs::write(claude_dir.join("context.md"), context_md)
        .await
        .map_err(|e| AppError::Linear(format!("failed to write context.md: {e}")))?;

    Ok(worktree)
}

/// Create a worktree from a GitHub pull request by fetching the PR's head branch.
async fn create_worktree_from_pr(repo_path: String, pr_number: u64) -> Result<Worktree> {
    // 1. Get GitHub token (gh CLI or config)
    let config = config_manager::load_config(&repo_path).await?;
    let token = crate::github_manager::resolve_token(config.github_token.as_deref()).await?;

    // 2. Resolve owner/repo from git remote
    let (owner, repo) = github_manager::resolve_owner_repo(&repo_path).await?;

    // 3. Fetch the PR to get the head branch name
    let manager = GithubManager::new(&token)?;
    let prs = manager.sync_prs(&owner, &repo).await?;
    let pr = prs
        .iter()
        .find(|p| p.number == pr_number)
        .ok_or_else(|| AppError::Github(format!("PR #{pr_number} not found")))?;

    let branch_name = pr.branch.clone();

    // 4. Fetch the branch from remote so it's available locally
    let fetch_output = tokio::process::Command::new("git")
        .args(["fetch", "origin", &format!("{branch_name}:{branch_name}")])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to fetch PR branch: {e}")))?;

    // Ignore fetch errors if branch already exists locally
    let _ = fetch_output;

    // 5. Create the worktree from the PR's head branch
    create_worktree(repo_path, branch_name.clone(), branch_name).await
}

/// Ensure the repo's `.git/info/exclude` contains entries for AI tool artifacts
/// that Alfredo injects into worktrees (context.md, settings.local.json).
/// These should never appear as uncommitted changes in the UI.
async fn ensure_claude_excludes(repo_path: &str) {
    let exclude_path = std::path::Path::new(repo_path)
        .join(".git")
        .join("info")
        .join("exclude");

    let entries = [".claude/context.md", ".claude/settings.local.json"];

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

