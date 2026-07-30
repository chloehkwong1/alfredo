use std::collections::{HashMap, HashSet};

use git2::{Delta, DiffFormat, DiffOptions, Repository, Sort};
use serde::{Deserialize, Serialize};

use crate::git_manager::git_command_sync;
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
    /// Full text of the file before the change. `None` for added files,
    /// binary blobs, or blobs exceeding `MAX_FULL_FILE_BYTES`.
    pub original_content: Option<String>,
    /// Full text of the file after the change. `None` for deleted files,
    /// binary blobs, or blobs exceeding `MAX_FULL_FILE_BYTES`.
    pub modified_content: Option<String>,
}

/// Cap on per-side file content shipped to the renderer. Anything larger
/// is left as `None` and the frontend shows a fallback placeholder.
const MAX_FULL_FILE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffHunk {
    pub header: String,
    pub old_start: u32,
    pub new_start: u32,
    pub lines: Vec<DiffLine>,
}

/// A single line in a diff hunk.
///
/// `content` includes the diff origin prefix character (`+`, `-`, or ` `)
/// as its first character. The frontend strips this prefix before rendering.
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

/// Resolve the default branch OID, trying the provided name, then `origin/HEAD`,
/// then `main`/`master`.
///
/// Prefers remote tracking branches (`origin/main`) over local branches because
/// local `main` can be stale (not pulled recently), causing diffs and commit
/// lists to include other people's commits that landed on main since the last pull.
pub(crate) fn resolve_default_branch(repo: &Repository, default_branch: Option<&str>) -> Result<git2::Oid> {
    // When an explicit name is provided, try it directly.
    if let Some(name) = default_branch {
        let remote_ref = format!("refs/remotes/origin/{name}");
        if let Ok(reference) = repo.find_reference(&remote_ref) {
            if let Some(oid) = reference.target() {
                return Ok(oid);
            }
        }
        if let Ok(reference) = repo.find_branch(name, git2::BranchType::Local) {
            if let Some(oid) = reference.get().target() {
                return Ok(oid);
            }
        }
    }

    // origin/HEAD is authoritative — it reflects the remote's configured default branch.
    if let Ok(Some(branch_name)) = resolve_origin_head(repo) {
        let remote_ref = format!("refs/remotes/origin/{branch_name}");
        if let Ok(reference) = repo.find_reference(&remote_ref) {
            if let Some(oid) = reference.target() {
                return Ok(oid);
            }
        }
    }

    // Fallback: common default branch names.
    for name in &["main", "develop", "master"] {
        let remote_ref = format!("refs/remotes/origin/{name}");
        if let Ok(reference) = repo.find_reference(&remote_ref) {
            if let Some(oid) = reference.target() {
                return Ok(oid);
            }
        }
        if let Ok(reference) = repo.find_branch(name, git2::BranchType::Local) {
            if let Some(oid) = reference.get().target() {
                return Ok(oid);
            }
        }
    }

    Err(AppError::Git(
        "could not resolve default branch (tried origin/HEAD, main, develop, master)".into(),
    ))
}

/// The default-branch tip to clamp a stacked diff against, for `resolve_diff_range`.
///
/// Returns `Some(default_tip)` only when an explicit base branch (a stack
/// parent) is set — that's the case where the diff base could reach back past
/// where HEAD forked from the default branch and wrongly count default-branch
/// drift as this branch's work. For a non-stacked worktree (`base_branch` is
/// `None`, so the diff is already taken against the default branch) it returns
/// `None`, which makes the clamp a guaranteed no-op.
pub(crate) fn stack_clamp_oid(repo: &Repository, base_branch: Option<&str>) -> Option<git2::Oid> {
    if base_branch.is_some() {
        resolve_default_branch(repo, None).ok()
    } else {
        None
    }
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
                original_content: None,
                modified_content: None,
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
                let raw = String::from_utf8_lossy(line.content()).to_string();
                let content = format!("+{raw}");
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
                let raw = String::from_utf8_lossy(line.content()).to_string();
                let content = format!("-{raw}");
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
                let raw = String::from_utf8_lossy(line.content()).to_string();
                let content = format!(" {raw}");
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

    let mut cmd = git_command_sync();
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

// ── Full-file content helpers ──────────────────────────────────

/// Read a blob from `tree` at `path` as a UTF-8 (lossy) string.
///
/// Returns `None` for missing entries, non-blobs (submodules), binary blobs,
/// and blobs exceeding `MAX_FULL_FILE_BYTES`. The renderer falls back to a
/// placeholder when this returns `None`.
fn read_tree_blob(repo: &Repository, tree: &git2::Tree<'_>, path: &str) -> Option<String> {
    let entry = tree.get_path(std::path::Path::new(path)).ok()?;
    let object = entry.to_object(repo).ok()?;
    let blob = object.as_blob()?;
    if blob.is_binary() || blob.size() > MAX_FULL_FILE_BYTES {
        return None;
    }
    Some(String::from_utf8_lossy(blob.content()).to_string())
}

/// Read a file from the working tree as a UTF-8 (lossy) string.
///
/// Returns `None` for missing files, files exceeding `MAX_FULL_FILE_BYTES`,
/// or files that look binary (NUL byte in the first 8 KB).
fn read_workdir_blob(repo_path: &str, file_path: &str) -> Option<String> {
    let full = std::path::Path::new(repo_path).join(file_path);
    let bytes = std::fs::read(&full).ok()?;
    if bytes.len() > MAX_FULL_FILE_BYTES {
        return None;
    }
    let sample_len = bytes.len().min(8192);
    if bytes[..sample_len].contains(&0u8) {
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).to_string())
}

/// Populate `original_content` / `modified_content` on each file from a
/// tree-to-tree diff (used by `get_diff` and `get_diff_for_commit`).
fn populate_tree_content(
    repo: &Repository,
    files: &mut [DiffFile],
    base_tree: Option<&git2::Tree<'_>>,
    head_tree: Option<&git2::Tree<'_>>,
) {
    for file in files {
        if file.status != "added" {
            if let Some(tree) = base_tree {
                let original_path = file.old_path.as_deref().unwrap_or(&file.path);
                file.original_content = read_tree_blob(repo, tree, original_path);
            }
        }
        if file.status != "deleted" {
            if let Some(tree) = head_tree {
                file.modified_content = read_tree_blob(repo, tree, &file.path);
            }
        }
    }
}

/// Populate content for the working-tree diff path: original from HEAD tree,
/// modified from disk. Only touches files whose fields are still `None`,
/// so the untracked-files path can pre-populate `modified_content`.
fn populate_workdir_content(
    repo: &Repository,
    repo_path: &str,
    files: &mut [DiffFile],
    head_tree: Option<&git2::Tree<'_>>,
) {
    for file in files {
        if file.original_content.is_none() && file.status != "added" {
            if let Some(tree) = head_tree {
                let original_path = file.old_path.as_deref().unwrap_or(&file.path);
                file.original_content = read_tree_blob(repo, tree, original_path);
            }
        }
        if file.modified_content.is_none() && file.status != "deleted" {
            file.modified_content = read_workdir_blob(repo_path, &file.path);
        }
    }
}

// ── Commands ───────────────────────────────────────────────────

