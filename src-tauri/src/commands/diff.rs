use git2::{Delta, DiffFormat, DiffOptions, Repository, Sort};
use serde::Serialize;

use crate::types::AppError;

type Result<T> = std::result::Result<T, AppError>;

// ── Structs ────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffFile {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
    pub additions: usize,
    pub deletions: usize,
    pub hunks: Vec<DiffHunk>,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<DiffLine>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffLine {
    pub line_type: String,
    pub content: String,
    pub old_line_number: Option<u32>,
    pub new_line_number: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub timestamp: i64,
}

// ── Helpers ────────────────────────────────────────────────────

fn open_repo(repo_path: &str) -> Result<Repository> {
    Repository::open(repo_path).map_err(|e| AppError::Git(format!("failed to open repo: {e}")))
}

/// Resolve the default branch OID, trying the provided name, then `main`, `master`,
/// and finally `refs/remotes/origin/HEAD`.
///
/// Prefers remote tracking branches (`origin/main`) over local branches because
/// local `main` can be stale (not pulled recently), causing diffs and commit
/// lists to include other people's commits that landed on main since the last pull.
fn resolve_default_branch(repo: &Repository, default_branch: Option<&str>) -> Result<git2::Oid> {
    let candidates: Vec<String> = if let Some(name) = default_branch {
        vec![name.to_string()]
    } else {
        vec![
            "main".to_string(),
            "master".to_string(),
        ]
    };

    for name in &candidates {
        // Prefer remote tracking branch — it reflects the latest fetched state
        let remote_ref = format!("refs/remotes/origin/{name}");
        if let Ok(reference) = repo.find_reference(&remote_ref) {
            if let Some(oid) = reference.target() {
                return Ok(oid);
            }
        }
        // Fall back to local branch
        if let Ok(reference) = repo.find_branch(name, git2::BranchType::Local) {
            if let Some(oid) = reference.get().target() {
                return Ok(oid);
            }
        }
    }

    // Last resort: origin/HEAD
    if let Ok(reference) = repo.find_reference("refs/remotes/origin/HEAD") {
        if let Ok(resolved) = reference.resolve() {
            if let Some(oid) = resolved.target() {
                return Ok(oid);
            }
        }
    }

    Err(AppError::Git(
        "could not resolve default branch (tried main, master, origin/HEAD)".into(),
    ))
}

fn delta_to_status(delta: Delta) -> &'static str {
    match delta {
        Delta::Added => "added",
        Delta::Deleted => "deleted",
        Delta::Renamed => "renamed",
        _ => "modified",
    }
}

/// Convert a git2 diff into structured `DiffFile` objects.
fn diff_to_files(diff: &git2::Diff<'_>) -> Result<Vec<DiffFile>> {
    use std::cell::RefCell;

    let files: RefCell<Vec<DiffFile>> = RefCell::new(Vec::new());
    let current_hunk: RefCell<Option<DiffHunk>> = RefCell::new(None);

    diff.print(DiffFormat::Patch, |delta, hunk, line| {
        let mut files = files.borrow_mut();

        // Determine the file path from the delta
        let new_path = delta
            .new_file()
            .path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let old_path = delta
            .old_file()
            .path()
            .map(|p| p.to_string_lossy().to_string());
        let status = delta_to_status(delta.status());

        // Ensure we have a DiffFile entry for this delta
        let file_path = new_path.clone();
        if files.is_empty() || files.last().map(|f| &f.path) != Some(&file_path) {
            // Flush any pending hunk into the previous file
            if let Some(h) = current_hunk.borrow_mut().take() {
                if let Some(prev_file) = files.last_mut() {
                    prev_file.hunks.push(h);
                }
            }

            let old_path_field = if status == "renamed" { old_path.clone() } else { None };
            files.push(DiffFile {
                path: file_path,
                old_path: old_path_field,
                status: status.to_string(),
                additions: 0,
                deletions: 0,
                hunks: Vec::new(),
                truncated: false,
            });
        }

        let Some(file) = files.last_mut() else {
            return true; // skip line if no file entry (shouldn't happen)
        };

        match line.origin() {
            'H' | 'F' => {
                // Hunk header or file header
                if let Some(hunk_info) = hunk {
                    // Flush previous hunk
                    if let Some(h) = current_hunk.borrow_mut().take() {
                        file.hunks.push(h);
                    }
                    let header = String::from_utf8_lossy(line.content()).trim_end().to_string();
                    *current_hunk.borrow_mut() = Some(DiffHunk {
                        header,
                        old_start: hunk_info.old_start(),
                        new_start: hunk_info.new_start(),
                        lines: Vec::new(),
                    });
                }
            }
            '+' => {
                file.additions += 1;
                let content = String::from_utf8_lossy(line.content()).to_string();
                if let Some(ref mut h) = *current_hunk.borrow_mut() {
                    h.lines.push(DiffLine {
                        line_type: "addition".to_string(),
                        content,
                        old_line_number: None,
                        new_line_number: line.new_lineno(),
                    });
                }
            }
            '-' => {
                file.deletions += 1;
                let content = String::from_utf8_lossy(line.content()).to_string();
                if let Some(ref mut h) = *current_hunk.borrow_mut() {
                    h.lines.push(DiffLine {
                        line_type: "deletion".to_string(),
                        content,
                        old_line_number: line.old_lineno(),
                        new_line_number: None,
                    });
                }
            }
            ' ' => {
                let content = String::from_utf8_lossy(line.content()).to_string();
                if let Some(ref mut h) = *current_hunk.borrow_mut() {
                    h.lines.push(DiffLine {
                        line_type: "context".to_string(),
                        content,
                        old_line_number: line.old_lineno(),
                        new_line_number: line.new_lineno(),
                    });
                }
            }
            _ => {}
        }

        true
    })
    .map_err(|e| AppError::Git(format!("diff print failed: {e}")))?;

    // Flush the last hunk into the last file
    let mut files = files.into_inner();
    if let Some(h) = current_hunk.into_inner() {
        if let Some(last_file) = files.last_mut() {
            last_file.hunks.push(h);
        }
    }

    Ok(files)
}

