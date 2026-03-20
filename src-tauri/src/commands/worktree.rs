use crate::config_manager;
use crate::git_manager;
use crate::github_manager::GithubManager;
use crate::linear_manager;
use crate::types::{AgentState, AppError, KanbanColumn, Worktree, WorktreeSource};

type Result<T> = std::result::Result<T, AppError>;

/// Create a worktree from any supported source (branch, PR, Linear ticket).
#[tauri::command]
pub async fn create_worktree_from(
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
            create_worktree_from_linear(repo_path, &id).await
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
    let worktree_path =
        git_manager::create_worktree(&repo_path, &branch_name, &base_branch).await?;

    let path_str = worktree_path.to_string_lossy().to_string();

    // Run setup scripts if configured
    let config = config_manager::load_config(&repo_path).await?;
    let create_scripts: Vec<_> = config
        .setup_scripts
        .iter()
        .filter(|s| s.run_on == "create")
        .cloned()
        .collect();
    if !create_scripts.is_empty() {
        config_manager::run_setup_scripts(&path_str, &create_scripts).await?;
    }

    Ok(Worktree {
        id: branch_name.clone(),
        name: branch_name.clone(),
        path: path_str,
        branch: branch_name,
        pr_status: None,
        agent_status: AgentState::NotRunning,
        column: KanbanColumn::InProgress,
        is_branch_mode: config.branch_mode,
    })
}

/// Delete a worktree by name.
#[tauri::command]
pub async fn delete_worktree(repo_path: String, worktree_name: String) -> Result<()> {
    git_manager::delete_worktree(&repo_path, &worktree_name).await
}

/// List all worktrees for a repository.
#[tauri::command]
pub async fn list_worktrees(repo_path: String) -> Result<Vec<Worktree>> {
    // git2 operations are blocking — run on a blocking thread
    let worktrees =
        tokio::task::spawn_blocking(move || git_manager::list_worktrees(&repo_path))
            .await
            .map_err(|e| AppError::Git(format!("task join error: {e}")))?;

    worktrees
}

/// Get the current status of a specific worktree.
#[tauri::command]
pub async fn get_worktree_status(
    repo_path: String,
    worktree_name: String,
) -> Result<Worktree> {
    let config = config_manager::load_config(&repo_path).await?;

    // Resolve worktree path
    let worktree_path = std::path::Path::new(&repo_path)
        .parent()
        .unwrap_or(std::path::Path::new(&repo_path))
        .join(&worktree_name);
    let wt_path_str = worktree_path.to_string_lossy().to_string();

    let wt_name = worktree_name.clone();
    let status = tokio::task::spawn_blocking(move || git_manager::get_status(&wt_path_str))
        .await
        .map_err(|e| AppError::Git(format!("task join error: {e}")))?;

    let status = status?;

    // Determine column from config overrides or default
    let column = config_manager::get_column_override(&config, &wt_name)
        .unwrap_or(KanbanColumn::InProgress);

    Ok(Worktree {
        id: wt_name.clone(),
        name: wt_name,
        path: worktree_path.to_string_lossy().to_string(),
        branch: status.branch,
        pr_status: None,
        agent_status: AgentState::NotRunning,
        column,
        is_branch_mode: config.branch_mode,
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
async fn create_worktree_from_linear(repo_path: String, issue_id: &str) -> Result<Worktree> {
    // 1. Get API key from config
    let config = config_manager::load_config(&repo_path).await?;
    let api_key = config
        .linear_api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| {
            AppError::Linear(
                "Linear API key not configured. Add it in Settings > Integrations.".into(),
            )
        })?;

    // 2. Fetch full ticket details
    let ticket = linear_manager::get_issue(&api_key, issue_id).await?;

    // 3. Build branch name: {identifier}-{slugified-title}
    let slug = linear_manager::slugify(&ticket.title);
    let branch_name = format!(
        "{}-{}",
        ticket.identifier.to_lowercase(),
        slug
    );

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
    // 1. Get GitHub token from config
    let config = config_manager::load_config(&repo_path).await?;
    let token = config
        .github_token
        .filter(|t| !t.is_empty())
        .ok_or_else(|| {
            AppError::Github(
                "GitHub token not configured. Add it in Settings > Integrations.".into(),
            )
        })?;

    // 2. Resolve owner/repo from git remote
    let output = tokio::process::Command::new("git")
        .args(["remote", "get-url", "origin"])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| AppError::Github(format!("failed to get remote URL: {e}")))?;

    if !output.status.success() {
        return Err(AppError::Github("no origin remote found".into()));
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let (owner, repo) = parse_github_owner_repo(&url)
        .ok_or_else(|| AppError::Github(format!("could not parse owner/repo from: {url}")))?;

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

/// Extract owner and repo from a GitHub URL (HTTPS or SSH).
fn parse_github_owner_repo(url: &str) -> Option<(String, String)> {
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
