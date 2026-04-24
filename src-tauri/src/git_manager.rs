use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use git2::Repository;

pub(crate) use crate::platform::{git_command, git_command_sync};
use crate::types::{AppError, Worktree, AgentState, KanbanColumn};

/// Throttle remote fetches to at most once per 60 seconds per repo+ref pair.
/// Prevents N+1 network calls when computing diff stats for many worktrees.
static FETCH_THROTTLE: std::sync::LazyLock<Mutex<HashMap<String, Instant>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

/// Create a worktree by shelling out to `git worktree add`.
/// Returns the absolute path of the new worktree directory.
///
/// When `base_branch` is a plain branch name (e.g. "main"), this function
/// fetches from origin first and uses `origin/<base_branch>` so the worktree
/// starts from the latest remote state rather than a potentially stale local ref.
/// Return the configured remote names for a repo (e.g. `["origin"]`, or
/// `["origin", "upstream"]` for forks). Origin is listed first when present
/// so fetch attempts start with the most likely source. Returns an empty
/// vec if `git remote` fails — callers should handle that as "no fetch".
async fn list_remote_names(repo_path: &str) -> Vec<String> {
    let output = match git_command()
        .args(["remote"])
        .current_dir(repo_path)
        .output()
        .await
    {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };

    let mut names: Vec<String> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();

    if let Some(pos) = names.iter().position(|n| n == "origin") {
        if pos != 0 {
            let origin = names.remove(pos);
            names.insert(0, origin);
        }
    }

    names
}

/// Fetch all remotes for a repo, throttled per repo to once per 30s. Swallows
/// errors — offline or auth-broken remotes must not prevent the UI from
/// listing branches. Runs `git fetch --all --no-tags --quiet` so remote-only
/// branches (e.g. work pushed from another machine) become visible to
/// `list_branches`.
pub async fn fetch_all_for_branch_list(repo_path: &str) {
    const THROTTLE: std::time::Duration = std::time::Duration::from_secs(30);
    let key = format!("branchlist:{repo_path}");

    let should_fetch = {
        let Ok(mut map) = FETCH_THROTTLE.lock() else {
            tracing::warn!("[fetch_all_for_branch_list] FETCH_THROTTLE poisoned; skipping fetch");
            return;
        };
        match map.get(&key) {
            Some(last) if last.elapsed() < THROTTLE => false,
            _ => {
                map.insert(key, Instant::now());
                true
            }
        }
    };

    if !should_fetch {
        return;
    }

    let fetch = git_command()
        .args(["fetch", "--all", "--no-tags", "--quiet", "--no-auto-maintenance"])
        .current_dir(repo_path)
        .output();

    // Cap the wait so a slow or hung remote can't stall the branch picker.
    // Stale local refs are still a usable fallback.
    let _ = tokio::time::timeout(std::time::Duration::from_secs(3), fetch).await;
}

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

    // Clean up stale worktree entries and leftover directories from partial
    // deletes so they don't block creation.
    let _ = git_command()
        .args(["worktree", "prune"])
        .current_dir(repo_path)
        .output()
        .await;

    if worktree_dir.exists() {
        // Check if git still tracks this path as a worktree
        let list_output = git_command()
            .args(["worktree", "list", "--porcelain"])
            .current_dir(repo_path)
            .output()
            .await
            .ok();
        let is_tracked = list_output
            .as_ref()
            .map(|o| {
                let stdout = String::from_utf8_lossy(&o.stdout);
                stdout.contains(worktree_dir.to_str().unwrap_or_default())
            })
            .unwrap_or(false);
        if !is_tracked {
            // Leftover directory not tracked by git — safe to remove
            tokio::fs::remove_dir_all(&worktree_dir).await.map_err(|e| {
                AppError::Git(format!(
                    "leftover directory {} could not be removed: {e}",
                    worktree_dir.display()
                ))
            })?;
        }
    }

    // Use the remote tracking branch so worktrees start from the latest
    // remote state, not a potentially stale local branch. Enumerate the
    // repo's actual remotes (rather than assuming "origin") so forks with
    // "upstream" or renamed remotes work too. Strip any matching remote
    // prefix off the caller-provided base, then try fetching from each
    // remote — the first one that has the branch wins and we use its
    // tracking ref as the startpoint. If no remote has it (stacked local
    // branches, local-only repos, offline), fall back to the ref as given.
    let remote_names = list_remote_names(repo_path).await;
    let fetch_target = remote_names
        .iter()
        .find_map(|r| base_branch.strip_prefix(&format!("{r}/")))
        .unwrap_or(base_branch);

    let mut effective_base = base_branch.to_string();
    for remote in &remote_names {
        let fetch_ok = git_command()
            .args(["fetch", remote, fetch_target])
            .current_dir(repo_path)
            .output()
            .await
            .map(|o| o.status.success())
            .unwrap_or(false);
        if fetch_ok {
            effective_base = format!("{remote}/{fetch_target}");
            break;
        }
    }

    // Try creating with a new branch first; if the branch already exists,
    // fall back to using the existing branch.
    let output = git_command()
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
            let output2 = git_command()
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

