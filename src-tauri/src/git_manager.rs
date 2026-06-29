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

/// Validate a branch name against the same rules as `git check-ref-format --branch`.
/// Returns `Ok(())` when valid or `Err(AppError::Git(message))` describing the
/// first violation. Mirrors `src/lib/validateBranchName.ts` so the frontend
/// disables the submit button for the same set of inputs the backend rejects.
pub fn validate_branch_name(name: &str) -> Result<(), AppError> {
    let err = |msg: &str| Err(AppError::Git(format!("Invalid branch name: {msg}")));

    if name.is_empty() {
        return err("branch name is required");
    }
    if name == "@" {
        return err("branch name cannot be '@'");
    }
    if name.starts_with('-') {
        return err("branch name cannot start with '-'");
    }
    if name.starts_with('/') {
        return err("branch name cannot start with '/'");
    }
    if name.ends_with('/') {
        return err("branch name cannot end with '/'");
    }
    if name.ends_with('.') {
        return err("branch name cannot end with '.'");
    }
    if name.ends_with(".lock") {
        return err("branch name cannot end with '.lock'");
    }
    if name.contains("..") {
        return err("branch name cannot contain '..'");
    }
    if name.contains("//") {
        return err("branch name cannot contain consecutive slashes");
    }
    if name.contains("@{") {
        return err("branch name cannot contain '@{'");
    }

    for ch in name.chars() {
        let code = ch as u32;
        if code < 0x20 || code == 0x7f {
            return err("branch name cannot contain control characters");
        }
        match ch {
            ' ' => return err("branch name cannot contain spaces"),
            '~' => return err("branch name cannot contain '~'"),
            '^' => return err("branch name cannot contain '^'"),
            ':' => return err("branch name cannot contain ':'"),
            '?' => return err("branch name cannot contain '?'"),
            '*' => return err("branch name cannot contain '*'"),
            '[' => return err("branch name cannot contain '['"),
            '\\' => return err("branch name cannot contain '\\'"),
            _ => {}
        }
    }

    for segment in name.split('/') {
        if segment.starts_with('.') {
            return err("branch name segments cannot start with '.'");
        }
        if segment.ends_with(".lock") {
            return err("branch name segments cannot end with '.lock'");
        }
    }

    Ok(())
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

/// Best-effort `git fetch` for a repo, throttled to once per 30s per repo.
/// Key is per-repo (not per-worktree) so N worktrees of the same repo coalesce
/// into a single fetch every 30s instead of fanning out into N. Set `force` to
/// bypass the throttle (used by post-action refetches that need fresh state).
/// Silent on failure — offline or auth-broken remotes must not surface noise.
///
/// Trade-off: the throttle slot is stamped only on successful fetch, so a
/// network blip doesn't suppress retries for 30s. The cost is a small TOCTOU
/// window where concurrent first-mounts (e.g. several worktree panels at app
/// start) can each spawn their own fetch before any has finished and stamped
/// the slot. Acceptable: the worst case is N initial fetches once per app
/// launch, after which steady-state coalesces correctly. A `force` post-action
/// fetch also stamps the per-repo slot on success, suppressing sibling
/// worktrees' next poll fetches — that's desirable (post-push freshness applies
/// to the whole repo) but worth flagging.
pub async fn fetch_upstream_throttled(repo_path: &str, force: bool) {
    const THROTTLE: std::time::Duration = std::time::Duration::from_secs(30);
    let key = format!("upstream-counts:{repo_path}");

    if !force {
        let should_fetch = match FETCH_THROTTLE.lock() {
            Ok(map) => !matches!(map.get(&key), Some(last) if last.elapsed() < THROTTLE),
            Err(_) => {
                tracing::warn!("[fetch_upstream_throttled] FETCH_THROTTLE poisoned; skipping fetch");
                return;
            }
        };
        if !should_fetch {
            return;
        }
    }

    // Spawn with kill_on_drop so a hung fetch is reaped when timeout fires
    // (default kill_on_drop is false → orphaned `git fetch` children pile up).
    let fetch = git_command()
        .args(["fetch", "--quiet", "--no-auto-maintenance"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .current_dir(repo_path)
        .kill_on_drop(true)
        .output();

    // Only stamp the throttle on a successful fetch — a network blip shouldn't
    // suppress retries for 30s.
    if let Ok(Ok(output)) = tokio::time::timeout(std::time::Duration::from_secs(15), fetch).await {
        if output.status.success() {
            if let Ok(mut map) = FETCH_THROTTLE.lock() {
                map.insert(key, Instant::now());
            }
        }
    }
}

/// Count how many commits the current branch is ahead/behind its upstream tracking ref.
/// Returns `Ok(None)` only when no upstream is configured (rev-parse fails); a
/// rev-list failure with a configured upstream bubbles up as `Err` so the UI
/// doesn't misread a transient git failure as "no upstream → Publish". A
/// detached HEAD (mid-rebase, mid-merge, mid-bisect) also bubbles as `Err`
/// — frontend keeps the prior counts and the "Publish" CTA never appears
/// during a conflict resolution.
pub fn ahead_behind_vs_upstream(worktree_path: &str) -> Result<Option<(u32, u32)>, AppError> {
    // Detached HEAD = no current branch = no meaningful ahead/behind. Catch
    // this before rev-parse @{upstream}, which would otherwise non-zero and
    // get misread as "no upstream set".
    let symbolic = git_command_sync()
        .args(["symbolic-ref", "--quiet", "HEAD"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| AppError::Git(format!("failed to spawn git symbolic-ref: {e}")))?;
    if !symbolic.status.success() {
        return Err(AppError::Git(
            "HEAD is detached (likely mid-rebase, mid-merge, or mid-bisect)".into(),
        ));
    }

    let upstream = git_command_sync()
        .args(["rev-parse", "--abbrev-ref", "@{upstream}"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| AppError::Git(format!("failed to spawn git rev-parse: {e}")))?;
    if !upstream.status.success() {
        return Ok(None); // no upstream set
    }

    let counts = git_command_sync()
        .args(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| AppError::Git(format!("failed to spawn git rev-list: {e}")))?;
    if !counts.status.success() {
        let stderr = String::from_utf8_lossy(&counts.stderr);
        return Err(AppError::Git(format!("git rev-list --left-right failed: {stderr}")));
    }

    let s = String::from_utf8_lossy(&counts.stdout);
    let mut parts = s.split_whitespace();
    // Both tokens must parse — otherwise the output format isn't what we expect
    // and silently coercing to (0, 0) would mask a real failure as "in sync".
    let (Some(ahead), Some(behind)) = (
        parts.next().and_then(|n| n.parse::<u32>().ok()),
        parts.next().and_then(|n| n.parse::<u32>().ok()),
    ) else {
        return Err(AppError::Git(format!(
            "git rev-list --left-right --count returned unexpected output: {s:?}"
        )));
    };
    Ok(Some((ahead, behind)))
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

/// Uncommitted work in a worktree that a delete would destroy irreversibly.
///
/// `untracked` is the crucial one: untracked files (e.g. `/research` output in
/// `.claude/research/`) never appear in `git diff`, so the sidebar's diff-stat
/// badge shows +0/-0 and the worktree *looks* empty — yet `git worktree remove
/// --force` wipes them. Surfacing this in the delete confirm is what stops a
/// "looks empty" worktree from silently taking hours of work with it.
#[derive(serde::Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeDirtyState {
    /// Untracked paths (`git status` `??`). Invisible to the diff-stat badge.
    pub untracked: Vec<String>,
    /// Tracked-but-uncommitted paths (modified/added/deleted, not yet committed).
    pub uncommitted: Vec<String>,
}

/// Classify a worktree's working tree into untracked vs tracked-uncommitted
/// paths via `git status --porcelain`. Ignored files (`!!`) are intentionally
/// excluded — only real, would-be-lost work is reported. Returns an empty state
/// (rather than erroring) when the path isn't a git worktree, so the delete
/// confirm degrades to its plain form instead of blocking deletion.
pub async fn worktree_dirty_state(worktree_path: &str) -> Result<WorktreeDirtyState, AppError> {
    // `core.quotepath=false` keeps non-ASCII filenames readable (git otherwise
    // C-escapes them). A missing/unreadable worktree dir makes the spawn or the
    // command fail — treat either as "nothing to warn about" so the delete
    // confirm still works (honouring the empty-state contract above).
    let output = match git_command()
        .args(["-c", "core.quotepath=false", "status", "--porcelain"])
        .current_dir(worktree_path)
        .output()
        .await
    {
        Ok(o) if o.status.success() => o,
        _ => return Ok(WorktreeDirtyState::default()),
    };

    let mut state = WorktreeDirtyState::default();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        // Porcelain v1: two status chars, a space, then the path.
        if line.len() < 4 {
            continue;
        }
        let (code, rest) = line.split_at(3);
        // Renames/copies render as "old -> new"; keep the current (new) path so
        // the warning lists the file that actually exists.
        let path = rest.rsplit(" -> ").next().unwrap_or(rest).trim().to_string();
        if code.starts_with("??") {
            state.untracked.push(path);
        } else {
            state.uncommitted.push(path);
        }
    }
    Ok(state)
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

    // The badge represents "PR-sized scope": what would land if you opened a
    // PR for this branch right now. Summed from three additive sources to mirror
    // what the Changes panel renders (committed cards + uncommitted card + new files):
    //   1. `<base>...HEAD` — committed scope. The triple-dot form is the
    //      merge-base diff, so a branch that is purely behind <base> reports
    //      empty (the "X commits behind" indicator handles that state). A
    //      single-ref `git diff <base>` would invert the incoming commits here.
    //   2. `git diff HEAD` — uncommitted tracked edits.
    //   3. Per-file walk over `ls-files --others` — untracked new files.
    // The sum is intentionally churn-counted, not net-merged: a line that a
    // commit adds and an uncommitted edit immediately removes counts as +1/-1,
    // mirroring the two cards the Changes panel renders for it.
    let mut additions = 0u32;
    let mut deletions = 0u32;

    let (a, d) = shortstat_for_range(worktree_path, &diff_base, None, stack_parent);
    additions = additions.saturating_add(a);
    deletions = deletions.saturating_add(d);

    if let Ok(output) = git_command_sync()
        .args(["diff", "--shortstat", "HEAD"])
        .current_dir(worktree_path)
        .output()
    {
        if output.status.success() {
            let (a, d) = parse_shortstat(&String::from_utf8_lossy(&output.stdout));
            additions = additions.saturating_add(a);
            deletions = deletions.saturating_add(d);
        } else {
            tracing::debug!(
                "[get_diff_stats] git diff --shortstat HEAD failed in {worktree_path}: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }
    }

    if let Ok(output) = git_command_sync()
        .args(["ls-files", "--others", "--exclude-standard"])
        .current_dir(worktree_path)
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let untracked: Vec<&str> = stdout.lines().filter(|l| !l.is_empty()).collect();

            // Guard against runaway forking. A misconfigured `.gitignore`
            // (e.g. a parent repo with our worktrees dir untracked) can leave
            // tens of thousands of files here; the per-file `git diff
            // --no-index` loop below would spawn a subprocess for each one
            // and freeze the UI. Bail with the partial stats we already have.
            if untracked.len() > UNTRACKED_FILE_LIMIT {
                tracing::warn!(
                    "[get_diff_stats] {} untracked files in {worktree_path} exceeds limit of {}; \
                     skipping per-file line count",
                    untracked.len(),
                    UNTRACKED_FILE_LIMIT,
                );
            } else {
                for rel in untracked {
                    let abs = std::path::Path::new(worktree_path).join(rel);
                    // symlink_metadata so we never follow a symlink that escapes
                    // the worktree. 1MB cap keeps stray binaries (sqlite, log
                    // dumps) from stalling the badge refresh.
                    let Ok(meta) = std::fs::symlink_metadata(&abs) else { continue };
                    if !meta.file_type().is_file() || meta.len() > 1_000_000 {
                        continue;
                    }
                    if let Ok(output) = git_command_sync()
                        .args(["diff", "--no-index", "--shortstat", "--", "/dev/null", rel])
                        .current_dir(worktree_path)
                        .output()
                    {
                        // `git diff --no-index` exits 1 when files differ, which
                        // is the expected case here — accept any exit code and
                        // parse whatever shortstat it printed.
                        let (a, d) = parse_shortstat(&String::from_utf8_lossy(&output.stdout));
                        additions = additions.saturating_add(a);
                        deletions = deletions.saturating_add(d);
                    }
                }
            }
        }
    }

    Ok((additions, deletions))
}

/// Upper bound on untracked files we will line-count in `get_diff_stats`.
/// Past this, each file would mean another `git diff --no-index` subprocess,
/// and at 40k+ untracked files (the Florence-with-nested-worktrees case) the
/// fork avalanche hangs the UI for minutes. The badge gracefully shows just
/// the committed+uncommitted scope when this trips.
const UNTRACKED_FILE_LIMIT: usize = 500;

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

/// Run `git diff --shortstat` between the resolved range. Falls back to the
/// merge-base form when the resolver returns the pass-through range.
fn shortstat_for_range(
    worktree_path: &str,
    diff_base: &str,
    merge_commit_sha: Option<&str>,
    stack_parent: Option<&str>,
) -> (u32, u32) {
    use git2::Repository;

    // Try the resolver path. Failures fall through to the legacy CLI form.
    let resolved: Option<(String, String)> = (|| {
        let repo = Repository::open(worktree_path).ok()?;

        let base_oid = git_command_sync()
            .args(["rev-parse", "--verify", diff_base])
            .current_dir(worktree_path)
            .output()
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    git2::Oid::from_str(String::from_utf8_lossy(&o.stdout).trim()).ok()
                } else {
                    None
                }
            })?;
        let head_oid = repo.head().ok()?.target()?;

        let main_oid = crate::commands::diff::stack_clamp_oid(&repo, stack_parent);
        let range = crate::commands::diff_range::resolve_diff_range(
            &repo, base_oid, head_oid, merge_commit_sha, main_oid,
        )
        .ok()?;

        if range.base == range.head {
            return Some((String::new(), String::new())); // signals "empty"
        }
        Some((range.base.to_string(), range.head.to_string()))
    })();

    match resolved {
        Some((b, h)) if b.is_empty() && h.is_empty() => (0, 0),
        Some((b, h)) => {
            if let Ok(output) = git_command_sync()
                .args(["diff", "--shortstat", &format!("{b}..{h}")])
                .current_dir(worktree_path)
                .output()
            {
                if output.status.success() {
                    return parse_shortstat(&String::from_utf8_lossy(&output.stdout));
                }
                tracing::debug!(
                    "[shortstat_for_range] git diff --shortstat {b}..{h} failed in {worktree_path}: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
            (0, 0)
        }
        None => {
            // Resolver couldn't run — fall back to the original triple-dot form.
            if let Ok(output) = git_command_sync()
                .args(["diff", "--shortstat", &format!("{diff_base}...HEAD")])
                .current_dir(worktree_path)
                .output()
            {
                if output.status.success() {
                    return parse_shortstat(&String::from_utf8_lossy(&output.stdout));
                }
                tracing::debug!(
                    "[shortstat_for_range] fallback git diff --shortstat {diff_base}...HEAD failed in {worktree_path}: {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                );
            }
            (0, 0)
        }
    }
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
            id: format!("{repo_path}::{branch}"),
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

/// Count worktrees filtered to `base_path`. Cheaper than `list_worktrees` —
/// skips branch + commit lookups and struct construction. Used by the
/// repo-selector dropdown so unselected repos still show an accurate badge
/// without populating the workspace store.
pub fn count_worktrees(repo_path: &str, base_path: Option<&str>) -> Result<usize, AppError> {
    let repo = Repository::open(repo_path)
        .map_err(|e| AppError::Git(format!("failed to open repo: {e}")))?;

    let worktree_names = repo
        .worktrees()
        .map_err(|e| AppError::Git(format!("failed to list worktrees: {e}")))?;

    let base_filter = base_path.and_then(|p| std::path::Path::new(p).canonicalize().ok());

    let mut count = 0usize;
    for name in worktree_names.iter() {
        let Some(name) = name else { continue };
        let Ok(wt) = repo.find_worktree(name) else { continue };
        let wt_path = wt.path().to_path_buf();
        if let Some(ref base) = base_filter {
            match wt_path.canonicalize() {
                Ok(canonical) if canonical.starts_with(base) => {}
                _ => continue,
            }
        }
        count += 1;
    }
    Ok(count)
}

/// Get detailed status for a single worktree path.
pub fn get_status(worktree_path: &str) -> Result<WorktreeStatus, AppError> {
    let repo = Repository::open(worktree_path)
        .map_err(|e| AppError::Git(format!("failed to open worktree repo: {e}")))?;

    // Mirror list_worktrees' fallback: when the branch is undeterminable (a
    // non-rebase detached HEAD), use the worktree directory name rather than the
    // literal "HEAD", so both refresh paths agree on the branch/id token.
    let branch = resolve_worktree_branch(&repo).unwrap_or_else(|| {
        std::path::Path::new(worktree_path)
            .file_name()
            .map_or_else(|| "HEAD".to_string(), |n| n.to_string_lossy().into_owned())
    });

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
    resolve_worktree_branch(&repo)
}

/// Resolve the branch a worktree is on, surviving a detached HEAD mid-rebase.
///
/// `git rebase` detaches HEAD while it replays commits, so `head().shorthand()`
/// returns the literal `"HEAD"` for the duration. If a worktree-list refresh
/// lands in that window the branch — and the worktree `id` derived from it
/// (`{repo}::{branch}`) — gets recorded as `"HEAD"`, and because nothing
/// re-resolves a worktree-mode branch after the rebase finishes it sticks for
/// the rest of the session (the sidebar shows `HEAD`; notifications say "HEAD
/// needs your input"). When detached, recover the branch the rebase will return
/// to from its state dir so `"HEAD"` is never captured. Returns `None` only when
/// genuinely undeterminable (e.g. a non-rebase detached checkout); `list_worktrees`
/// then falls back to the worktree directory name rather than `"HEAD"`.
fn resolve_worktree_branch(repo: &Repository) -> Option<String> {
    if let Ok(head) = repo.head() {
        if let Some(name) = head.shorthand() {
            // A branch literally named "HEAD" is forbidden by git, so this
            // reliably means a detached HEAD rather than a real branch.
            if name != "HEAD" {
                return Some(name.to_string());
            }
        }
    }
    rebase_head_name(repo)
}

/// The branch an in-progress rebase will return to, read from the worktree's
/// rebase state dir. Merge-backend rebase (git's default) writes
/// `rebase-merge/head-name`; the older am backend writes `rebase-apply/head-name`.
/// Both hold a full ref like `refs/heads/feature`.
fn rebase_head_name(repo: &Repository) -> Option<String> {
    let gitdir = repo.path();
    for sub in ["rebase-merge/head-name", "rebase-apply/head-name"] {
        if let Ok(contents) = std::fs::read_to_string(gitdir.join(sub)) {
            // Only a real branch ref counts. A rebase begun from an already
            // detached HEAD writes the literal "detached HEAD" here (no
            // refs/heads/ prefix); requiring the prefix makes that case return
            // None so callers fall back to the worktree name rather than
            // surfacing "detached HEAD" as if it were a branch.
            if let Some(branch) = contents.trim().strip_prefix("refs/heads/") {
                if !branch.is_empty() {
                    return Some(branch.to_string());
                }
            }
        }
    }
    None
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
    fn validate_branch_name_accepts_valid() {
        for name in [
            "feat/my-feature",
            "fix/issue-40",
            "release/1.2.3",
            "_internal",
            "v1.0",
            "feature",
        ] {
            assert!(validate_branch_name(name).is_ok(), "should accept {name:?}");
        }
    }

    #[test]
    fn validate_branch_name_rejects_spaces_issue_40() {
        let err = validate_branch_name("karo diagnostics").unwrap_err();
        assert!(err.to_string().contains("spaces"), "got: {err}");
    }

    #[test]
    fn validate_branch_name_rejects_each_forbidden_char() {
        for bad in ["foo~bar", "foo^bar", "foo:bar", "foo?bar", "foo*bar", "foo[bar", "foo\\bar"] {
            assert!(validate_branch_name(bad).is_err(), "should reject {bad:?}");
        }
    }

    #[test]
    fn validate_branch_name_rejects_structural_violations() {
        for bad in [
            "",
            "@",
            "-foo",
            "/foo",
            "foo/",
            "foo.",
            "foo.lock",
            "foo..bar",
            "foo//bar",
            "foo@{1}",
            ".foo",
            "foo/.bar",
            "foo/bar.lock",
        ] {
            assert!(validate_branch_name(bad).is_err(), "should reject {bad:?}");
        }
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

    /// Run a git command in `dir` with test identity, returning its output.
    fn git_in(dir: &Path, args: &[&str]) -> std::process::Output {
        StdCommand::new("git")
            .args(["-c", "user.name=Test", "-c", "user.email=test@test.com"])
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git command")
    }

    #[tokio::test]
    async fn test_resolve_branch_recovers_from_rebase_in_linked_worktree() {
        // A conflicting `git rebase` pauses with HEAD detached. The naive
        // `head().shorthand()` returns the literal "HEAD" for the duration; the
        // resolver must recover the real branch from the worktree's *own* gitdir
        // (`.git/worktrees/<name>/rebase-merge/head-name`) so the branch — and the
        // id derived from it — is never recorded as "HEAD". Uses a real linked
        // worktree so the per-worktree gitdir path semantics (repo.path(), the
        // crux of the bug) are actually exercised, not the main repo where
        // path()==commondir.
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().expect("temp dir path is valid UTF-8");
        // Dedicated base dir so the worktree path doesn't collide with sibling
        // worktree tests (which the default base_path — the shared repo parent —
        // otherwise would; see test_list_worktrees_filters_by_base_path).
        let base_dir = TempDir::new().expect("create base temp dir");
        let base_path = base_dir.path().to_str().expect("base path is valid UTF-8");

        let wt_path = create_worktree(repo_path, "feature", "main", Some(base_path))
            .await
            .expect("create_worktree should succeed");

        // feature adds a file…
        std::fs::write(wt_path.join("conflict.txt"), "feature\n").expect("write feature");
        git_in(&wt_path, &["add", "-A"]);
        git_in(&wt_path, &["commit", "-m", "feature add"]);

        // …main adds the same path with different content (add/add conflict).
        std::fs::write(dir.path().join("conflict.txt"), "main\n").expect("write main");
        git_in(dir.path(), &["add", "-A"]);
        git_in(dir.path(), &["commit", "-m", "main add"]);

        // Rebase feature onto main inside the worktree → conflict → detached HEAD.
        let rebase = git_in(&wt_path, &["rebase", "main"]);
        assert!(!rebase.status.success(), "rebase should conflict and pause");

        let branch = get_branch_for_path(&wt_path).expect("should resolve a branch mid-rebase");
        assert_eq!(branch, "feature", "expected real branch mid-rebase, got {branch:?}");

        git_in(&wt_path, &["rebase", "--abort"]);
        delete_worktree(repo_path, "feature", true, Some(base_path))
            .await
            .expect("delete should succeed");
    }

    #[tokio::test]
    async fn test_resolve_branch_does_not_leak_detached_head_sentinel() {
        // A rebase begun from an already-detached HEAD writes the literal
        // "detached HEAD" (not a refs/heads/ ref) into head-name. The resolver
        // must NOT surface that as a branch — it returns None so list_worktrees
        // falls back to the worktree directory name.
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().expect("temp dir path is valid UTF-8");
        let base_dir = TempDir::new().expect("create base temp dir");
        let base_path = base_dir.path().to_str().expect("base path is valid UTF-8");

        let wt_path = create_worktree(repo_path, "feature", "main", Some(base_path))
            .await
            .expect("create_worktree should succeed");

        std::fs::write(wt_path.join("conflict.txt"), "feature\n").expect("write feature");
        git_in(&wt_path, &["add", "-A"]);
        git_in(&wt_path, &["commit", "-m", "feature add"]);

        std::fs::write(dir.path().join("conflict.txt"), "main\n").expect("write main");
        git_in(dir.path(), &["add", "-A"]);
        git_in(dir.path(), &["commit", "-m", "main add"]);

        // Detach HEAD first, then rebase — head-name becomes "detached HEAD".
        git_in(&wt_path, &["checkout", "--detach"]);
        let rebase = git_in(&wt_path, &["rebase", "main"]);
        assert!(!rebase.status.success(), "rebase should conflict and pause");

        let resolved = get_branch_for_path(&wt_path);
        assert!(
            resolved.is_none(),
            "must not surface the 'detached HEAD' sentinel as a branch, got {resolved:?}",
        );

        git_in(&wt_path, &["rebase", "--abort"]);
        delete_worktree(repo_path, "feature", true, Some(base_path))
            .await
            .expect("delete should succeed");
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

    // ── get_diff_stats ──────────────────────────────────────────

    /// A worktree whose HEAD is purely an ancestor of its base ref (i.e. behind by N commits,
    /// no local work) should report (0, 0). The "X commits behind" indicator handles that
    /// state separately; the badge is for PR-sized scope, which is empty here.
    #[test]
    fn get_diff_stats_returns_zero_when_behind_base() {
        let dir = init_test_repo();
        let path = dir.path();
        let path_str = path.to_str().expect("temp dir path is valid UTF-8");

        let git = |args: &[&str]| {
            StdCommand::new("git")
                .args(["-c", "user.name=Test", "-c", "user.email=test@test.com"])
                .args(args)
                .current_dir(path)
                .output()
                .expect("git command")
        };

        // Commit A on main, branch "feature" at A, then commit B on main so feature is 1 behind.
        std::fs::write(path.join("a.txt"), "alpha\n").expect("write a.txt");
        git(&["add", "."]);
        git(&["commit", "-m", "A"]);
        git(&["branch", "feature"]);
        std::fs::write(path.join("b.txt"), "beta\n").expect("write b.txt");
        git(&["add", "."]);
        git(&["commit", "-m", "B"]);
        git(&["checkout", "feature"]);

        let stats = get_diff_stats(path_str, Some("main")).expect("get_diff_stats");
        assert_eq!(stats, (0, 0));
    }

    /// The delete-confirm guard: an untracked file (the `/research` case) must be
    /// reported even though it contributes nothing to the diff-stat badge, and a
    /// tracked-but-uncommitted edit lands in the separate `uncommitted` bucket.
    #[tokio::test]
    async fn worktree_dirty_state_classifies_untracked_and_uncommitted() {
        let dir = init_test_repo();
        let path = dir.path();
        let path_str = path.to_str().expect("temp dir path is valid UTF-8");

        let git = |args: &[&str]| {
            StdCommand::new("git")
                .args(["-c", "user.name=Test", "-c", "user.email=test@test.com"])
                .args(args)
                .current_dir(path)
                .output()
                .expect("git command")
        };

        std::fs::write(path.join("tracked.txt"), "v1\n").expect("write tracked");
        git(&["add", "."]);
        git(&["commit", "-m", "init"]);

        // Untracked research output + an uncommitted edit to a tracked file.
        std::fs::create_dir_all(path.join(".research")).expect("mkdir .research");
        std::fs::write(path.join(".research/notes.md"), "findings\n").expect("write untracked");
        std::fs::write(path.join("tracked.txt"), "v2\n").expect("edit tracked");

        let state = worktree_dirty_state(path_str).await.expect("dirty state");
        assert!(
            state.untracked.iter().any(|p| p.contains(".research")),
            "untracked should include research output, got {:?}",
            state.untracked,
        );
        assert!(
            state.uncommitted.iter().any(|p| p == "tracked.txt"),
            "uncommitted should include the edited tracked file, got {:?}",
            state.uncommitted,
        );
    }

    /// A committed-clean worktree reports nothing, so the confirm stays in its
    /// plain fast-delete form.
    #[tokio::test]
    async fn worktree_dirty_state_clean_worktree_is_empty() {
        let dir = init_test_repo();
        let path = dir.path();

        let git = |args: &[&str]| {
            StdCommand::new("git")
                .args(["-c", "user.name=Test", "-c", "user.email=test@test.com"])
                .args(args)
                .current_dir(path)
                .output()
                .expect("git command")
        };

        std::fs::write(path.join("a.txt"), "x\n").expect("write a.txt");
        git(&["add", "."]);
        git(&["commit", "-m", "init"]);

        let state = worktree_dirty_state(path.to_str().unwrap()).await.expect("dirty state");
        assert!(state.untracked.is_empty() && state.uncommitted.is_empty());
    }

    /// Behind base + uncommitted tracked edit: badge should report only the uncommitted scope,
    /// confirming the two diff sources don't interact and the "behind" portion stays zeroed
    /// even when the worktree is dirty.
    #[test]
    fn get_diff_stats_counts_only_uncommitted_when_behind_base() {
        let dir = init_test_repo();
        let path = dir.path();
        let path_str = path.to_str().expect("temp dir path is valid UTF-8");

        let git = |args: &[&str]| {
            StdCommand::new("git")
                .args(["-c", "user.name=Test", "-c", "user.email=test@test.com"])
                .args(args)
                .current_dir(path)
                .output()
                .expect("git command")
        };

        std::fs::write(path.join("a.txt"), "alpha\n").expect("write a.txt");
        git(&["add", "."]);
        git(&["commit", "-m", "A"]);
        git(&["branch", "feature"]);
        std::fs::write(path.join("b.txt"), "beta\n").expect("write b.txt");
        git(&["add", "."]);
        git(&["commit", "-m", "B"]);
        git(&["checkout", "feature"]);

        // Tracked uncommitted edit on the behind branch.
        std::fs::write(path.join("a.txt"), "alpha\nextra\n").expect("rewrite a.txt");

        let stats = get_diff_stats(path_str, Some("main")).expect("get_diff_stats");
        assert_eq!(stats, (1, 0));
    }

    /// Untracked file count past `UNTRACKED_FILE_LIMIT` must not be line-counted.
    /// Reproduces the Florence-with-nested-worktrees hang where ~40k untracked
    /// files caused one `git diff --no-index` subprocess per file. Tracked
    /// additions still report; untracked content is dropped from the badge.
    #[test]
    fn get_diff_stats_skips_untracked_walk_past_limit() {
        let dir = init_test_repo();
        let path = dir.path();
        let path_str = path.to_str().expect("temp dir path is valid UTF-8");

        let git = |args: &[&str]| {
            StdCommand::new("git")
                .args(["-c", "user.name=Test", "-c", "user.email=test@test.com"])
                .args(args)
                .current_dir(path)
                .output()
                .expect("git command")
        };

        // Baseline commit on main, then a branch with one tracked-uncommitted
        // edit so additions != 0 from sources other than untracked files.
        std::fs::write(path.join("seed.txt"), "seed\n").expect("write seed.txt");
        git(&["add", "."]);
        git(&["commit", "-m", "seed"]);
        git(&["checkout", "-b", "feature"]);
        std::fs::write(path.join("seed.txt"), "seed\nextra\n").expect("rewrite seed.txt");

        // Drop UNTRACKED_FILE_LIMIT + 1 untracked one-line files into the
        // worktree. If the loop ran, each would contribute one addition.
        let overflow = UNTRACKED_FILE_LIMIT + 1;
        for i in 0..overflow {
            std::fs::write(path.join(format!("u_{i}.txt")), "x\n")
                .expect("write untracked file");
        }

        let (additions, deletions) =
            get_diff_stats(path_str, Some("main")).expect("get_diff_stats");

        // Only the 1 tracked-uncommitted addition should land — untracked
        // files past the cap must be skipped entirely, not partially counted.
        assert_eq!(additions, 1, "additions should reflect only the tracked edit");
        assert_eq!(deletions, 0);
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
