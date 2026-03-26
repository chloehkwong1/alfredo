use std::collections::HashMap;
use std::path::{Path, PathBuf};

use git2::Repository;
use tokio::process::Command;

use crate::types::{AppError, Worktree, AgentState, KanbanColumn};

/// Create a worktree by shelling out to `git worktree add`.
/// Returns the absolute path of the new worktree directory.
pub async fn create_worktree(
    repo_path: &str,
    branch_name: &str,
    base_branch: &str,
    base_path: Option<&str>,
) -> Result<PathBuf, AppError> {
    let worktree_dir = base_path
        .map(|p| Path::new(p).to_path_buf())
        .unwrap_or_else(|| {
            Path::new(repo_path)
                .parent()
                .unwrap_or(Path::new(repo_path))
                .to_path_buf()
        })
        .join(branch_name);

    // Try creating with a new branch first; if the branch already exists,
    // fall back to using the existing branch.
    let output = Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            branch_name,
            worktree_dir.to_str().unwrap_or_default(),
            base_branch,
        ])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("already exists") {
            // Branch exists locally — create worktree using existing branch
            let output2 = Command::new("git")
                .args([
                    "worktree",
                    "add",
                    worktree_dir.to_str().unwrap_or_default(),
                    branch_name,
                ])
                .current_dir(repo_path)
                .output()
                .await
                .map_err(|e| AppError::Git(format!("failed to spawn git: {e}")))?;

            if !output2.status.success() {
                let stderr2 = String::from_utf8_lossy(&output2.stderr);
                return Err(AppError::Git(format!("git worktree add failed: {stderr2}")));
            }
        } else {
            return Err(AppError::Git(format!("git worktree add failed: {stderr}")));
        }
    }

    Ok(worktree_dir)
}

/// Delete a worktree by shelling out to `git worktree remove`.
/// If `force` is true, passes `--force` to allow removing dirty worktrees and
/// also deletes the local branch with `git branch -D`.
pub async fn delete_worktree(
    repo_path: &str,
    worktree_name: &str,
    force: bool,
    base_path: Option<&str>,
) -> Result<(), AppError> {
    let worktree_path = base_path
        .map(|p| Path::new(p).to_path_buf())
        .unwrap_or_else(|| {
            Path::new(repo_path)
                .parent()
                .unwrap_or(Path::new(repo_path))
                .to_path_buf()
        })
        .join(worktree_name);

    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(worktree_path.to_str().unwrap_or_default());

    let output = Command::new("git")
        .args(&args)
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!(
            "git worktree remove failed: {stderr}"
        )));
    }

    if force {
        // Delete the local branch; ignore "not found" errors
        let branch_output = Command::new("git")
            .args(["branch", "-D", worktree_name])
            .current_dir(repo_path)
            .output()
            .await
            .map_err(|e| AppError::Git(format!("failed to spawn git: {e}")))?;

        if !branch_output.status.success() {
            let stderr = String::from_utf8_lossy(&branch_output.stderr);
            // "not found" is acceptable — branch may already be gone
            if !stderr.contains("not found") {
                return Err(AppError::Git(format!("git branch -D failed: {stderr}")));
            }
        }
    }

    Ok(())
}