/// Delete a worktree by shelling out to `git worktree remove`, then delete
/// the local branch with `git branch -D`.
///
/// # Behavior
/// - The local branch is **always** deleted, regardless of `force`. If the
///   branch isn't found (e.g. detached HEAD, already gone) the error is
///   swallowed. `force` only gates whether the worktree removal is forced.
/// - If `force` is true, passes `--force` to `git worktree remove` to allow
///   removing dirty worktrees, and falls back to a manual directory nuke if
///   git still refuses.
/// - If `force` is false and git refuses for any reason *other* than
///   `"not a working tree"` (e.g. the worktree is dirty), the error is
///   surfaced to the caller — we do not silently nuke dirty worktrees.
///
/// Resolves the on-disk path via `git worktree list --porcelain` rather than
/// recomputing it from `worktree_name` + `base_path`, so it works even when
/// the worktree was created under a different base or with a branch name that
/// doesn't match the sanitized dir name.
pub async fn delete_worktree(
    repo_path: &str,
    worktree_name: &str,
    force: bool,
    base_path: Option<&str>,
) -> Result<(), AppError> {
    let (resolved_path, resolved_branch) =
        resolve_worktree(repo_path, worktree_name, base_path).await;

    // Prune stale worktree entries first so a previous partial delete doesn't block us
    let _ = git_command()
        .args(["worktree", "prune"])
        .current_dir(repo_path)
        .output()
        .await;

    let path_str = resolved_path.to_string_lossy().into_owned();
    let mut args = vec!["worktree", "remove"];
    if force {
        args.push("--force");
    }
    args.push(&path_str);

    let output = git_command()
        .args(&args)
        .current_dir(repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        // Only fall back to manual cleanup when git refuses because the path
        // isn't tracked (stale metadata or computed-path mismatch) or when
        // force was requested. Otherwise surface the error — we must not nuke
        // dirty worktrees behind the user's back.
        let safe_to_force_cleanup = force || stderr.contains("not a working tree");
        if !safe_to_force_cleanup {
            return Err(AppError::Git(format!("git worktree remove failed: {stderr}")));
        }

        let _ = tokio::fs::remove_dir_all(&resolved_path).await;
        let _ = git_command()
            .args(["worktree", "prune"])
            .current_dir(repo_path)
            .output()
            .await;

        if resolved_path.exists() {
            return Err(AppError::Git(format!(
                "git worktree remove failed and directory still exists: {stderr}"
            )));
        }
    }

    // Always delete the local branch. Use the branch name resolved from git's
    // porcelain output; fall back to worktree_name only when resolution failed
    // (e.g. the worktree wasn't tracked anymore).
    let branch_to_delete = resolved_branch.as_deref().unwrap_or(worktree_name);
    let branch_output = git_command()
        .args(["branch", "-D", branch_to_delete])
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

    Ok(())
}