/// Get the diff between HEAD and the merge base with the default branch.
#[tauri::command]
pub async fn get_diff(
    repo_path: String,
    default_branch: Option<String>,
    merge_commit_sha: Option<String>,
    clamp_drift: Option<bool>,
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

        // Only clamp default-branch drift when the base is a user-selected stack
        // parent (clamp_drift). When a PR exists the base is GitHub's PR base,
        // which must be diffed verbatim to match the PR, so the caller passes
        // clamp_drift = false.
        let main_oid = if clamp_drift.unwrap_or(false) {
            stack_clamp_oid(&repo, default_branch.as_deref())
        } else {
            None
        };
        let range = crate::commands::diff_range::resolve_diff_range(
            &repo, default_oid, head_oid, merge_commit_sha.as_deref(), main_oid,
        )?;

        // Empty-range short-circuit (branch fully contained, no merge found).
        if range.base == range.head {
            return Ok(Vec::new());
        }

        let base_tree = repo
            .find_commit(range.base)
            .and_then(|c| c.tree())
            .map_err(|e| AppError::Git(format!("failed to get base tree: {e}")))?;
        let head_tree = repo
            .find_commit(range.head)
            .and_then(|c| c.tree())
            .map_err(|e| AppError::Git(format!("failed to get HEAD tree: {e}")))?;

        let mut opts = DiffOptions::new();
        let diff = repo
            .diff_tree_to_tree(Some(&base_tree), Some(&head_tree), Some(&mut opts))
            .map_err(|e| AppError::Git(format!("diff failed: {e}")))?;

        let mut files = diff_to_files(&diff)?;
        populate_tree_content(&repo, &mut files, Some(&base_tree), Some(&head_tree));
        Ok(files)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Get the diff of uncommitted changes (working tree + index vs HEAD).
///
/// Tracked changes come from git2's `diff_tree_to_workdir_with_index`
/// (HEAD tree → index+workdir), which mirrors `git diff HEAD`. We use the
/// `*_with_index` variant — not `diff_index_to_workdir`, which mis-reports
/// every tracked file as deleted on linked worktrees. We also avoid the older
/// `git diff -p` + `Diff::from_buffer` round-trip: libgit2's patch parser
/// rejects valid git output it can't model (e.g. empty-blob add/delete deltas
/// emit no `---`/`+++` lines), which crashed the Changes panel.
///
/// Also includes untracked files (new files not yet staged) by running
/// `git ls-files --others --exclude-standard` and reading their contents.
#[tauri::command]
pub async fn get_uncommitted_diff(repo_path: String) -> Result<Vec<DiffFile>> {
    tokio::task::spawn_blocking(move || {
        let repo = open_repo(&repo_path)?;
        let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

        // 1. Tracked file changes (working tree + index vs HEAD) via git2.
        let mut diff_opts = git2::DiffOptions::new();
        diff_opts.include_untracked(false);
        let mut diff = repo
            .diff_tree_to_workdir_with_index(head_tree.as_ref(), Some(&mut diff_opts))
            .map_err(|e| AppError::Git(format!("failed to diff working tree: {e}")))?;
        // Match `git diff HEAD`'s default rename detection (honors diff.renames).
        diff.find_similar(None)
            .map_err(|e| AppError::Git(format!("rename detection failed: {e}")))?;
        let mut files = diff_to_files(&diff)?;

        // Drop phantom deletions from case-folding collisions. When HEAD contains
        // two paths differing only in case (e.g. `Ui/Button/x` and `ui/button/x`),
        // a case-insensitive filesystem holds a single file, so libgit2 pairs one
        // entry and reports the other as deleted. git CLI hides this via
        // core.ignorecase. A deletion is a phantom only when BOTH hold:
        //   (a) a file still exists at that path on disk (the surviving variant
        //       occupies it on a case-insensitive filesystem), and
        //   (b) HEAD holds another path that case-folds to it (the twin).
        // Genuine deletions fail (b): a recreated file, or a dir/symlink put at the
        // same path, has no case-fold twin in HEAD, so it is preserved. Requiring
        // (a) too keeps real deletions of one twin on case-sensitive filesystems,
        // where the deleted path no longer exists on disk.
        // Residual edge (accepted): on a case-sensitive FS with a real HEAD
        // case-collision, stage-deleting one twin while leaving its file on disk
        // (e.g. `git rm --cached`) is mistaken for a phantom. Disambiguating which
        // twin libgit2 paired isn't worth the complexity for that corner.
        let has_suspect_deletion = files.iter().any(|f| {
            f.status == "deleted" && std::path::Path::new(&repo_path).join(&f.path).exists()
        });
        if has_suspect_deletion {
            let mut head_casefold_counts: HashMap<String, usize> = HashMap::new();
            if let Some(tree) = &head_tree {
                let _ = tree.walk(git2::TreeWalkMode::PreOrder, |root, entry| {
                    if entry.kind() == Some(git2::ObjectType::Blob) {
                        let path = format!("{root}{}", entry.name().unwrap_or_default());
                        *head_casefold_counts.entry(path.to_lowercase()).or_insert(0) += 1;
                    }
                    git2::TreeWalkResult::Ok
                });
            }
            files.retain(|f| {
                if f.status != "deleted" {
                    return true;
                }
                let on_disk = std::path::Path::new(&repo_path).join(&f.path).exists();
                let has_twin = head_casefold_counts
                    .get(&f.path.to_lowercase())
                    .is_some_and(|n| *n > 1);
                !(on_disk && has_twin)
            });
        }

        // 2. Get untracked files (new files not yet git-added)
        let untracked_output = git_command_sync()
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
                        content: format!("+{line}"),
                        old_line_number: None,
                        new_line_number: Some((i + 1) as u32),
                    })
                    .collect();

                let modified_content = if content.len() <= MAX_FULL_FILE_BYTES {
                    Some(content.clone())
                } else {
                    None
                };

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
                    original_content: None,
                    modified_content,
                });
            }
        }

        // 3. Filter out files that should never appear as uncommitted changes.
        //
        // a) Alfredo-injected artifacts (.claude/CLAUDE.local.md, .claude/settings.local.json)
        //    are added to .git/info/exclude, but that only affects untracked files.
        //    If they were ever committed, `git diff HEAD` still reports them — so we
        //    need a hardcoded filter here.
        //
        // b) Also filter via `git check-ignore` for any other gitignored paths that
        //    slip through (e.g. tracked files matching .gitignore).
        const HIDDEN_PATHS: &[&str] = &[
            ".claude/CLAUDE.local.md",
            ".claude/settings.local.json",
        ];
        files.retain(|f| !HIDDEN_PATHS.contains(&f.path.as_str()));

        let all_paths: Vec<String> = files.iter().map(|f| f.path.clone()).collect();
        let ignored = ignored_paths(&repo_path, &all_paths);
        if !ignored.is_empty() {
            files.retain(|f| !ignored.contains(&f.path));
        }

        // 4. Populate full file content (HEAD tree → original, workdir → modified).
        //    The untracked path above already set modified_content for new files;
        //    populate_workdir_content only fills fields that are still None.
        //    `repo` and `head_tree` were computed at the top of this closure.
        populate_workdir_content(&repo, &repo_path, &mut files, head_tree.as_ref());

        Ok(files)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Return the name of the default branch for the given repo.
