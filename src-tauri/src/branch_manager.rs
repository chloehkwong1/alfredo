use git2::Repository;

use crate::git_manager::git_command;
use crate::types::{AgentState, AppError, KanbanColumn, Worktree};

/// Check if a branch's last commit was authored by the local git user.
fn is_my_branch(worktree: &Worktree, git_user: Option<&str>) -> bool {
    match (worktree.last_commit_author.as_deref(), git_user) {
        (Some(author), Some(user)) => author.eq_ignore_ascii_case(user),
        _ => false,
    }
}

/// List local branches, returning them as Worktree structs with `is_branch_mode: true`.
/// The currently checked-out branch is marked by having its name match `active_branch`.
pub fn list_branches(repo_path: &str, include_default_branches: bool) -> Result<(Vec<Worktree>, Option<String>), AppError> {
    let repo = Repository::open(repo_path)
        .map_err(|e| AppError::Git(format!("failed to open repo: {e}")))?;

    let branches = repo
        .branches(Some(git2::BranchType::Local))
        .map_err(|e| AppError::Git(format!("failed to list branches: {e}")))?;

    // Determine the current HEAD branch
    let active_branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(std::string::ToString::to_string));

    let mut worktrees = Vec::new();

    for branch_result in branches {
        let (branch, _) = branch_result
            .map_err(|e| AppError::Git(format!("failed to read branch: {e}")))?;

        let name = branch
            .name()
            .map_err(|e| AppError::Git(format!("failed to get branch name: {e}")))?
            .unwrap_or("unknown")
            .to_string();

        let (last_commit_epoch, last_commit_author) = branch
            .get()
            .peel_to_commit()
            .ok()
            .map(|c| (Some(c.time().seconds() * 1000), c.author().name().map(String::from)))
            .unwrap_or((None, None));

        worktrees.push(Worktree {
            id: format!("branch-{name}"),
            name: name.clone(),
            path: repo_path.to_string(),
            branch: name,
            repo_path: repo_path.to_string(),
            pr_status: None,
            agent_status: AgentState::NotRunning,
            column: KanbanColumn::InProgress,
            is_branch_mode: true,
            additions: None,
            deletions: None,
            last_commit_epoch,
            last_commit_author,
            linear_ticket_url: None,
            linear_ticket_identifier: None,
            stack_parent: None,
            stack_children: vec![],
            stack_rebase_status: None,
        });
    }

    // Read the local git user name for "my branches" prioritization
    let git_user = repo
        .config()
        .ok()
        .and_then(|c| c.get_string("user.name").ok());

    // Filter out default branches (main/master) — not useful as worktree sources,
    // but keep them when listing for the base branch picker.
    if !include_default_branches {
        worktrees.retain(|w| w.branch != "main" && w.branch != "master");
    }

    // Sort: my branches first (by last commit author), then by recency
    worktrees.sort_by(|a, b| {
        let a_mine = is_my_branch(a, git_user.as_deref());
        let b_mine = is_my_branch(b, git_user.as_deref());
        b_mine.cmp(&a_mine).then_with(|| {
            // Within same group, sort by last_commit_epoch descending
            b.last_commit_epoch.cmp(&a.last_commit_epoch)
        })
    });

    Ok((worktrees, active_branch))
}

/// Create a new branch and check it out via git CLI.
pub async fn create_branch(
    repo_path: &str,
    branch_name: &str,
    base_branch: &str,
) -> Result<Worktree, AppError> {
    // Create the branch from base
    let output = git_command()
        .args(["checkout", "-b", branch_name, base_branch])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!(
            "git checkout -b failed: {stderr}"
        )));
    }

    Ok(Worktree {
        id: format!("branch-{branch_name}"),
        name: branch_name.to_string(),
        path: repo_path.to_string(),
        branch: branch_name.to_string(),
        repo_path: repo_path.to_string(),
        pr_status: None,
        agent_status: AgentState::NotRunning,
        column: KanbanColumn::InProgress,
        is_branch_mode: true,
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
        stack_parent: None,
        stack_children: vec![],
        stack_rebase_status: None,
    })
}