/// Resolve a worktree's actual on-disk path and branch name by parsing
/// `git worktree list --porcelain`. Matches by exact branch name OR by path
/// basename (the sanitized dir name Alfredo stores as the worktree id).
/// Falls back to `(computed_path, None)` when git can't find it.
async fn resolve_worktree(
    repo_path: &str,
    worktree_name: &str,
    base_path: Option<&str>,
) -> (PathBuf, Option<String>) {
    let dir_name = worktree_name.replace('/', "-");
    let fallback_path = base_path
        .map(|p| Path::new(p).to_path_buf())
        .unwrap_or_else(|| {
            Path::new(repo_path)
                .parent()
                .unwrap_or(Path::new(repo_path))
                .to_path_buf()
        })
        .join(&dir_name);

    let Ok(output) = git_command()
        .args(["worktree", "list", "--porcelain"])
        .current_dir(repo_path)
        .output()
        .await
    else {
        return (fallback_path, None);
    };
    if !output.status.success() {
        return (fallback_path, None);
    }

    // Iterate by line and treat a blank line as a block boundary. This is
    // safer than splitting on "\n\n" because it tolerates CRLF line endings
    // and any trailing whitespace git may add across platforms.
    //
    // Note: there is a small TOCTOU window between this lookup and the
    // subsequent `git worktree remove` — another process could prune the
    // admin metadata in between. The caller's fallback cleanup handles that
    // by manually removing the directory.
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut path: Option<String> = None;
    let mut branch: Option<String> = None;

    let try_match = |path: &Option<String>,
                     branch: &Option<String>|
     -> Option<(PathBuf, Option<String>)> {
        let p = path.as_ref()?;
        let basename = Path::new(p)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        let branch_matches = branch
            .as_deref()
            .map(|b| b == worktree_name)
            .unwrap_or(false);
        if basename == dir_name || branch_matches {
            Some((PathBuf::from(p), branch.clone()))
        } else {
            None
        }
    };

    for raw_line in stdout.lines() {
        let line = raw_line.trim_end_matches('\r');
        if line.is_empty() {
            if let Some(hit) = try_match(&path, &branch) {
                return hit;
            }
            path = None;
            branch = None;
            continue;
        }
        if let Some(rest) = line.strip_prefix("worktree ") {
            path = Some(rest.to_string());
        } else if let Some(rest) = line.strip_prefix("branch refs/heads/") {
            branch = Some(rest.to_string());
        }
    }
    // Final block (no trailing blank line)
    if let Some(hit) = try_match(&path, &branch) {
        return hit;
    }

    (fallback_path, None)
}

/// Resolve the default remote branch for a repo (e.g. "origin/main" or "origin/develop").
/// Tries origin/HEAD first (canonical), then origin/main, origin/master. Falls back to "origin/main".
pub fn resolve_default_remote_branch(repo_or_worktree_path: &str) -> String {
    // Check origin/HEAD first — this is the canonical indicator of the repo's
    // default branch and avoids returning "origin/main" for repos whose actual
    // default is "develop", "master", etc.
    let output = git_command_sync()
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
    // Fallback: probe common branch names in order of likelihood.
    for name in &["origin/main", "origin/master"] {
        let output = git_command_sync()
            .args(["rev-parse", "--verify", &format!("refs/remotes/{name}")])
            .current_dir(repo_or_worktree_path)
            .output();
        if let Ok(output) = output {
            if output.status.success() {
                return name.to_string();
            }
        }
    }
    "origin/main".to_string()
}

/// Resolve the diff base ref for a worktree, considering optional stack parent.
/// Tries origin/<parent> first (preferred — avoids stale local refs), then local <parent>,
/// then falls back to the default remote branch.
fn resolve_diff_base(worktree_path: &str, stack_parent: Option<&str>) -> String {
    if let Some(parent) = stack_parent {
        let remote_ref = format!("origin/{parent}");
        let check = git_command_sync()
            .args(["rev-parse", "--verify", &format!("refs/remotes/{remote_ref}")])
            .current_dir(worktree_path)
            .output();
        if check.map(|o| o.status.success()).unwrap_or(false) {
            return remote_ref;
        }
        let local_check = git_command_sync()
            .args(["rev-parse", "--verify", parent])
            .current_dir(worktree_path)
            .output();
        if local_check.map(|o| o.status.success()).unwrap_or(false) {
            return parent.to_string();
        }
    }
    resolve_default_remote_branch(worktree_path)
}

