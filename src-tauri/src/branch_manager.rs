use git2::Repository;
use tokio::process::Command;

use crate::types::{AgentState, AppError, KanbanColumn, Worktree};

/// List local branches, returning them as Worktree structs with `is_branch_mode: true`.
/// The currently checked-out branch is marked by having its name match `active_branch`.
pub fn list_branches(repo_path: &str) -> Result<(Vec<Worktree>, Option<String>), AppError> {
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
        });
    }

    Ok((worktrees, active_branch))
}

/// Create a new branch and check it out via git CLI.
pub async fn create_branch(
    repo_path: &str,
    branch_name: &str,
    base_branch: &str,
) -> Result<Worktree, AppError> {
    // Create the branch from base
    let output = Command::new("git")
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

    let output = Command::new("git")
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
    let output = Command::new("git")
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
        let (branches, active) = list_branches(path)?;
        // Should have at least one branch (main/master)
        assert!(!branches.is_empty());
        assert!(active.is_some());
        // All branches should be in branch mode
        for b in &branches {
            assert!(b.is_branch_mode);
        }
        Ok(())
    }

    #[tokio::test]
    async fn test_create_and_delete_branch() -> Result<(), Box<dyn std::error::Error>> {
        let dir = init_test_repo()?;
        let path = dir.path().to_str().ok_or("non-UTF-8 temp path")?;

        let wt = create_branch(path, "feat-test", "HEAD").await?;
        assert_eq!(wt.branch, "feat-test");
        assert!(wt.is_branch_mode);

        // Switch back to default branch so we can delete feat-test
        let (branches, _) = list_branches(path)?;
        let default_branch = branches
            .iter()
            .find(|b| b.branch != "feat-test")
            .ok_or("should have default branch")?;
        switch_branch(path, &default_branch.branch).await?;

        delete_branch(path, "feat-test").await?;
        Ok(())
    }
}
