use std::path::{Path, PathBuf};

use git2::Repository;
use tokio::process::Command;

use crate::types::{AppError, Worktree, AgentState, KanbanColumn};

/// Create a worktree by shelling out to `git worktree add`.
/// Returns the absolute path of the new worktree directory.
///
/// When `base_branch` is a plain branch name (e.g. "main"), this function
/// fetches from origin first and uses `origin/<base_branch>` so the worktree
/// starts from the latest remote state rather than a potentially stale local ref.
pub async fn create_worktree(
    repo_path: &str,
    branch_name: &str,
    base_branch: &str,
    base_path: Option<&str>,
) -> Result<PathBuf, AppError> {
    // Sanitize branch name for use as a directory name — branches like
    // "chloe/feature-name" would otherwise create nested subdirectories.
    let dir_name = branch_name.replace('/', "-");
    let worktree_dir = base_path
        .map(|p| Path::new(p).to_path_buf())
        .unwrap_or_else(|| {
            Path::new(repo_path)
                .parent()
                .unwrap_or(Path::new(repo_path))
                .to_path_buf()
        })
        .join(&dir_name);

    // Use the remote tracking branch so worktrees start from the latest
    // remote state, not a potentially stale local branch.
    let effective_base = if base_branch.contains('/') {
        // Already a qualified ref (e.g. "origin/main") — use as-is
        base_branch.to_string()
    } else {
        // Fetch from origin to ensure the tracking ref is up-to-date
        let fetch_ok = Command::new("git")
            .args(["fetch", "origin", base_branch])
            .current_dir(repo_path)
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);

        if fetch_ok {
            format!("origin/{base_branch}")
        } else {
            // No remote available (e.g. local-only repo) — fall back to local ref
            base_branch.to_string()
        }
    };

    // Try creating with a new branch first; if the branch already exists,
    // fall back to using the existing branch.
    let output = Command::new("git")
        .args([
            "worktree",
            "add",
            "-b",
            branch_name,
            worktree_dir.to_str().unwrap_or_default(),
            &effective_base,
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
    let dir_name = worktree_name.replace('/', "-");
    let worktree_path = base_path
        .map(|p| Path::new(p).to_path_buf())
        .unwrap_or_else(|| {
            Path::new(repo_path)
                .parent()
                .unwrap_or(Path::new(repo_path))
                .to_path_buf()
        })
        .join(&dir_name);

    // Prune stale worktree entries first so a previous partial delete doesn't block us
    let _ = Command::new("git")
        .args(["worktree", "prune"])
        .current_dir(repo_path)
        .output()
        .await;

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
        // If git no longer tracks this worktree, just clean up the directory
        if !stderr.contains("not a working tree") {
            // Try to remove the directory anyway before returning the error
            let _ = tokio::fs::remove_dir_all(&worktree_path).await;
            return Err(AppError::Git(format!(
                "git worktree remove failed: {stderr}"
            )));
        }
    }

    // Ensure the directory is gone even if git left it behind
    if worktree_path.exists() {
        let _ = tokio::fs::remove_dir_all(&worktree_path).await;
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

/// Resolve the default remote branch for a repo (e.g. "origin/main" or "origin/master").
/// Tries origin/main, origin/master, then origin/HEAD. Falls back to "origin/main".
pub fn resolve_default_remote_branch(repo_or_worktree_path: &str) -> String {
    for name in &["origin/main", "origin/master"] {
        let output = std::process::Command::new("git")
            .args(["rev-parse", "--verify", &format!("refs/remotes/{name}")])
            .current_dir(repo_or_worktree_path)
            .output();
        if let Ok(output) = output {
            if output.status.success() {
                return name.to_string();
            }
        }
    }
    // Try origin/HEAD symbolic ref
    let output = std::process::Command::new("git")
        .args(["symbolic-ref", "refs/remotes/origin/HEAD"])
        .current_dir(repo_or_worktree_path)
        .output();
    if let Ok(output) = output {
        if output.status.success() {
            let refname = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if let Some(short) = refname.strip_prefix("refs/remotes/") {
                return short.to_string();
            }
        }
    }
    "origin/main".to_string()
}

/// Count how many commits the current branch is behind the default remote branch.
/// Uses the locally cached remote ref (no fetch) for speed.
/// Returns 0 if up to date or if the remote ref doesn't exist.
pub fn commits_behind_main(worktree_path: &str) -> Result<u32, AppError> {
    let default_branch = resolve_default_remote_branch(worktree_path);
    let output = std::process::Command::new("git")
        .args(["rev-list", "--count", &format!("HEAD..{default_branch}")])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| AppError::Git(format!("failed to spawn git rev-list: {e}")))?;

    if !output.status.success() {
        return Ok(0);
    }

    let count = String::from_utf8_lossy(&output.stdout)
        .trim()
        .parse::<u32>()
        .unwrap_or(0);

    Ok(count)
}

/// Rebase the current branch onto the default remote branch.
/// Fetches origin first, then runs `git rebase origin/<default>`.
/// Returns Ok(()) on success, or an error with stderr on failure.
pub async fn rebase_onto_main(worktree_path: &str) -> Result<(), AppError> {
    let default_branch = resolve_default_remote_branch(worktree_path);
    let short_name = default_branch.strip_prefix("origin/").unwrap_or(&default_branch);

    // Fetch latest from origin
    let fetch = Command::new("git")
        .args(["fetch", "origin", short_name])
        .current_dir(worktree_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git fetch: {e}")))?;

    if !fetch.status.success() {
        let stderr = String::from_utf8_lossy(&fetch.stderr);
        return Err(AppError::Git(format!("git fetch failed: {stderr}")));
    }

    // Rebase onto default remote branch
    let rebase = Command::new("git")
        .args(["rebase", &default_branch])
        .current_dir(worktree_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git rebase: {e}")))?;

    if !rebase.status.success() {
        let stderr = String::from_utf8_lossy(&rebase.stderr);
        // Abort the failed rebase so the worktree isn't left in a broken state
        let _ = Command::new("git")
            .args(["rebase", "--abort"])
            .current_dir(worktree_path)
            .output()
            .await;
        return Err(AppError::Git(format!("rebase failed (aborted): {stderr}")));
    }

    Ok(())
}

/// Get diff stats (additions, deletions) for a worktree's branch changes.
/// Shows committed changes vs the default branch (main/master), which is
/// what users expect the badge to represent — the scope of work on the branch.
/// Uses git CLI instead of git2, which has known issues with worktree diff accuracy.
pub fn get_diff_stats(worktree_path: &str) -> Result<(u32, u32), AppError> {
    // Use the resolved remote default branch for the diff base.
    // Previous approach tried a cascade of candidates including local `main`/`master`,
    // but local branches can be stale (not pulled), causing wildly inflated stats
    // when HEAD is rebased onto origin/main but local main is still behind.
    let default_branch = resolve_default_remote_branch(worktree_path);

    let output = std::process::Command::new("git")
        .args(["diff", "--shortstat", &format!("{default_branch}...HEAD")])
        .current_dir(worktree_path)
        .output();

    if let Ok(output) = output {
        if output.status.success() {
            let stats = parse_shortstat(&String::from_utf8_lossy(&output.stdout));
            if stats != (0, 0) {
                return Ok(stats);
            }
        }
    }

    // Fallback: show uncommitted changes if no default branch found
    let output = std::process::Command::new("git")
        .args(["diff", "--shortstat", "HEAD"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| AppError::Git(format!("failed to run git diff: {e}")))?;

    if !output.status.success() {
        return Ok((0, 0));
    }

    Ok(parse_shortstat(&String::from_utf8_lossy(&output.stdout)))
}

/// Parse the output of `git diff --shortstat`.
fn parse_shortstat(stdout: &str) -> (u32, u32) {
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
    (insertions, deletions)
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

    let base_filter = base_path.and_then(|p| std::path::Path::new(p).canonicalize().ok());

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
        let last_commit_epoch = get_last_commit_epoch(&wt_path);

        worktrees.push(Worktree {
            id: name.to_string(),
            name: name.to_string(),
            path: wt_path.to_string_lossy().to_string(),
            branch,
            repo_path: repo_path.to_string(),
            pr_status: None,
            agent_status: AgentState::NotRunning,
            column: KanbanColumn::InProgress,
            is_branch_mode: false,
            additions: None,
            deletions: None,
            last_commit_epoch,
            last_commit_author: None,
            linear_ticket_url: None,
            linear_ticket_identifier: None,
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

    Ok(WorktreeStatus { branch })
}

/// Status info returned by `get_status`.
#[derive(Debug)]
pub struct WorktreeStatus {
    pub branch: String,
}

/// Helper: open a repo at a path and read the current branch name.
fn get_branch_for_path(path: &Path) -> Option<String> {
    let repo = Repository::open(path).ok()?;
    let head = repo.head().ok()?;
    head.shorthand().map(std::string::ToString::to_string)
}

/// Helper: get the epoch milliseconds of the latest commit on HEAD.
fn get_last_commit_epoch(path: &Path) -> Option<i64> {
    let repo = Repository::open(path).ok()?;
    let head = repo.head().ok()?;
    let commit = head.peel_to_commit().ok()?;
    let epoch_secs = commit.time().seconds();
    Some(epoch_secs * 1000)
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    fn init_test_repo() -> TempDir {
        let dir = TempDir::new().expect("create temp dir");
        let path = dir.path();
        StdCommand::new("git")
            .args(["init"])
            .current_dir(path)
            .output()
            .expect("git init");
        StdCommand::new("git")
            .args(["commit", "--allow-empty", "-m", "init"])
            .current_dir(path)
            .output()
            .expect("git initial commit");
        dir
    }

    #[test]
    fn test_list_worktrees_empty() {
        let dir = init_test_repo();
        let path_str = dir.path().to_str().expect("temp dir path is valid UTF-8");
        let worktrees = list_worktrees(path_str, None).expect("list_worktrees should succeed");
        // A fresh repo has no linked worktrees (only the main one, which isn't listed)
        assert!(worktrees.is_empty());
    }

    #[test]
    fn test_get_status_on_repo() {
        let dir = init_test_repo();
        let path_str = dir.path().to_str().expect("temp dir path is valid UTF-8");
        let status = get_status(path_str).expect("get_status should succeed");
        assert!(!status.branch.is_empty());
    }

    #[tokio::test]
    async fn test_delete_worktree_force_and_branch() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().expect("temp dir path is valid UTF-8");

        // Create a worktree
        let wt_path = create_worktree(repo_path, "test-branch", "main", None)
            .await
            .expect("create_worktree should succeed");
        assert!(wt_path.exists());

        // Make it dirty so non-force would fail
        std::fs::write(wt_path.join("dirty.txt"), "dirty").expect("write dirty file");

        // Force delete should succeed and also remove the branch
        delete_worktree(repo_path, "test-branch", true, None)
            .await
            .expect("delete_worktree should succeed");

        // Worktree directory should be gone
        assert!(!wt_path.exists());

        // Branch should also be gone
        let repo = Repository::open(repo_path).expect("open repo");
        let branch = repo.find_branch("test-branch", git2::BranchType::Local);
        assert!(branch.is_err());
    }
}