/// Count how many commits the current branch is behind the default remote branch (or stack parent).
/// Uses the locally cached remote ref (no fetch) for speed.
/// Returns 0 if up to date or if the remote ref doesn't exist.
pub fn commits_behind(worktree_path: &str, stack_parent: Option<&str>) -> Result<u32, AppError> {
    let target = resolve_diff_base(worktree_path, stack_parent);

    let output = git_command_sync()
        .args(["rev-list", "--count", &format!("HEAD..{target}")])
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

/// Rebase the current branch onto a target branch (or the default remote branch if None).
/// Fetches origin first, then runs `git rebase origin/<target>`.
/// Returns Ok(()) on success, or an error with stderr on failure.
pub async fn rebase_onto(worktree_path: &str, target: Option<&str>) -> Result<(), AppError> {
    let (fetch_ref, rebase_ref) = if let Some(parent) = target {
        (parent.to_string(), format!("origin/{parent}"))
    } else {
        let default_branch = resolve_default_remote_branch(worktree_path);
        let short = default_branch.strip_prefix("origin/").unwrap_or(&default_branch).to_string();
        (short, default_branch)
    };

    // Fetch latest from origin
    let fetch = git_command()
        .args(["fetch", "origin", &fetch_ref])
        .current_dir(worktree_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git fetch: {e}")))?;

    if !fetch.status.success() {
        let stderr = String::from_utf8_lossy(&fetch.stderr);
        return Err(AppError::Git(format!("git fetch failed: {stderr}")));
    }

    // `git wip`: stash uncommitted + untracked changes as a throwaway commit so
    // the rebase runs on a clean tree. Tag the commit message with the pre-wip HEAD
    // SHA so we can unambiguously identify it later — even after the rebase replays
    // it onto a new base (where its own SHA changes but the message is preserved).
    let status = git_command()
        .args(["status", "--porcelain"])
        .current_dir(worktree_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git status: {e}")))?;
    let dirty = !status.stdout.is_empty();

    let wip_marker: Option<String> = if dirty {
        let pre_wip_head = git_command()
            .args(["rev-parse", "HEAD"])
            .current_dir(worktree_path)
            .output()
            .await
            .map_err(|e| AppError::Git(format!("failed to spawn git rev-parse: {e}")))?;
        if !pre_wip_head.status.success() {
            let stderr = String::from_utf8_lossy(&pre_wip_head.stderr);
            return Err(AppError::Git(format!("git rev-parse HEAD failed: {stderr}")));
        }
        let pre_sha = String::from_utf8_lossy(&pre_wip_head.stdout).trim().to_string();
        let marker = format!("alfredo-wip:{pre_sha}");
        let message = format!("--wip-- [skip ci] {marker}");

        let add = git_command()
            .args(["add", "-A"])
            .current_dir(worktree_path)
            .output()
            .await
            .map_err(|e| AppError::Git(format!("failed to spawn git add: {e}")))?;
        if !add.status.success() {
            let stderr = String::from_utf8_lossy(&add.stderr);
            return Err(AppError::Git(format!("git add -A failed: {stderr}")));
        }

        let wip_commit = git_command()
            .args(["commit", "--no-verify", "--no-gpg-sign", "-m", &message])
            .current_dir(worktree_path)
            .output()
            .await
            .map_err(|e| AppError::Git(format!("failed to spawn git commit (wip): {e}")))?;
        if !wip_commit.status.success() {
            let stderr = String::from_utf8_lossy(&wip_commit.stderr);
            return Err(AppError::Git(format!("git wip failed: {stderr}")));
        }
        Some(marker)
    } else {
        None
    };

    // From here on, every exit path must run unwip if we created a wip commit.
    // Capture the rebase outcome instead of early-returning.
    let rebase_result: Result<(), AppError> = async {
        let rebase = git_command()
            .args(["rebase", &rebase_ref])
            .current_dir(worktree_path)
            .output()
            .await
            .map_err(|e| AppError::Git(format!("failed to spawn git rebase: {e}")))?;
        if !rebase.status.success() {
            let stderr = String::from_utf8_lossy(&rebase.stderr).to_string();
            let _ = git_command()
                .args(["rebase", "--abort"])
                .current_dir(worktree_path)
                .output()
                .await;
            return Err(AppError::Git(format!("rebase failed (aborted): {stderr}")));
        }
        Ok(())
    }
    .await;

    // `git unwip`: if HEAD's subject contains our unique marker, the tip is still
    // our wip commit (possibly replayed onto the new base — its parent is then the
    // new base, so `reset --mixed HEAD~1` correctly restores the working tree on
    // top of the rebased base with the wip content as uncommitted changes again).
    let unwip_result: Result<(), AppError> = if let Some(marker) = wip_marker.as_ref() {
        async {
            let head_subject = git_command()
                .args(["log", "-1", "--pretty=%s"])
                .current_dir(worktree_path)
                .output()
                .await
                .map_err(|e| AppError::Git(format!("failed to spawn git log: {e}")))?;
            let subject = String::from_utf8_lossy(&head_subject.stdout);
            if !subject.contains(marker) {
                return Err(AppError::Git(format!(
                    "wip commit not at HEAD after rebase — expected marker '{marker}', got '{}'. \
                     Leaving state untouched; inspect the worktree manually.",
                    subject.trim()
                )));
            }
            let unwip = git_command()
                .args(["reset", "--mixed", "HEAD~1"])
                .current_dir(worktree_path)
                .output()
                .await
                .map_err(|e| AppError::Git(format!("failed to spawn git reset (unwip): {e}")))?;
            if !unwip.status.success() {
                let stderr = String::from_utf8_lossy(&unwip.stderr);
                return Err(AppError::Git(format!("git unwip failed: {stderr}")));
            }
            Ok(())
        }
        .await
    } else {
        Ok(())
    };

    // Surface the rebase error first if there was one; otherwise surface any unwip error.
    rebase_result?;
    unwip_result?;
    Ok(())
}

/// Get diff stats (additions, deletions) for a worktree's branch changes.
/// Shows committed changes vs the default branch (main/master) or the stack parent branch,
/// which is what users expect the badge to represent — the scope of work on the branch.
/// Uses git CLI instead of git2, which has known issues with worktree diff accuracy.
pub fn get_diff_stats(worktree_path: &str, stack_parent: Option<&str>) -> Result<(u32, u32), AppError> {
    // Use the resolved diff base — tries origin/<parent>, then local <parent>, then default branch.
    // Avoids stale local refs which would cause wildly inflated diff stats.
    let diff_base = resolve_diff_base(worktree_path, stack_parent);

    // Fetch the remote ref so the merge-base is fresh. Without this, a stale
    // origin/main after a rebase can produce wildly inflated diff stats (e.g. -1222k).
    // Throttled to once per 60s per ref to avoid N+1 network calls on startup.
    if let Some(branch) = diff_base.strip_prefix("origin/") {
        let throttle_key = format!("{worktree_path}:{branch}");
        let should_fetch = FETCH_THROTTLE
            .lock()
            .map(|cache| {
                cache
                    .get(&throttle_key)
                    .is_none_or(|last| last.elapsed().as_secs() >= 60)
            })
            .unwrap_or(true);
        if should_fetch {
            let fetched = git_command_sync()
                .args(["fetch", "origin", branch, "--no-tags", "--no-auto-maintenance"])
                .current_dir(worktree_path)
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false);
            if fetched {
                if let Ok(mut cache) = FETCH_THROTTLE.lock() {
                    cache.insert(throttle_key, Instant::now());
                }
            }
        }
    }

    let output = git_command_sync()
        .args(["diff", "--shortstat", &format!("{diff_base}...HEAD")])
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
    let output = git_command_sync()
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
            stack_parent: None,
            stack_children: vec![],
            stack_rebase_status: None,
            setup_script_error: None,
            assigned_port: None,
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
            .args(["init", "-b", "main"])
            .current_dir(path)
            .output()
            .expect("git init");
        StdCommand::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@test.com", "commit", "--allow-empty", "-m", "init"])
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

    // ── parse_shortstat ─────────────────────────────────────────

    #[test]
    fn parse_shortstat_full_output() {
        let input = " 3 files changed, 10 insertions(+), 5 deletions(-)";
        assert_eq!(parse_shortstat(input), (10, 5));
    }

    #[test]
    fn parse_shortstat_insertions_only() {
        let input = " 1 file changed, 7 insertions(+)";
        assert_eq!(parse_shortstat(input), (7, 0));
    }

    #[test]
    fn parse_shortstat_deletions_only() {
        let input = " 2 files changed, 3 deletions(-)";
        assert_eq!(parse_shortstat(input), (0, 3));
    }

    #[test]
    fn parse_shortstat_empty_input() {
        assert_eq!(parse_shortstat(""), (0, 0));
    }

    #[test]
    fn parse_shortstat_whitespace_only() {
        assert_eq!(parse_shortstat("  \n  "), (0, 0));
    }

    // ── list_worktrees with linked worktree ─────────────────────

    #[tokio::test]
    async fn test_list_worktrees_returns_linked_worktree() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().expect("temp dir path is valid UTF-8");

        // Create a worktree — this exercises git2::Repository::worktrees()
        // and git2::Repository::find_worktree() in list_worktrees.
        let wt_path = create_worktree(repo_path, "linked-branch", "main", None)
            .await
            .expect("create_worktree should succeed");
        assert!(wt_path.exists());

        let worktrees = list_worktrees(repo_path, None).expect("list_worktrees should succeed");
        assert_eq!(worktrees.len(), 1, "should find exactly the linked worktree");
        assert_eq!(worktrees[0].name, "linked-branch");
        assert_eq!(worktrees[0].branch, "linked-branch");
        assert!(!worktrees[0].path.is_empty());

        // Clean up
        delete_worktree(repo_path, "linked-branch", true, None)
            .await
            .expect("delete should succeed");
    }

    #[tokio::test]
    async fn test_list_worktrees_filters_by_base_path() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().expect("temp dir path is valid UTF-8");

        // Use a custom base_path so the worktree is created inside a known temp dir
        // (avoids collisions with other tests that create worktrees in the repo parent).
        let base_dir = TempDir::new().expect("create base temp dir");
        let base_path = base_dir.path().to_str().unwrap();
        let branch = "filter-test-wt";

        let wt_path = create_worktree(repo_path, branch, "main", Some(base_path))
            .await
            .expect("create_worktree should succeed");
        assert!(wt_path.exists());

        // Filter with the actual base — should return the worktree
        let found = list_worktrees(repo_path, Some(base_path))
            .expect("list_worktrees should succeed");
        assert_eq!(found.len(), 1, "should find the worktree under the base path");

        // Filter with a different existing directory — should return empty
        let other_dir = TempDir::new().expect("create other temp dir");
        let other_path = other_dir.path().to_str().unwrap();
        let filtered = list_worktrees(repo_path, Some(other_path))
            .expect("list_worktrees should succeed");
        assert!(
            filtered.is_empty(),
            "should find no worktrees under a different base path"
        );

        // Clean up
        delete_worktree(repo_path, branch, true, Some(base_path))
            .await
            .expect("delete should succeed");
    }

    #[tokio::test]
    async fn test_delete_resolves_path_when_base_path_missing() {
        // Regression: create a worktree under a custom base_path, then call
        // delete WITHOUT passing the base_path. The old code recomputed the
        // path as <repo parent>/<dir_name>, got "not a working tree", and
        // silently returned Ok while leaving the directory on disk.
        // The fix resolves the actual path via `git worktree list --porcelain`.
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().expect("temp dir path is valid UTF-8");

        let base_dir = TempDir::new().expect("create base temp dir");
        let base_path = base_dir.path().to_str().unwrap();
        let branch = "regression-wt";

        let wt_path = create_worktree(repo_path, branch, "main", Some(base_path))
            .await
            .expect("create_worktree should succeed");
        assert!(wt_path.exists());

        // Delete WITHOUT the base_path — must still succeed and remove the directory
        delete_worktree(repo_path, branch, true, None)
            .await
            .expect("delete should succeed even without base_path");

        assert!(!wt_path.exists(), "worktree directory should be gone");

        // Branch should be deleted too (force=true)
        let repo = Repository::open(repo_path).expect("open repo");
        assert!(
            repo.find_branch(branch, git2::BranchType::Local).is_err(),
            "branch should be deleted"
        );
    }

    #[tokio::test]
    async fn test_delete_resolves_branch_name_from_slash_branch() {
        // Regression: a branch like "user/feature" becomes dir "user-feature".
        // Old code called `git branch -D user-feature` which silently failed
        // with "not found". Fix: resolve the real branch name via porcelain.
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().expect("temp dir path is valid UTF-8");

        let wt_path = create_worktree(repo_path, "user/feature-x", "main", None)
            .await
            .expect("create_worktree should succeed");
        assert!(wt_path.exists());

        // Caller passes the sanitized dir name (matches what Alfredo stores as wt.name)
        delete_worktree(repo_path, "user-feature-x", true, None)
            .await
            .expect("delete should succeed");

        assert!(!wt_path.exists());

        // The REAL branch name (with slash) should be gone
        let repo = Repository::open(repo_path).expect("open repo");
        assert!(
            repo.find_branch("user/feature-x", git2::BranchType::Local).is_err(),
            "real slash-containing branch should be deleted"
        );
    }

    // ── get_status exercises git2 branch resolution ─────────────

    #[tokio::test]
    async fn test_get_status_on_worktree() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().expect("temp dir path is valid UTF-8");

        let wt_path = create_worktree(repo_path, "status-branch", "main", None)
            .await
            .expect("create_worktree should succeed");

        let wt_path_str = wt_path.to_str().unwrap();
        let status = get_status(wt_path_str).expect("get_status should succeed on worktree");
        assert_eq!(status.branch, "status-branch");

        // Clean up
        delete_worktree(repo_path, "status-branch", true, None)
            .await
            .expect("delete should succeed");
    }
}