// ── Commands ───────────────────────────────────────────────────

/// Get the diff between HEAD and the merge base with the default branch.
#[tauri::command]
pub async fn get_diff(
    repo_path: String,
    default_branch: Option<String>,
) -> Result<Vec<DiffFile>> {
    tokio::task::spawn_blocking(move || {
        let repo = open_repo(&repo_path)?;

        let default_oid = resolve_default_branch(&repo, default_branch.as_deref())?;
        let head_oid = repo
            .head()
            .and_then(|h| h.resolve())
            .map_err(|e| AppError::Git(format!("failed to resolve HEAD: {e}")))?
            .target()
            .ok_or_else(|| AppError::Git("HEAD has no target".into()))?;

        let merge_base = repo
            .merge_base(default_oid, head_oid)
            .map_err(|e| AppError::Git(format!("failed to find merge base: {e}")))?;

        let base_tree = repo
            .find_commit(merge_base)
            .and_then(|c| c.tree())
            .map_err(|e| AppError::Git(format!("failed to get base tree: {e}")))?;
        let head_tree = repo
            .find_commit(head_oid)
            .and_then(|c| c.tree())
            .map_err(|e| AppError::Git(format!("failed to get HEAD tree: {e}")))?;

        let mut opts = DiffOptions::new();
        let diff = repo
            .diff_tree_to_tree(Some(&base_tree), Some(&head_tree), Some(&mut opts))
            .map_err(|e| AppError::Git(format!("diff failed: {e}")))?;

        diff_to_files(&diff)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Get the diff of uncommitted changes (working tree + index vs HEAD).
///
/// Uses git CLI instead of git2 because git2 has known issues with
/// `diff_index_to_workdir` on linked worktrees (reports all tracked files
/// as deleted). The CLI output is parsed back via `git2::Diff::from_buffer`
/// so the existing `diff_to_files` converter can be reused.
#[tauri::command]
pub async fn get_uncommitted_diff(repo_path: String) -> Result<Vec<DiffFile>> {
    tokio::task::spawn_blocking(move || {
        let output = std::process::Command::new("git")
            .args(["diff", "HEAD", "--no-ext-diff", "-p", "--no-color"])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| AppError::Git(format!("failed to run git diff: {e}")))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(format!("git diff HEAD failed: {err}")));
        }

        // Empty diff = no uncommitted changes
        if output.stdout.is_empty() {
            return Ok(Vec::new());
        }

        let diff = git2::Diff::from_buffer(&output.stdout)
            .map_err(|e| AppError::Git(format!("failed to parse diff buffer: {e}")))?;

        diff_to_files(&diff)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Return the name of the default branch for the given repo.
///
/// Checks `origin/HEAD` first (the remote's declared default), then falls back
/// to looking for a local `main` or `master` branch.
#[tauri::command]
pub async fn get_default_branch(repo_path: String) -> Result<String> {
    tokio::task::spawn_blocking(move || {
        let repo = open_repo(&repo_path)?;

        // Best signal: origin/HEAD symbolic ref (e.g. refs/remotes/origin/develop)
        if let Ok(reference) = repo.find_reference("refs/remotes/origin/HEAD") {
            if let Ok(resolved) = reference.resolve() {
                if let Some(name) = resolved.name() {
                    // "refs/remotes/origin/develop" → "develop"
                    if let Some(short) = name.strip_prefix("refs/remotes/origin/") {
                        return Ok(short.to_string());
                    }
                }
            }
        }

        // Fallback: first local branch that exists
        for name in &["main", "master"] {
            if repo.find_branch(name, git2::BranchType::Local).is_ok() {
                return Ok(name.to_string());
            }
        }

        Ok("main".to_string())
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Get commits from HEAD back to the merge base with the default branch.
#[tauri::command]
pub async fn get_commits(repo_path: String, default_branch: Option<String>) -> Result<Vec<CommitInfo>> {
    tokio::task::spawn_blocking(move || {
        let repo = open_repo(&repo_path)?;

        let default_oid = resolve_default_branch(&repo, default_branch.as_deref())?;
        let head_oid = repo
            .head()
            .and_then(|h| h.resolve())
            .map_err(|e| AppError::Git(format!("failed to resolve HEAD: {e}")))?
            .target()
            .ok_or_else(|| AppError::Git("HEAD has no target".into()))?;

        let mut revwalk = repo
            .revwalk()
            .map_err(|e| AppError::Git(format!("revwalk failed: {e}")))?;
        revwalk
            .push(head_oid)
            .map_err(|e| AppError::Git(format!("revwalk push failed: {e}")))?;
        // Exclude all commits reachable from the default branch (main..HEAD).
        // Without this, merging main into the feature branch would include
        // other people's commits in the list.
        revwalk
            .hide(default_oid)
            .map_err(|e| AppError::Git(format!("revwalk hide failed: {e}")))?;
        revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
            .map_err(|e| AppError::Git(format!("revwalk sorting failed: {e}")))?;

        let mut commits = Vec::new();
        for oid_result in revwalk {
            let oid = oid_result.map_err(|e| AppError::Git(format!("revwalk error: {e}")))?;
            let commit = repo
                .find_commit(oid)
                .map_err(|e| AppError::Git(format!("find commit failed: {e}")))?;
            let hash = oid.to_string();
            let short_hash = hash[..7.min(hash.len())].to_string();
            commits.push(CommitInfo {
                hash,
                short_hash,
                message: commit.message().unwrap_or("").to_string(),
                author: commit.author().name().unwrap_or("Unknown").to_string(),
                timestamp: commit.time().seconds(),
            });
        }

        commits.reverse(); // chronological order: oldest first
        Ok(commits)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Get the diff for a specific commit against its parent.
#[tauri::command]
pub async fn get_diff_for_commit(
    repo_path: String,
    commit_hash: String,
) -> Result<Vec<DiffFile>> {
    tokio::task::spawn_blocking(move || {
        let repo = open_repo(&repo_path)?;

        let oid = git2::Oid::from_str(&commit_hash)
            .map_err(|e| AppError::Git(format!("invalid commit hash: {e}")))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| AppError::Git(format!("commit not found: {e}")))?;

        let commit_tree = commit
            .tree()
            .map_err(|e| AppError::Git(format!("failed to get commit tree: {e}")))?;

        let parent_tree = if commit.parent_count() > 0 {
            Some(
                commit
                    .parent(0)
                    .and_then(|p| p.tree())
                    .map_err(|e| AppError::Git(format!("failed to get parent tree: {e}")))?,
            )
        } else {
            None
        };

        let mut opts = DiffOptions::new();
        let diff = repo
            .diff_tree_to_tree(
                parent_tree.as_ref(),
                Some(&commit_tree),
                Some(&mut opts),
            )
            .map_err(|e| AppError::Git(format!("diff failed: {e}")))?;

        diff_to_files(&diff)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileLine {
    pub line_number: u32,
    pub content: String,
}

/// Read a range of lines from a file, either from the working tree or a specific commit.
///
/// - `start_line` and `end_line` are 1-based, inclusive.
/// - If `commit_hash` is None, reads from the working tree.
/// - If `commit_hash` is Some, reads the file as it existed in that commit.
#[tauri::command]
pub async fn get_file_lines(
    repo_path: String,
    file_path: String,
    start_line: u32,
    end_line: u32,
    commit_hash: Option<String>,
) -> Result<Vec<FileLine>> {
    tokio::task::spawn_blocking(move || {
        let content = if let Some(hash) = commit_hash {
            let output = std::process::Command::new("git")
                .args(["show", &format!("{hash}:{file_path}")])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| AppError::Git(format!("failed to run git show: {e}")))?;

            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::Git(format!("git show failed: {err}")));
            }

            String::from_utf8_lossy(&output.stdout).to_string()
        } else {
            let full_path = std::path::Path::new(&repo_path).join(&file_path);
            std::fs::read_to_string(&full_path)
                .map_err(|e| AppError::Git(format!("failed to read file: {e}")))?
        };

        let lines: Vec<FileLine> = content
            .lines()
            .enumerate()
            .filter_map(|(i, line)| {
                let line_num = (i as u32) + 1;
                if line_num >= start_line && line_num <= end_line {
                    Some(FileLine {
                        line_number: line_num,
                        content: format!(" {line}"),
                    })
                } else {
                    None
                }
            })
            .collect();

        Ok(lines)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}
