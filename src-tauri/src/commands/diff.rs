use std::collections::HashSet;

use git2::{Delta, DiffFormat, DiffOptions, Repository, Sort};
use serde::{Deserialize, Serialize};

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

/// Return the set of paths that git considers ignored (even if tracked).
///
/// Uses `git check-ignore` so that `.gitignore`, `.git/info/exclude`, and
/// `core.excludesFile` (global gitignore) are all respected.
fn ignored_paths(repo_path: &str, paths: &[String]) -> HashSet<String> {
    if paths.is_empty() {
        return HashSet::new();
    }

    let mut cmd = std::process::Command::new("git");
    cmd.args(["check-ignore", "--stdin"])
        .current_dir(repo_path)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(_) => return HashSet::new(),
    };

    // Write all paths to stdin
    if let Some(ref mut stdin) = child.stdin {
        use std::io::Write;
        let _ = stdin.write_all(paths.join("\n").as_bytes());
    }

    match child.wait_with_output() {
        Ok(output) => String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::to_string)
            .collect(),
        Err(_) => HashSet::new(),
    }
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
///
/// Also includes untracked files (new files not yet staged) by running
/// `git ls-files --others --exclude-standard` and reading their contents.
#[tauri::command]
pub async fn get_uncommitted_diff(repo_path: String) -> Result<Vec<DiffFile>> {
    tokio::task::spawn_blocking(move || {
        // 1. Get tracked file changes via git diff HEAD
        let output = std::process::Command::new("git")
            .args(["diff", "HEAD", "--no-ext-diff", "-p", "--no-color"])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| AppError::Git(format!("failed to run git diff: {e}")))?;

        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(AppError::Git(format!("git diff HEAD failed: {err}")));
        }

        let mut files = if output.stdout.is_empty() {
            Vec::new()
        } else {
            let diff = git2::Diff::from_buffer(&output.stdout)
                .map_err(|e| AppError::Git(format!("failed to parse diff buffer: {e}")))?;
            diff_to_files(&diff)?
        };

        // 2. Get untracked files (new files not yet git-added)
        let untracked_output = std::process::Command::new("git")
            .args(["ls-files", "--others", "--exclude-standard"])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| AppError::Git(format!("failed to run git ls-files: {e}")))?;

        if untracked_output.status.success() {
            let listing = String::from_utf8_lossy(&untracked_output.stdout);
            for rel_path in listing.lines().filter(|l| !l.is_empty()) {
                let abs_path = std::path::Path::new(&repo_path).join(rel_path);
                let content = match std::fs::read_to_string(&abs_path) {
                    Ok(c) => c,
                    Err(_) => continue, // skip binary / unreadable files
                };

                let line_count = content.lines().count();
                let lines: Vec<DiffLine> = content
                    .lines()
                    .enumerate()
                    .map(|(i, line)| DiffLine {
                        line_type: "addition".to_string(),
                        content: line.to_string(),
                        old_line_number: None,
                        new_line_number: Some((i + 1) as u32),
                    })
                    .collect();

                files.push(DiffFile {
                    path: rel_path.to_string(),
                    old_path: None,
                    status: "added".to_string(),
                    additions: line_count,
                    deletions: 0,
                    hunks: vec![DiffHunk {
                        header: format!("@@ -0,0 +1,{line_count} @@"),
                        old_start: 0,
                        new_start: 1,
                        lines,
                    }],
                    truncated: false,
                });
            }
        }

        // 3. Filter out files that should never appear as uncommitted changes.
        //
        // a) Alfredo-injected artifacts (.claude/context.md, .claude/settings.local.json)
        //    are added to .git/info/exclude, but that only affects untracked files.
        //    If they were ever committed, `git diff HEAD` still reports them — so we
        //    need a hardcoded filter here.
        //
        // b) Also filter via `git check-ignore` for any other gitignored paths that
        //    slip through (e.g. tracked files matching .gitignore).
        const HIDDEN_PATHS: &[&str] = &[
            ".claude/context.md",
            ".claude/settings.local.json",
        ];
        files.retain(|f| !HIDDEN_PATHS.contains(&f.path.as_str()));

        let all_paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
        let ignored = ignored_paths(&repo_path, &all_paths);
        if !ignored.is_empty() {
            files.retain(|f| !ignored.contains(&f.path));
        }

        Ok(files)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Return the name of the default branch for the given repo.