/// Get diff stats (additions, deletions) for uncommitted changes in a worktree.
/// Uses git CLI instead of git2, which has known issues with worktree diff accuracy.
pub fn get_diff_stats(worktree_path: &str) -> Result<(u32, u32), AppError> {
    let output = std::process::Command::new("git")
        .args(["diff", "--shortstat", "HEAD"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| AppError::Git(format!("failed to run git diff: {e}")))?;

    if !output.status.success() {
        return Ok((0, 0));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let (mut insertions, mut deletions) = (0u32, 0u32);

    // Parse: " 3 files changed, 10 insertions(+), 5 deletions(-)"
    for part in stdout.split(',') {
        let part = part.trim();
        if let Some(n) = part.split_whitespace().next().and_then(|s| s.parse::<u32>().ok()) {
            if part.contains("insertion") {
                insertions = n;
            } else if part.contains("deletion") {
                deletions = n;
            }
        }
    }

    Ok((insertions, deletions))
}

/// List worktrees using git2 for reads.
/// When `base_path` is provided, only worktrees whose path is under that directory are returned.
/// Skips diff stats for speed — call `get_diff_stats` separately for the active worktree.
pub fn list_worktrees(repo_path: &str, base_path: Option<&str>) -> Result<Vec<Worktree>, AppError> {
    let repo = Repository::open(repo_path)
        .map_err(|e| AppError::Git(format!("failed to open repo: {e}")))?;

    let worktree_names = repo
        .worktrees()
        .map_err(|e| AppError::Git(format!("failed to list worktrees: {e}")))?;

    let base_filter = base_path.map(|p| std::path::Path::new(p).canonicalize().ok()).flatten();

    let mut worktrees = Vec::new();

    for name in worktree_names.iter() {
        let Some(name) = name else { continue };

        let wt = match repo.find_worktree(name) {
            Ok(wt) => wt,
            Err(_) => continue,
        };

        let wt_path = wt.path().to_path_buf();

        // Filter to only worktrees under the configured base path
        if let Some(ref base) = base_filter {
            if let Ok(canonical) = wt_path.canonicalize() {
                if !canonical.starts_with(base) {
                    continue;
                }
            } else {
                // Path doesn't exist on disk — skip it
                continue;
            }
        }

        let branch = get_branch_for_path(&wt_path).unwrap_or_else(|| name.to_string());

        worktrees.push(Worktree {
            id: name.to_string(),
            name: name.to_string(),
            path: wt_path.to_string_lossy().to_string(),
            branch,
            pr_status: None,
            agent_status: AgentState::NotRunning,
            column: KanbanColumn::InProgress,
            is_branch_mode: false,
            additions: None,
            deletions: None,
        });
    }

    Ok(worktrees)
}

/// Get detailed status for a single worktree path.
pub fn get_status(worktree_path: &str) -> Result<WorktreeStatus, AppError> {
    let repo = Repository::open(worktree_path)
        .map_err(|e| AppError::Git(format!("failed to open worktree repo: {e}")))?;

    let branch = match repo.head() {
        Ok(head) => head
            .shorthand()
            .unwrap_or("HEAD")
            .to_string(),
        Err(_) => "HEAD".to_string(),
    };

    let statuses = repo
        .statuses(None)
        .map_err(|e| AppError::Git(format!("failed to get statuses: {e}")))?;

    let mut changed_files: HashMap<String, String> = HashMap::new();
    for entry in statuses.iter() {
        let path = entry.path().unwrap_or("?").to_string();
        let status = entry.status();
        let label = if status.is_index_new() || status.is_wt_new() {
            "new"
        } else if status.is_index_modified() || status.is_wt_modified() {
            "modified"
        } else if status.is_index_deleted() || status.is_wt_deleted() {
            "deleted"
        } else {
            "changed"
        };
        changed_files.insert(path, label.to_string());
    }

    let is_clean = changed_files.is_empty();

    Ok(WorktreeStatus {
        branch,
        changed_files,
        is_clean,
    })
}

/// Status info returned by `get_status`.
#[derive(Debug)]
pub struct WorktreeStatus {
    pub branch: String,
    pub changed_files: HashMap<String, String>,
    pub is_clean: bool,
}

/// Helper: open a repo at a path and read the current branch name.
fn get_branch_for_path(path: &Path) -> Option<String> {
    let repo = Repository::open(path).ok()?;
    let head = repo.head().ok()?;
    head.shorthand().map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    fn init_test_repo() -> TempDir {
        let dir = TempDir::new().unwrap();
        let path = dir.path();
        StdCommand::new("git")
            .args(["init"])
            .current_dir(path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "--allow-empty", "-m", "init"])
            .current_dir(path)
            .output()
            .unwrap();
        dir
    }

    #[test]
    fn test_list_worktrees_empty() {
        let dir = init_test_repo();
        let result = list_worktrees(dir.path().to_str().unwrap(), None);
        assert!(result.is_ok());
        // A fresh repo has no linked worktrees (only the main one, which isn't listed)
        assert!(result.unwrap().is_empty());
    }

    #[test]
    fn test_get_status_on_repo() {
        let dir = init_test_repo();
        let result = get_status(dir.path().to_str().unwrap());
        assert!(result.is_ok());
        let status = result.unwrap();
        assert!(status.is_clean);
    }

    #[tokio::test]
    async fn test_delete_worktree_force_and_branch() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        // Create a worktree
        let wt_path = create_worktree(repo_path, "test-branch", "main", None).await.unwrap();
        assert!(wt_path.exists());

        // Make it dirty so non-force would fail
        std::fs::write(wt_path.join("dirty.txt"), "dirty").unwrap();

        // Force delete should succeed and also remove the branch
        delete_worktree(repo_path, "test-branch", true, None).await.unwrap();

        // Worktree directory should be gone
        assert!(!wt_path.exists());

        // Branch should also be gone
        let repo = Repository::open(repo_path).unwrap();
        let branch = repo.find_branch("test-branch", git2::BranchType::Local);
        assert!(branch.is_err());
    }
}