/// Switch to an existing branch via git checkout.
/// Checks for dirty state first and returns an error if the working tree is dirty.
pub async fn switch_branch(repo_path: &str, branch_name: &str) -> Result<(), AppError> {
    // Check for dirty state using git2
    let is_dirty = {
        let repo = Repository::open(repo_path)
            .map_err(|e| AppError::Git(format!("failed to open repo: {e}")))?;

        let statuses = repo
            .statuses(None)
            .map_err(|e| AppError::Git(format!("failed to get status: {e}")))?;

        !statuses.is_empty()
    };

    if is_dirty {
        return Err(AppError::Git(
            "Working tree has uncommitted changes. Commit or stash them before switching branches."
                .to_string(),
        ));
    }

    let output = git_command()
        .args(["checkout", branch_name])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("git checkout failed: {stderr}")));
    }

    Ok(())
}

/// Delete a local branch via git CLI.
/// Refuses to delete the currently checked-out branch.
pub async fn delete_branch(repo_path: &str, branch_name: &str) -> Result<(), AppError> {
    let output = git_command()
        .args(["branch", "-d", branch_name])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("git branch -d failed: {stderr}")));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    fn init_test_repo() -> Result<TempDir, Box<dyn std::error::Error>> {
        let dir = TempDir::new()?;
        let path = dir.path();
        StdCommand::new("git")
            .args(["init"])
            .current_dir(path)
            .output()?;
        StdCommand::new("git")
            .args(["commit", "--allow-empty", "-m", "init"])
            .current_dir(path)
            .output()?;
        Ok(dir)
    }

    #[test]
    fn test_list_branches() -> Result<(), Box<dyn std::error::Error>> {
        let dir = init_test_repo()?;
        let path = dir.path().to_str().ok_or("non-UTF-8 temp path")?;

        // Create a non-default branch so we have something after filtering
        StdCommand::new("git")
            .args(["checkout", "-b", "feat-smoke"])
            .current_dir(path)
            .output()?;
        StdCommand::new("git")
            .args(["commit", "--allow-empty", "-m", "smoke"])
            .current_dir(path)
            .output()?;

        let (branches, active) = list_branches(path, false)?;
        // main/master are filtered; we should have feat-smoke
        assert!(!branches.is_empty());
        assert!(active.is_some());
        // main/master must not appear
        assert!(branches.iter().all(|b| b.branch != "main" && b.branch != "master"));
        // All branches should be in branch mode
        for b in &branches {
            assert!(b.is_branch_mode);
        }
        Ok(())
    }

    #[test]
    fn test_sort_branches_mine_first_and_filters_default() -> Result<(), Box<dyn std::error::Error>> {
        let dir = init_test_repo()?;
        let path = dir.path().to_str().ok_or("non-UTF-8 temp path")?;

        // Create additional branches with commits
        StdCommand::new("git")
            .args(["checkout", "-b", "feat-old"])
            .current_dir(path)
            .output()?;
        StdCommand::new("git")
            .args(["commit", "--allow-empty", "-m", "old work"])
            .current_dir(path)
            .output()?;

        StdCommand::new("git")
            .args(["checkout", "-b", "feat-new"])
            .current_dir(path)
            .output()?;
        StdCommand::new("git")
            .args(["commit", "--allow-empty", "-m", "new work"])
            .current_dir(path)
            .output()?;

        let (branches, _) = list_branches(path, false)?;

        // main/master should be filtered out
        assert!(branches.iter().all(|b| b.branch != "main" && b.branch != "master"));

        // Should be sorted by recency (feat-new before feat-old)
        let names: Vec<&str> = branches.iter().map(|b| b.branch.as_str()).collect();
        let new_idx = names.iter().position(|n| *n == "feat-new");
        let old_idx = names.iter().position(|n| *n == "feat-old");
        assert!(new_idx < old_idx, "feat-new should appear before feat-old");

        Ok(())
    }

    #[tokio::test]
    async fn test_create_and_delete_branch() -> Result<(), Box<dyn std::error::Error>> {
        let dir = init_test_repo()?;
        let path = dir.path().to_str().ok_or("non-UTF-8 temp path")?;

        let wt = create_branch(path, "feat-test", "HEAD").await?;
        assert_eq!(wt.branch, "feat-test");
        assert!(wt.is_branch_mode);

        // Determine the default branch name by opening the repo directly
        let repo = Repository::open(path)?;
        let default_branch = repo
            .branches(Some(git2::BranchType::Local))?
            .filter_map(Result::ok)
            .find(|(b, _)| {
                b.name()
                    .ok()
                    .flatten()
                    .map(|n| n == "main" || n == "master")
                    .unwrap_or(false)
            })
            .and_then(|(b, _)| b.name().ok().flatten().map(str::to_string))
            .ok_or("should have default branch")?;

        switch_branch(path, &default_branch).await?;

        delete_branch(path, "feat-test").await?;
        Ok(())
    }
}