///
/// Resolution order matches `resolve_default_branch` and `get_diff_stats`:
/// prefer remote tracking branches over local ones to avoid stale-local-main issues.
#[tauri::command]
pub async fn get_default_branch(repo_path: String) -> Result<String> {
    tokio::task::spawn_blocking(move || {
        let repo = open_repo(&repo_path)?;

        // Prefer remote tracking branches — local main can be stale.
        for name in &["main", "master"] {
            let remote_ref = format!("refs/remotes/origin/{name}");
            if repo.find_reference(&remote_ref).is_ok() {
                return Ok(name.to_string());
            }
        }

        // origin/HEAD symbolic ref (e.g. refs/remotes/origin/develop)
        if let Ok(reference) = repo.find_reference("refs/remotes/origin/HEAD") {
            if let Ok(resolved) = reference.resolve() {
                if let Some(name) = resolved.name() {
                    if let Some(short) = name.strip_prefix("refs/remotes/origin/") {
                        return Ok(short.to_string());
                    }
                }
            }
        }

        // Last resort: local branch
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

// ── Discard Commands ──────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscardFileInfo {
    pub path: String,
    pub old_path: Option<String>,
    pub status: String,
}

/// Validate that `file_path` does not escape `repo_path` via path traversal.
fn validate_path_within_repo(repo_path: &str, file_path: &str) -> Result<()> {
    let repo = std::path::Path::new(repo_path)
        .canonicalize()
        .map_err(|e| AppError::Git(format!("failed to canonicalize repo path: {e}")))?;
    let full = std::path::Path::new(repo_path)
        .join(file_path)
        .canonicalize()
        .map_err(|e| AppError::Git(format!("failed to canonicalize file path: {e}")))?;
    if !full.starts_with(&repo) {
        return Err(AppError::Git("file path escapes repository".into()));
    }
    Ok(())
}

/// Discard uncommitted changes for a single file.
#[tauri::command]
pub async fn discard_file(
    repo_path: String,
    file_path: String,
    file_status: String,
) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        match file_status.as_str() {
            "added" => {
                // Untracked file — just delete it
                validate_path_within_repo(&repo_path, &file_path)?;
                let abs = std::path::Path::new(&repo_path).join(&file_path);
                std::fs::remove_file(&abs)
                    .map_err(|e| AppError::Git(format!("failed to delete file: {e}")))?;
            }
            "modified" | "deleted" => {
                // For deleted files the path won't exist on disk, so canonicalize
                // may fail. Check for traversal patterns as fallback.
                validate_path_within_repo(&repo_path, &file_path)
                    .or_else(|_| {
                        if file_path.contains("..") {
                            Err(AppError::Git("file path escapes repository".into()))
                        } else {
                            Ok(())
                        }
                    })?;
                let output = std::process::Command::new("git")
                    .args(["checkout", "HEAD", "--", &file_path])
                    .current_dir(&repo_path)
                    .output()
                    .map_err(|e| AppError::Git(format!("failed to run git checkout: {e}")))?;
                if !output.status.success() {
                    let err = String::from_utf8_lossy(&output.stderr);
                    return Err(AppError::Git(format!("git checkout failed: {err}")));
                }
            }
            "renamed" => {
                // For renamed files, file_path is the new name. We need to restore
                // via git checkout HEAD -- which handles staged renames.
                if file_path.contains("..") {
                    return Err(AppError::Git("file path escapes repository".into()));
                }
                // Reset the index first, then checkout
                let _ = std::process::Command::new("git")
                    .args(["reset", "HEAD", "--", &file_path])
                    .current_dir(&repo_path)
                    .output();
                let output = std::process::Command::new("git")
                    .args(["checkout", "HEAD", "--", &file_path])
                    .current_dir(&repo_path)
                    .output()
                    .map_err(|e| AppError::Git(format!("failed to run git checkout: {e}")))?;
                if !output.status.success() {
                    // Not fatal — the new path may not exist in HEAD
                }
                // Clean up the renamed-to file if it still exists
                let abs = std::path::Path::new(&repo_path).join(&file_path);
                if abs.exists() {
                    let _ = std::fs::remove_file(&abs);
                }
            }
            _ => {
                return Err(AppError::Git(format!("unknown file status: {file_status}")));
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Discard all uncommitted changes.
#[tauri::command]
pub async fn discard_all_uncommitted(
    repo_path: String,
    files: Vec<DiscardFileInfo>,
) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        // Validate all paths first
        for f in &files {
            if f.path.contains("..") {
                return Err(AppError::Git(format!(
                    "file path escapes repository: {}",
                    f.path
                )));
            }
            if let Some(ref old) = f.old_path {
                if old.contains("..") {
                    return Err(AppError::Git(format!(
                        "old file path escapes repository: {old}"
                    )));
                }
            }
        }

        // Collect paths that need git checkout HEAD --
        let mut checkout_paths: Vec<String> = Vec::new();
        let mut untracked_paths: Vec<String> = Vec::new();
        let mut renamed_new_paths: Vec<String> = Vec::new();

        for f in &files {
            match f.status.as_str() {
                "added" => {
                    untracked_paths.push(f.path.clone());
                }
                "modified" | "deleted" => {
                    checkout_paths.push(f.path.clone());
                }
                "renamed" => {
                    if let Some(ref old) = f.old_path {
                        checkout_paths.push(old.clone());
                    }
                    renamed_new_paths.push(f.path.clone());
                }
                _ => {}
            }
        }

        // Single git checkout for all modified/deleted/renamed-old paths
        if !checkout_paths.is_empty() {
            let mut args = vec!["checkout".to_string(), "HEAD".to_string(), "--".to_string()];
            args.extend(checkout_paths);
            let output = std::process::Command::new("git")
                .args(&args)
                .current_dir(&repo_path)
                .output()
                .map_err(|e| AppError::Git(format!("failed to run git checkout: {e}")))?;
            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::Git(format!("git checkout failed: {err}")));
            }
        }

        // Delete renamed new paths
        for path in &renamed_new_paths {
            let abs = std::path::Path::new(&repo_path).join(path);
            if abs.exists() {
                let _ = std::fs::remove_file(&abs);
            }
        }

        // Delete untracked (added) files
        for path in &untracked_paths {
            let abs = std::path::Path::new(&repo_path).join(path);
            if abs.exists() {
                std::fs::remove_file(&abs)
                    .map_err(|e| AppError::Git(format!("failed to delete {path}: {e}")))?;
            }
        }

        Ok(())
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}