///
/// Resolution order: `origin/HEAD` first (authoritative), then GitHub API,
/// then `git remote set-head`, then local branches as last resort.
#[tauri::command]
pub async fn get_default_branch(repo_path: String) -> Result<String> {
    // Fast path: return cached origin/HEAD instantly for snappy UI.
    let path_clone = repo_path.clone();
    let fast_result = tokio::task::spawn_blocking(move || {
        let repo = open_repo(&path_clone)?;
        resolve_origin_head(&repo)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?;

    if let Ok(Some(branch)) = &fast_result {
        eprintln!("[alfredo] get_default_branch: origin/HEAD fast path → {branch}");
        spawn_refresh_origin_head(repo_path);
        return Ok(branch.clone());
    }

    eprintln!("[alfredo] get_default_branch: origin/HEAD not cached, result={fast_result:?}");

    // GitHub API fallback: ask GitHub for the repo's default branch.
    if let Ok(branch) = resolve_default_branch_from_github(&repo_path).await {
        eprintln!("[alfredo] get_default_branch: GitHub API → {branch}");
        spawn_refresh_origin_head(repo_path);
        return Ok(branch);
    }

    // git remote set-head fallback: hit the network via git.
    let set_head_result = crate::platform::git_command()
        .args(["remote", "set-head", "origin", "--auto"])
        .current_dir(&repo_path)
        .output()
        .await;

    if let Ok(output) = &set_head_result {
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!("[alfredo] git remote set-head origin --auto failed: {stderr}");
        }
    }

    // Re-read origin/HEAD after network refresh.
    let path_clone = repo_path.clone();
    let head_result = tokio::task::spawn_blocking(move || {
        let repo = open_repo(&path_clone)?;
        resolve_origin_head(&repo)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?;

    if let Ok(Some(branch)) = head_result {
        eprintln!("[alfredo] get_default_branch: origin/HEAD after set-head → {branch}");
        return Ok(branch);
    }

    // Offline fallback: guess from existing remote-tracking branches.
    let result = tokio::task::spawn_blocking(move || {
        let repo = open_repo(&repo_path)?;

        for name in &["main", "develop", "master"] {
            let remote_ref = format!("refs/remotes/origin/{name}");
            if repo.find_reference(&remote_ref).is_ok() {
                return Ok(name.to_string());
            }
        }

        for name in &["main", "develop", "master"] {
            if repo.find_branch(name, git2::BranchType::Local).is_ok() {
                return Ok(name.to_string());
            }
        }

        Ok("main".to_string())
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?;

    eprintln!("[alfredo] get_default_branch: offline fallback → {result:?}");
    result
}

/// Refresh `origin/HEAD` in the background so the next call takes the fast path.
fn spawn_refresh_origin_head(repo_path: String) {
    tokio::spawn(async move {
        let _ = crate::platform::git_command()
            .args(["remote", "set-head", "origin", "--auto"])
            .current_dir(&repo_path)
            .output()
            .await;
    });
}

/// Ask GitHub for the repo's default branch via `gh api`.
async fn resolve_default_branch_from_github(repo_path: &str) -> std::result::Result<String, ()> {
    let (owner, repo) = crate::github_manager::resolve_owner_repo(repo_path)
        .await
        .map_err(|e| eprintln!("[alfredo] resolve_default_branch_from_github: owner/repo failed: {e}"))?;

    let output = crate::platform::gh_command()
        .args(["api", &format!("/repos/{owner}/{repo}"), "--jq", ".default_branch"])
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| eprintln!("[alfredo] resolve_default_branch_from_github: gh api failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[alfredo] resolve_default_branch_from_github: gh api error: {stderr}");
        return Err(());
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if branch.is_empty() {
        eprintln!("[alfredo] resolve_default_branch_from_github: empty response");
        return Err(());
    }

    Ok(branch)
}

/// Extract the branch name from refs/remotes/origin/HEAD if it exists.
fn resolve_origin_head(repo: &git2::Repository) -> Result<Option<String>> {
    if let Ok(reference) = repo.find_reference("refs/remotes/origin/HEAD") {
        if let Ok(resolved) = reference.resolve() {
            if let Ok(name) = resolved.name() {
                if let Some(short) = name.strip_prefix("refs/remotes/origin/") {
                    return Ok(Some(short.to_string()));
                }
            }
        }
    }
    Ok(None)
}

/// Get commits from HEAD back to the merge base with the default branch.
#[tauri::command]
pub async fn get_commits(
    repo_path: String,
    default_branch: Option<String>,
    merge_commit_sha: Option<String>,
    clamp_drift: Option<bool>,
) -> Result<Vec<CommitInfo>> {
    tokio::task::spawn_blocking(move || {
        let repo = open_repo(&repo_path)?;

        let default_oid = resolve_default_branch(&repo, default_branch.as_deref())?;
        let head_oid = repo
            .head()
            .and_then(|h| h.resolve())
            .map_err(|e| AppError::Git(format!("failed to resolve HEAD: {e}")))?
            .target()
            .ok_or_else(|| AppError::Git("HEAD has no target".into()))?;

        // See get_diff: clamp default-branch drift only for a user-selected
        // stack parent, never for a PR base.
        let main_oid = if clamp_drift.unwrap_or(false) {
            stack_clamp_oid(&repo, default_branch.as_deref())
        } else {
            None
        };
        let range = crate::commands::diff_range::resolve_diff_range(
            &repo, default_oid, head_oid, merge_commit_sha.as_deref(), main_oid,
        )?;

        if range.base == range.head {
            return Ok(Vec::new());
        }

        let mut revwalk = repo
            .revwalk()
            .map_err(|e| AppError::Git(format!("revwalk failed: {e}")))?;
        revwalk.push(range.head)
            .map_err(|e| AppError::Git(format!("revwalk push failed: {e}")))?;
        revwalk.hide(range.base)
            .map_err(|e| AppError::Git(format!("revwalk hide failed: {e}")))?;
        revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
            .map_err(|e| AppError::Git(format!("revwalk sorting failed: {e}")))?;

        let mut commits = Vec::new();
        for oid_result in revwalk {
            let oid = oid_result.map_err(|e| AppError::Git(format!("revwalk error: {e}")))?;
            let commit = repo
                .find_commit(oid)
                .map_err(|e| AppError::Git(format!("find commit failed: {e}")))?;
            // Skip merge commits — they appear in the walk when range.head is itself
            // a merge commit (Done worktrees), but the panel wants the feature work,
            // not the merge commit message.
            if commit.parent_count() > 1 {
                continue;
            }
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

        commits.reverse();
        Ok(commits)
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Get the full linear commit history from HEAD, including upstream commits.
#[tauri::command]
pub async fn get_full_commits(repo_path: String, limit: Option<u32>) -> Result<Vec<CommitInfo>> {
    tokio::task::spawn_blocking(move || {
        let repo = open_repo(&repo_path)?;
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
        revwalk
            .set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
            .map_err(|e| AppError::Git(format!("revwalk sorting failed: {e}")))?;

        let cap = limit.unwrap_or(20) as usize;
        let mut commits = Vec::with_capacity(cap);
        for oid_result in revwalk {
            if commits.len() >= cap {
                break;
            }
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

/// Get the git user.name configured for this repository.
#[tauri::command]
pub async fn get_git_user(repo_path: String) -> Result<Option<String>> {
    tokio::task::spawn_blocking(move || {
        let repo = open_repo(&repo_path)?;
        let config = repo
            .config()
            .map_err(|e| AppError::Git(format!("failed to read git config: {e}")))?;
        Ok(config.get_string("user.name").ok())
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

        let mut files = diff_to_files(&diff)?;
        populate_tree_content(&repo, &mut files, parent_tree.as_ref(), Some(&commit_tree));
        Ok(files)
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
            let output = git_command_sync()
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

/// Toggle a `- [ ]` / `- [x]` task-list checkbox on a specific 1-based line.
/// Re-reads the file from disk before writing so concurrent external edits
/// (e.g. an editor open elsewhere) aren't clobbered — if the target line no
/// longer parses as a task-list item, the write is rejected.
#[tauri::command]
pub async fn toggle_task_list_item(
    repo_path: String,
    file_path: String,
    line_number: u32,
    new_checked: bool,
) -> Result<()> {
    tokio::task::spawn_blocking(move || {
        validate_path_within_repo(&repo_path, &file_path)?;

        let full_path = std::path::Path::new(&repo_path).join(&file_path);
        let content = std::fs::read_to_string(&full_path)
            .map_err(|e| AppError::Git(format!("failed to read file: {e}")))?;

        let crlf = content.contains("\r\n");
        let sep = if crlf { "\r\n" } else { "\n" };

        let mut lines: Vec<String> = content.split(sep).map(String::from).collect();
        let idx = (line_number as usize)
            .checked_sub(1)
            .ok_or_else(|| AppError::Git("line_number must be >= 1".into()))?;
        let line = lines
            .get(idx)
            .ok_or_else(|| AppError::Git(format!("line {line_number} out of range")))?;

        let toggled = toggle_task_marker(line, new_checked).ok_or_else(|| {
            AppError::Git(format!(
                "line {line_number} is not a task-list item — file may have changed externally"
            ))
        })?;

        lines[idx] = toggled;
        std::fs::write(&full_path, lines.join(sep))
            .map_err(|e| AppError::Git(format!("failed to write file: {e}")))?;
        Ok(())
    })
    .await
    .map_err(|e| AppError::Git(format!("task join error: {e}")))?
}

/// Replace the `[ ]`/`[x]` marker on a markdown task-list line.
/// Returns `None` if the line isn't a task-list item.
fn toggle_task_marker(line: &str, new_checked: bool) -> Option<String> {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }

    // List marker: `-`, `*`, `+`, or digits followed by `.` or `)`.
    let marker_end = if i < bytes.len() && matches!(bytes[i], b'-' | b'*' | b'+') {
        i + 1
    } else {
        let digits_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i == digits_start || i >= bytes.len() || !matches!(bytes[i], b'.' | b')') {
            return None;
        }
        i + 1
    };

    // Need at least one space/tab after the marker.
    let mut j = marker_end;
    if j >= bytes.len() || !matches!(bytes[j], b' ' | b'\t') {
        return None;
    }
    while j < bytes.len() && matches!(bytes[j], b' ' | b'\t') {
        j += 1;
    }

    // Then `[<x|X| >]`.
    if j + 2 >= bytes.len() || bytes[j] != b'[' || bytes[j + 2] != b']' {
        return None;
    }
    if !matches!(bytes[j + 1], b' ' | b'x' | b'X') {
        return None;
    }

    let mut out = String::with_capacity(line.len());
    out.push_str(&line[..j + 1]);
    out.push(if new_checked { 'x' } else { ' ' });
    out.push_str(&line[j + 2..]);
    Some(out)
}

/// Read full file content, either from the working tree or a specific commit.
/// Used by the rendered markdown preview in the Changes panel.
#[tauri::command]
pub async fn get_file_content(
    repo_path: String,
    file_path: String,
    commit_hash: Option<String>,
) -> Result<String> {
    tokio::task::spawn_blocking(move || {
        if let Some(hash) = commit_hash {
            let output = git_command_sync()
                .args(["show", &format!("{hash}:{file_path}")])
                .current_dir(&repo_path)
                .output()
                .map_err(|e| AppError::Git(format!("failed to run git show: {e}")))?;

            if !output.status.success() {
                let err = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::Git(format!("git show failed: {err}")));
            }

            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            // Defense in depth — Tauri commands are only invokable from the
            // trusted webview, but a poisoned diff entry (e.g. a path coming
            // from a git submodule or weird repo state) shouldn't be able to
            // read outside the worktree.
            validate_path_within_repo(&repo_path, &file_path)?;
            let full_path = std::path::Path::new(&repo_path).join(&file_path);
            std::fs::read_to_string(&full_path)
                .map_err(|e| AppError::Git(format!("failed to read file: {e}")))
        }
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
                let output = git_command_sync()
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
                let _ = git_command_sync()
                    .args(["reset", "HEAD", "--", &file_path])
                    .current_dir(&repo_path)
                    .output();
                let output = git_command_sync()
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
            let output = git_command_sync()
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

#[cfg(test)]
mod tests {
    use super::*;
    use git2::Repository;

    // ── toggle_task_marker ─────────────────────────────
    #[test]
    fn toggle_task_marker_unchecked_to_checked() {
        assert_eq!(
            toggle_task_marker("- [ ] do thing", true).as_deref(),
            Some("- [x] do thing"),
        );
    }
    #[test]
    fn toggle_task_marker_checked_to_unchecked() {
        assert_eq!(
            toggle_task_marker("- [x] done", false).as_deref(),
            Some("- [ ] done"),
        );
    }
    #[test]
    fn toggle_task_marker_capital_x() {
        assert_eq!(
            toggle_task_marker("- [X] done", false).as_deref(),
            Some("- [ ] done"),
        );
    }
    #[test]
    fn toggle_task_marker_indented() {
        assert_eq!(
            toggle_task_marker("    - [ ] nested", true).as_deref(),
            Some("    - [x] nested"),
        );
    }
    #[test]
    fn toggle_task_marker_ordered_list() {
        assert_eq!(
            toggle_task_marker("1. [ ] first", true).as_deref(),
            Some("1. [x] first"),
        );
    }
    #[test]
    fn toggle_task_marker_star_marker() {
        assert_eq!(
            toggle_task_marker("* [ ] thing", true).as_deref(),
            Some("* [x] thing"),
        );
    }
    #[test]
    fn toggle_task_marker_rejects_plain_list_item() {
        assert!(toggle_task_marker("- just a bullet", true).is_none());
    }
    #[test]
    fn toggle_task_marker_rejects_inline_brackets() {
        assert!(toggle_task_marker("see [link](url) for [x] info", true).is_none());
    }
    #[test]
    fn toggle_task_marker_rejects_no_space_after_marker() {
        assert!(toggle_task_marker("-[ ] missing space", true).is_none());
    }
    #[test]
    fn toggle_task_marker_rejects_empty_line() {
        assert!(toggle_task_marker("", true).is_none());
    }

    fn create_test_repo() -> (tempfile::TempDir, Repository) {
        let dir = tempfile::tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();

        let mut config = repo.config().unwrap();
        config.set_str("user.name", "Test").unwrap();
        config.set_str("user.email", "test@test.com").unwrap();

        (dir, repo)
    }

    fn create_commit(repo: &Repository, message: &str) -> git2::Oid {
        let sig = repo.signature().unwrap();
        let tree_id = repo.index().unwrap().write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();

        let parents: Vec<git2::Commit> = match repo.head() {
            Ok(head) => vec![head.peel_to_commit().unwrap()],
            Err(_) => vec![],
        };
        let parent_refs: Vec<&git2::Commit> = parents.iter().collect();

        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)
            .unwrap()
    }

    // ── delta_to_status ──────────────────────────────────────

    #[test]
    fn delta_to_status_added() {
        assert_eq!(delta_to_status(Delta::Added), "added");
    }

    #[test]
    fn delta_to_status_deleted() {
        assert_eq!(delta_to_status(Delta::Deleted), "deleted");
    }

    #[test]
    fn delta_to_status_renamed() {
        assert_eq!(delta_to_status(Delta::Renamed), "renamed");
    }

    #[test]
    fn delta_to_status_modified() {
        assert_eq!(delta_to_status(Delta::Modified), "modified");
    }

    #[test]
    fn delta_to_status_typechange() {
        assert_eq!(delta_to_status(Delta::Typechange), "modified");
    }

    #[test]
    fn delta_to_status_copied() {
        assert_eq!(delta_to_status(Delta::Copied), "modified");
    }

    // ── validate_path_within_repo ────────────────────────────

    #[test]
    fn validate_path_normal_file_passes() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("hello.txt");
        std::fs::write(&file, "hi").unwrap();

        let result = validate_path_within_repo(dir.path().to_str().unwrap(), "hello.txt");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_path_nested_file_passes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("src/lib")).unwrap();
        let file = dir.path().join("src/lib/mod.rs");
        std::fs::write(&file, "// code").unwrap();

        let result = validate_path_within_repo(dir.path().to_str().unwrap(), "src/lib/mod.rs");
        assert!(result.is_ok());
    }

    #[test]
    fn validate_path_traversal_fails() {
        let dir = tempfile::tempdir().unwrap();
        // Create a subdirectory to use as "repo" and a file outside it
        let inside = dir.path().join("repo");
        std::fs::create_dir(&inside).unwrap();
        std::fs::write(dir.path().join("secret.txt"), "secret").unwrap();

        let result = validate_path_within_repo(inside.to_str().unwrap(), "../secret.txt");
        assert!(result.is_err());
        let err_msg = format!("{:?}", result.unwrap_err());
        assert!(
            err_msg.contains("escapes repository"),
            "expected 'escapes repository' in: {err_msg}"
        );
    }

    // ── diff_to_files ────────────────────────────────────────

    #[test]
    fn diff_to_files_detects_modified_file() {
        let (dir, repo) = create_test_repo();

        // First commit: create a file
        let file_path = dir.path().join("readme.txt");
        std::fs::write(&file_path, "line one\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("readme.txt")).unwrap();
        index.write().unwrap();
        let oid1 = create_commit(&repo, "initial");

        // Second commit: modify the file
        std::fs::write(&file_path, "line one\nline two\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("readme.txt")).unwrap();
        index.write().unwrap();
        let oid2 = create_commit(&repo, "add line two");

        let tree1 = repo.find_commit(oid1).unwrap().tree().unwrap();
        let tree2 = repo.find_commit(oid2).unwrap().tree().unwrap();
        let mut opts = DiffOptions::new();
        let diff = repo
            .diff_tree_to_tree(Some(&tree1), Some(&tree2), Some(&mut opts))
            .unwrap();

        let files = diff_to_files(&diff).unwrap();
        assert_eq!(files.len(), 1);

        let f = &files[0];
        assert_eq!(f.path, "readme.txt");
        assert_eq!(f.status, "modified");
        assert_eq!(f.additions, 1);
        assert_eq!(f.deletions, 0);
        assert!(!f.hunks.is_empty(), "should have at least one hunk");

        let hunk = &f.hunks[0];
        assert!(hunk.new_start > 0);
        let addition_lines: Vec<_> = hunk
            .lines
            .iter()
            .filter(|l| l.line_type == "addition")
            .collect();
        assert_eq!(addition_lines.len(), 1);
        assert!(addition_lines[0].new_line_number.is_some());
    }

    #[test]
    fn diff_to_files_detects_added_file() {
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join("dummy.txt"), "x").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("dummy.txt")).unwrap();
        index.write().unwrap();
        let oid1 = create_commit(&repo, "initial");

        std::fs::write(dir.path().join("new.txt"), "hello\nworld\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("new.txt")).unwrap();
        index.write().unwrap();
        let oid2 = create_commit(&repo, "add new file");

        let tree1 = repo.find_commit(oid1).unwrap().tree().unwrap();
        let tree2 = repo.find_commit(oid2).unwrap().tree().unwrap();
        let mut opts = DiffOptions::new();
        let diff = repo
            .diff_tree_to_tree(Some(&tree1), Some(&tree2), Some(&mut opts))
            .unwrap();

        let files = diff_to_files(&diff).unwrap();
        let added = files.iter().find(|f| f.path == "new.txt").unwrap();
        assert_eq!(added.status, "added");
        assert_eq!(added.additions, 2);
        assert_eq!(added.deletions, 0);
    }

    #[test]
    fn diff_to_files_detects_deleted_file() {
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join("keep.txt"), "stay").unwrap();
        std::fs::write(dir.path().join("remove.txt"), "gone\nsoon\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("keep.txt")).unwrap();
        index.add_path(std::path::Path::new("remove.txt")).unwrap();
        index.write().unwrap();
        let oid1 = create_commit(&repo, "initial");

        let mut index = repo.index().unwrap();
        index.remove_path(std::path::Path::new("remove.txt")).unwrap();
        index.write().unwrap();
        let oid2 = create_commit(&repo, "remove file");

        let tree1 = repo.find_commit(oid1).unwrap().tree().unwrap();
        let tree2 = repo.find_commit(oid2).unwrap().tree().unwrap();
        let mut opts = DiffOptions::new();
        let diff = repo
            .diff_tree_to_tree(Some(&tree1), Some(&tree2), Some(&mut opts))
            .unwrap();

        let files = diff_to_files(&diff).unwrap();
        let deleted = files.iter().find(|f| f.path == "remove.txt").unwrap();
        assert_eq!(deleted.status, "deleted");
        assert_eq!(deleted.deletions, 2);
        assert_eq!(deleted.additions, 0);
    }

    // ── resolve_default_branch ───────────────────────────────

    #[test]
    fn resolve_default_branch_finds_local_main() {
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join("f.txt"), "x").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("f.txt")).unwrap();
        index.write().unwrap();
        create_commit(&repo, "init");

        let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("main", &head_commit, true).unwrap();

        let result = resolve_default_branch(&repo, None);
        assert!(result.is_ok(), "should resolve: {result:?}");
    }

    #[test]
    fn resolve_default_branch_with_explicit_name() {
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join("f.txt"), "x").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("f.txt")).unwrap();
        index.write().unwrap();
        create_commit(&repo, "init");

        let head_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("develop", &head_commit, true).unwrap();

        let result = resolve_default_branch(&repo, Some("develop"));
        assert!(result.is_ok(), "should resolve explicit branch: {result:?}");
    }

    #[test]
    fn resolve_default_branch_errors_when_no_branches_match() {
        let (_dir, repo) = create_test_repo();

        // No commits, no branches
        let result = resolve_default_branch(&repo, None);
        assert!(result.is_err());
    }

    // ── resolve_origin_head ──────────────────────────────────

    #[test]
    fn resolve_origin_head_returns_none_without_remote() {
        let (_dir, repo) = create_test_repo();
        let result = resolve_origin_head(&repo).unwrap();
        assert!(result.is_none(), "should be None without origin/HEAD");
    }

    // ── ignored_paths ────────────────────────────────────────

    #[test]
    fn ignored_paths_respects_gitignore() {
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join(".gitignore"), "*.log\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(".gitignore")).unwrap();
        index.write().unwrap();
        create_commit(&repo, "add gitignore");

        let repo_path = dir.path().to_str().unwrap();
        let paths = vec!["foo.log".to_string(), "foo.txt".to_string()];
        let result = ignored_paths(repo_path, &paths);

        assert!(
            result.contains("foo.log"),
            "foo.log should be ignored, got: {result:?}"
        );
        assert!(
            !result.contains("foo.txt"),
            "foo.txt should NOT be ignored, got: {result:?}"
        );
    }

    #[test]
    fn ignored_paths_empty_input_returns_empty() {
        let (dir, _repo) = create_test_repo();
        let repo_path = dir.path().to_str().unwrap();
        let result = ignored_paths(repo_path, &[]);
        assert!(result.is_empty());
    }

    // ── diff_to_files converter, fed via Diff::from_buffer ──────────────
    // These characterize `diff_to_files` against real CLI diff text. NOTE:
    // `get_uncommitted_diff` no longer uses `Diff::from_buffer` — it builds the
    // git2::Diff natively — so these guard the converter, not the live path.

    /// Generate a real unified diff using git CLI, to feed `Diff::from_buffer`.
    fn generate_cli_diff(repo_path: &str, old_hash: &str, new_hash: &str) -> Vec<u8> {
        let output = std::process::Command::new("git")
            .args(["diff", old_hash, new_hash, "--no-ext-diff", "-p", "--no-color"])
            .current_dir(repo_path)
            .output()
            .expect("git diff should succeed");
        assert!(output.status.success(), "git diff failed: {}", String::from_utf8_lossy(&output.stderr));
        output.stdout
    }

    #[test]
    fn diff_from_buffer_round_trips_through_parse() {
        // Generate a real diff via git CLI, then parse via Diff::from_buffer +
        // diff_to_files. Exercises the diff_to_files converter.
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join("hello.txt"), "line one\nline three\nline four\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("hello.txt")).unwrap();
        index.write().unwrap();
        let oid1 = create_commit(&repo, "initial");

        std::fs::write(dir.path().join("hello.txt"), "line one\nline two\nline three\nline four\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("hello.txt")).unwrap();
        index.write().unwrap();
        let oid2 = create_commit(&repo, "add line two");

        let repo_path = dir.path().to_str().unwrap();
        let patch_bytes = generate_cli_diff(repo_path, &oid1.to_string(), &oid2.to_string());

        // Parse via from_buffer — this is the API boundary under test
        let parsed_diff = git2::Diff::from_buffer(&patch_bytes)
            .expect("from_buffer should round-trip a real CLI diff");
        let files = diff_to_files(&parsed_diff).expect("diff_to_files should succeed");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "hello.txt");
        assert_eq!(files[0].status, "modified");
        assert_eq!(files[0].additions, 1);
        assert_eq!(files[0].deletions, 0);
        assert_eq!(files[0].hunks.len(), 1);

        let addition = files[0].hunks[0]
            .lines
            .iter()
            .find(|l| l.line_type == "addition")
            .expect("should have an addition line");
        assert!(addition.content.contains("line two"));
        assert!(addition.new_line_number.is_some());
    }

    #[test]
    fn diff_from_buffer_handles_multiple_files() {
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join("a.txt"), "existing\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        index.write().unwrap();
        let oid1 = create_commit(&repo, "initial");

        std::fs::write(dir.path().join("a.txt"), "existing\nadded in a\n").unwrap();
        std::fs::write(dir.path().join("b.txt"), "new file line 1\nnew file line 2\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        index.add_path(std::path::Path::new("b.txt")).unwrap();
        index.write().unwrap();
        let oid2 = create_commit(&repo, "multi-file change");

        let repo_path = dir.path().to_str().unwrap();
        let patch_bytes = generate_cli_diff(repo_path, &oid1.to_string(), &oid2.to_string());

        let parsed_diff = git2::Diff::from_buffer(&patch_bytes)
            .expect("from_buffer should parse multi-file diff");
        let files = diff_to_files(&parsed_diff).expect("diff_to_files should succeed");

        assert_eq!(files.len(), 2);

        let a = files.iter().find(|f| f.path == "a.txt").expect("should have a.txt");
        assert_eq!(a.status, "modified");
        assert_eq!(a.additions, 1);

        let b = files.iter().find(|f| f.path == "b.txt").expect("should have b.txt");
        assert_eq!(b.status, "added");
        assert_eq!(b.additions, 2);
        assert_eq!(b.deletions, 0);
    }

    #[test]
    fn diff_from_buffer_handles_deletion_diff() {
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join("gone.txt"), "line one\nline two\nline three\n").unwrap();
        std::fs::write(dir.path().join("keep.txt"), "stay\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("gone.txt")).unwrap();
        index.add_path(std::path::Path::new("keep.txt")).unwrap();
        index.write().unwrap();
        let oid1 = create_commit(&repo, "initial");

        let mut index = repo.index().unwrap();
        index.remove_path(std::path::Path::new("gone.txt")).unwrap();
        index.write().unwrap();
        let oid2 = create_commit(&repo, "delete file");

        let repo_path = dir.path().to_str().unwrap();
        let patch_bytes = generate_cli_diff(repo_path, &oid1.to_string(), &oid2.to_string());

        let parsed_diff = git2::Diff::from_buffer(&patch_bytes)
            .expect("from_buffer should parse deletion diff");
        let files = diff_to_files(&parsed_diff).expect("diff_to_files should succeed");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "gone.txt");
        assert_eq!(files[0].status, "deleted");
        assert_eq!(files[0].additions, 0);
        assert_eq!(files[0].deletions, 3);
    }

    #[test]
    fn diff_from_buffer_empty_input_yields_no_files() {
        let diff = git2::Diff::from_buffer(b"").expect("from_buffer should handle empty input");
        let files = diff_to_files(&diff).expect("diff_to_files should succeed");
        assert!(files.is_empty());
    }

    #[tokio::test]
    async fn uncommitted_diff_keeps_real_deletion_when_path_recreated() {
        // The phantom-deletion filter must not hide genuine deletions. Here a file
        // is staged-deleted (`git rm`) and a new untracked file is dropped at the
        // same path. The deletion has no case-fold twin in HEAD, so it must survive
        // even though something now occupies its path on disk.
        let (dir, repo) = create_test_repo();
        std::fs::write(dir.path().join("bar.txt"), "orig\n").unwrap();
        {
            let mut index = repo.index().unwrap();
            index.add_path(std::path::Path::new("bar.txt")).unwrap();
            index.write().unwrap();
        }
        create_commit(&repo, "initial");

        let rm = std::process::Command::new("git")
            .args(["rm", "bar.txt"])
            .current_dir(dir.path())
            .output()
            .unwrap();
        assert!(rm.status.success(), "git rm failed");
        std::fs::write(dir.path().join("bar.txt"), "brand new\n").unwrap();

        let repo_path = dir.path().to_str().unwrap().to_string();
        let files = get_uncommitted_diff(repo_path).await.expect("diff should succeed");

        assert!(
            files.iter().any(|f| f.path == "bar.txt" && f.status == "deleted"),
            "real deletion must survive the phantom filter, got: {:?}",
            files.iter().map(|f| (&f.path, &f.status)).collect::<Vec<_>>()
        );
    }

    #[cfg(target_os = "macos")]
    #[tokio::test]
    async fn uncommitted_diff_filters_case_collision_phantom_on_macos() {
        // Two committed paths differing only in case collapse to one file on a
        // case-insensitive filesystem, so libgit2 reports the other as deleted.
        // That phantom must be filtered. The colliding file is left unchanged
        // (its surviving twin is therefore absent from the diff, mirroring the
        // real bug) and an unrelated file carries the actual change.
        use std::process::Command;
        fn git(args: &[&str], d: &std::path::Path) {
            assert!(
                Command::new("git").args(args).current_dir(d).output().unwrap().status.success(),
                "git {args:?} failed"
            );
        }
        let (dir, _repo) = create_test_repo();
        let d = dir.path();
        git(&["config", "core.ignorecase", "false"], d);
        std::fs::create_dir_all(d.join("dir/Sub")).unwrap();
        std::fs::write(d.join("dir/Sub/x.txt"), "hi\n").unwrap();
        std::fs::write(d.join("y.txt"), "orig\n").unwrap();
        git(&["add", "dir/Sub/x.txt", "y.txt"], d);
        let blob = Command::new("git")
            .args(["rev-parse", ":dir/Sub/x.txt"])
            .current_dir(d)
            .output()
            .unwrap();
        let blob = String::from_utf8_lossy(&blob.stdout).trim().to_string();
        git(&["update-index", "--add", "--cacheinfo", &format!("100644,{blob},dir/sub/x.txt")], d);
        git(&["commit", "-m", "case collision"], d);

        std::fs::write(d.join("y.txt"), "changed\n").unwrap();

        let files = get_uncommitted_diff(d.to_str().unwrap().to_string())
            .await
            .expect("diff should succeed");

        assert!(
            !files.iter().any(|f| f.status == "deleted"),
            "case-collision phantom deletion must be filtered, got: {:?}",
            files.iter().map(|f| (&f.path, &f.status)).collect::<Vec<_>>()
        );
        assert!(
            files.iter().any(|f| f.path == "y.txt" && f.status == "modified"),
            "the real change must still be reported"
        );
    }

    #[tokio::test]
    async fn uncommitted_diff_handles_empty_file_deletion() {
        // Regression: a zero-byte tracked file that is deleted emits a git diff
        // header with no ---/+++/hunk lines. The old `git diff -p` +
        // Diff::from_buffer path crashed with "invalid patch header"; the native
        // git2 diff must report it without error.
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join(".keep"), "").unwrap();
        std::fs::write(dir.path().join("a.txt"), "one\ntwo\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new(".keep")).unwrap();
        index.add_path(std::path::Path::new("a.txt")).unwrap();
        index.write().unwrap();
        create_commit(&repo, "initial");

        std::fs::remove_file(dir.path().join(".keep")).unwrap();
        std::fs::write(dir.path().join("a.txt"), "one\ntwo\nthree\n").unwrap();

        let repo_path = dir.path().to_str().unwrap().to_string();
        let files = get_uncommitted_diff(repo_path)
            .await
            .expect("empty-file deletion must not crash the diff");

        let keep = files
            .iter()
            .find(|f| f.path == ".keep")
            .expect("empty .keep deletion should be reported");
        assert_eq!(keep.status, "deleted");

        let a = files
            .iter()
            .find(|f| f.path == "a.txt")
            .expect("modified a.txt should be reported");
        assert_eq!(a.status, "modified");
        assert_eq!(a.additions, 1);
    }

    // ── get_commits (exercises git2 revwalk API) ────────────────

    #[test]
    fn get_commits_returns_branch_only_commits() {
        let (dir, repo) = create_test_repo();

        // Create initial commit on main
        std::fs::write(dir.path().join("f.txt"), "v1").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("f.txt")).unwrap();
        index.write().unwrap();
        let base_oid = create_commit(&repo, "base commit");

        // Create a "main" branch at this commit for resolve_default_branch
        let base_commit = repo.find_commit(base_oid).unwrap();
        repo.branch("main", &base_commit, true).unwrap();

        // Create a feature branch and add commits
        repo.set_head("refs/heads/main").unwrap();
        let feature_branch = repo.branch("feature", &base_commit, false).unwrap();
        repo.set_head(feature_branch.get().name().unwrap()).unwrap();
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force())).unwrap();

        std::fs::write(dir.path().join("f.txt"), "v2").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("f.txt")).unwrap();
        index.write().unwrap();
        let _feat_oid = create_commit(&repo, "feature commit 1");

        std::fs::write(dir.path().join("f.txt"), "v3").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("f.txt")).unwrap();
        index.write().unwrap();
        let _feat_oid2 = create_commit(&repo, "feature commit 2");

        // Exercise the revwalk API the same way get_commits does
        let default_oid = resolve_default_branch(&repo, Some("main")).unwrap();
        let head_oid = repo.head().unwrap().resolve().unwrap().target().unwrap();

        let mut revwalk = repo.revwalk().unwrap();
        revwalk.push(head_oid).unwrap();
        revwalk.hide(default_oid).unwrap();
        revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME).unwrap();

        #[allow(clippy::redundant_closure_for_method_calls)]
        let commits: Vec<git2::Oid> = revwalk.filter_map(|r| r.ok()).collect();
        assert_eq!(commits.len(), 2, "should find exactly the 2 feature commits");

        // Verify we can read commit data (exercises find_commit + author/message APIs)
        for oid in &commits {
            let commit = repo.find_commit(*oid).unwrap();
            assert!(!commit.message().unwrap_or("").is_empty());
            assert!(commit.author().name().is_ok());
            assert!(commit.time().seconds() > 0);
        }
    }

    #[test]
    fn get_commits_skips_merge_commit_when_head_is_merge() {
        // Topology mirrors the Done-worktree case: main has been merged via a
        // merge commit. range.head resolves to the merge commit, range.base to
        // its first parent. The revwalk yields both the merge commit and the
        // feature commit; the filter must drop the merge commit so the Commits
        // panel shows only the feature work.
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join("f.txt"), "v1").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("f.txt")).unwrap();
        index.write().unwrap();
        let fork_oid = create_commit(&repo, "fork point");

        std::fs::write(dir.path().join("f.txt"), "v2").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("f.txt")).unwrap();
        index.write().unwrap();
        let feature_oid = create_commit(&repo, "feature commit");

        let sig = repo.signature().unwrap();
        let merge_tree = repo.find_commit(feature_oid).unwrap().tree().unwrap();
        let merge_oid = repo
            .commit(
                None,
                &sig,
                &sig,
                "Merge PR",
                &merge_tree,
                &[
                    &repo.find_commit(fork_oid).unwrap(),
                    &repo.find_commit(feature_oid).unwrap(),
                ],
            )
            .unwrap();

        // Mirror what get_commits does after resolve_diff_range returns
        // (base = fork_oid, head = merge_oid) for a merged Done worktree.
        let mut revwalk = repo.revwalk().unwrap();
        revwalk.push(merge_oid).unwrap();
        revwalk.hide(fork_oid).unwrap();
        revwalk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME).unwrap();

        let mut kept = Vec::new();
        for oid_result in revwalk {
            let oid = oid_result.unwrap();
            let commit = repo.find_commit(oid).unwrap();
            if commit.parent_count() > 1 {
                continue;
            }
            kept.push(oid);
        }

        assert_eq!(kept.len(), 1, "merge commit should be filtered out");
        assert_eq!(kept[0], feature_oid, "only the feature commit should remain");
        assert!(!kept.contains(&merge_oid), "merge commit must not appear");
    }

    // ── get_diff_for_commit (exercises tree-to-tree diff for single commit) ─

    #[test]
    fn diff_for_commit_against_parent() {
        let (dir, repo) = create_test_repo();

        // Initial commit
        std::fs::write(dir.path().join("file.rs"), "fn main() {}\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("file.rs")).unwrap();
        index.write().unwrap();
        let oid1 = create_commit(&repo, "initial");

        // Second commit modifies the file
        std::fs::write(dir.path().join("file.rs"), "fn main() {\n    println!(\"hello\");\n}\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("file.rs")).unwrap();
        index.write().unwrap();
        let oid2 = create_commit(&repo, "add println");

        // Replicate get_diff_for_commit logic: diff commit vs parent
        let commit = repo.find_commit(oid2).unwrap();
        let commit_tree = commit.tree().unwrap();
        let parent_tree = commit.parent(0).unwrap().tree().unwrap();

        let mut opts = DiffOptions::new();
        let diff = repo
            .diff_tree_to_tree(Some(&parent_tree), Some(&commit_tree), Some(&mut opts))
            .unwrap();

        let files = diff_to_files(&diff).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "file.rs");
        assert!(files[0].additions > 0, "should have additions");

        // First commit (no parent): diff against empty tree
        let first_commit = repo.find_commit(oid1).unwrap();
        let first_tree = first_commit.tree().unwrap();
        assert_eq!(first_commit.parent_count(), 0);

        let diff_initial = repo
            .diff_tree_to_tree(None, Some(&first_tree), Some(&mut opts))
            .unwrap();
        let initial_files = diff_to_files(&diff_initial).unwrap();
        assert_eq!(initial_files.len(), 1);
        assert_eq!(initial_files[0].status, "added");
    }

    // ── populate_tree_content (B.1: full-file content for the renderer) ──

    /// Build a tree-to-tree diff between two commits and run it through
    /// `diff_to_files` + `populate_tree_content`, mirroring `get_diff`.
    fn diff_with_content(
        repo: &Repository,
        old_oid: git2::Oid,
        new_oid: git2::Oid,
    ) -> Vec<DiffFile> {
        let old_tree = repo.find_commit(old_oid).unwrap().tree().unwrap();
        let new_tree = repo.find_commit(new_oid).unwrap().tree().unwrap();
        let mut opts = DiffOptions::new();
        opts.include_typechange(true);
        let diff = repo
            .diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(&mut opts))
            .unwrap();
        let mut files = diff_to_files(&diff).unwrap();
        populate_tree_content(repo, &mut files, Some(&old_tree), Some(&new_tree));
        files
    }

    #[test]
    fn populate_tree_content_modified_file() {
        let (dir, repo) = create_test_repo();

        let file_path = dir.path().join("greeting.txt");
        std::fs::write(&file_path, "hello\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("greeting.txt")).unwrap();
        index.write().unwrap();
        let oid1 = create_commit(&repo, "initial");

        std::fs::write(&file_path, "hello\nworld\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("greeting.txt")).unwrap();
        index.write().unwrap();
        let oid2 = create_commit(&repo, "add line");

        let files = diff_with_content(&repo, oid1, oid2);
        assert_eq!(files.len(), 1);
        let f = &files[0];
        assert_eq!(f.status, "modified");
        assert_eq!(f.original_content.as_deref(), Some("hello\n"));
        assert_eq!(f.modified_content.as_deref(), Some("hello\nworld\n"));
    }

    #[test]
    fn populate_tree_content_added_file() {
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join("seed.txt"), "x").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("seed.txt")).unwrap();
        index.write().unwrap();
        let oid1 = create_commit(&repo, "initial");

        std::fs::write(dir.path().join("fresh.txt"), "brand new\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("fresh.txt")).unwrap();
        index.write().unwrap();
        let oid2 = create_commit(&repo, "add fresh");

        let files = diff_with_content(&repo, oid1, oid2);
        let added = files.iter().find(|f| f.path == "fresh.txt").unwrap();
        assert_eq!(added.status, "added");
        assert!(added.original_content.is_none(), "added files have no original");
        assert_eq!(added.modified_content.as_deref(), Some("brand new\n"));
    }

    #[test]
    fn populate_tree_content_deleted_file() {
        let (dir, repo) = create_test_repo();

        std::fs::write(dir.path().join("keep.txt"), "stay").unwrap();
        std::fs::write(dir.path().join("doomed.txt"), "goodbye\n").unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("keep.txt")).unwrap();
        index.add_path(std::path::Path::new("doomed.txt")).unwrap();
        index.write().unwrap();
        let oid1 = create_commit(&repo, "initial");

        let mut index = repo.index().unwrap();
        index.remove_path(std::path::Path::new("doomed.txt")).unwrap();
        index.write().unwrap();
        let oid2 = create_commit(&repo, "delete doomed");

        let files = diff_with_content(&repo, oid1, oid2);
        let deleted = files.iter().find(|f| f.path == "doomed.txt").unwrap();
        assert_eq!(deleted.status, "deleted");
        assert_eq!(deleted.original_content.as_deref(), Some("goodbye\n"));
        assert!(deleted.modified_content.is_none(), "deleted files have no modified");
    }

    #[test]
    fn populate_tree_content_renamed_file() {
        let (dir, repo) = create_test_repo();

        let body = "alpha\nbeta\ngamma\ndelta\nepsilon\n";
        std::fs::write(dir.path().join("old_name.txt"), body).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("old_name.txt")).unwrap();
        index.write().unwrap();
        let oid1 = create_commit(&repo, "initial");

        std::fs::remove_file(dir.path().join("old_name.txt")).unwrap();
        std::fs::write(dir.path().join("new_name.txt"), body).unwrap();
        let mut index = repo.index().unwrap();
        index.remove_path(std::path::Path::new("old_name.txt")).unwrap();
        index.add_path(std::path::Path::new("new_name.txt")).unwrap();
        index.write().unwrap();
        let oid2 = create_commit(&repo, "rename file");

        // Rename detection has to be opted-in on the diff itself.
        let tree1 = repo.find_commit(oid1).unwrap().tree().unwrap();
        let tree2 = repo.find_commit(oid2).unwrap().tree().unwrap();
        let mut opts = DiffOptions::new();
        let mut diff = repo
            .diff_tree_to_tree(Some(&tree1), Some(&tree2), Some(&mut opts))
            .unwrap();
        let mut find_opts = git2::DiffFindOptions::new();
        find_opts.renames(true);
        diff.find_similar(Some(&mut find_opts)).unwrap();

        let mut files = diff_to_files(&diff).unwrap();
        populate_tree_content(&repo, &mut files, Some(&tree1), Some(&tree2));

        let renamed = files.iter().find(|f| f.path == "new_name.txt").unwrap();
        assert_eq!(renamed.status, "renamed");
        assert_eq!(renamed.old_path.as_deref(), Some("old_name.txt"));
        assert_eq!(renamed.original_content.as_deref(), Some(body));
        assert_eq!(renamed.modified_content.as_deref(), Some(body));
    }

    #[test]
    fn read_tree_blob_skips_binary() {
        let (dir, repo) = create_test_repo();

        // Bytes with embedded NUL trip libgit2's binary detection.
        let bytes: Vec<u8> = vec![0xFF, 0xD8, 0xFF, 0x00, 0x01, 0x02, 0x03, 0x04];
        std::fs::write(dir.path().join("blob.bin"), &bytes).unwrap();
        let mut index = repo.index().unwrap();
        index.add_path(std::path::Path::new("blob.bin")).unwrap();
        index.write().unwrap();
        let oid = create_commit(&repo, "add binary");

        let tree = repo.find_commit(oid).unwrap().tree().unwrap();
        assert!(read_tree_blob(&repo, &tree, "blob.bin").is_none());
    }

    #[test]
    fn read_workdir_blob_skips_binary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("photo.bin");
        std::fs::write(&path, [0xFFu8, 0x00, 0x01, 0x02]).unwrap();
        assert!(read_workdir_blob(dir.path().to_str().unwrap(), "photo.bin").is_none());
    }

    #[test]
    fn read_workdir_blob_reads_text() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("notes.md"), "# hi\n").unwrap();
        assert_eq!(
            read_workdir_blob(dir.path().to_str().unwrap(), "notes.md").as_deref(),
            Some("# hi\n"),
        );
    }
}
