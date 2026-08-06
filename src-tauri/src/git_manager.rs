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
    // fall back to using the existing branch. `--no-track` stops git's
    // branch.autoSetupMerge from recording the startpoint (origin/<base>) as
    // the new branch's upstream — a never-pushed branch claiming it tracks
    // origin/main misleads every tool that derives the base or publish state
    // from the upstream (push.default=simple refusals, "behind origin/main"
    // banners, skills rebasing onto main). The honest state is no upstream
    // until the branch is genuinely published with `push -u`.
    let output = git_command()
        .args([
            "worktree",
            "add",
            "--no-track",
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
/// Resolves the on-disk path by asking git (libgit2 by admin name, then
/// `git worktree list --porcelain`) rather than recomputing it from
/// `worktree_name` + `base_path`, so it works even when the worktree was
/// created under a different base, renamed since, or carries a branch name that
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

    // `worktree_name` is git's admin name (`.git/worktrees/<name>`), which is
    // fixed at creation — it's what `list_worktrees` reports as `Worktree.name`.
    // Rename a worktree's branch and directory and that name matches neither the
    // path basename nor the branch, so the porcelain scan below misses it and the
    // caller force-cleans a computed path that doesn't exist: a delete that
    // reports success and removes nothing. Ask libgit2 by the same name the id
    // came from first, so the lookup can't drift.
    if let Ok(repo) = Repository::open(repo_path) {
        if let Ok(worktree) = repo.find_worktree(worktree_name) {
            let path = worktree.path().to_path_buf();
            let branch = get_branch_for_path(&path);
            return (path, branch);
        }
    }

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
        // Local-first for stack parents: the parent branch has a live worktree
        // checkout and restacks target its local tip, so origin/<parent> lags
        // whenever the parent was rebased but its push hasn't landed. Counting
        // or diffing against the stale remote in that window shows the parent's
        // rebased-away commits as "behind"/inflated stats. Remote remains the
        // fallback for stale config pointing at a deleted local branch.
        let local_check = git_command_sync()
            .args(["rev-parse", "--verify", &format!("refs/heads/{parent}")])
            .current_dir(worktree_path)
            .output();
        if local_check.map(|o| o.status.success()).unwrap_or(false) {
            return parent.to_string();
        }
        let remote_ref = format!("origin/{parent}");
        let check = git_command_sync()
            .args(["rev-parse", "--verify", &format!("refs/remotes/{remote_ref}")])
            .current_dir(worktree_path)
            .output();
        if check.map(|o| o.status.success()).unwrap_or(false) {
            return remote_ref;
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
/// Returns `Ok(None)` when no upstream is configured (rev-parse fails) or when
/// the upstream is a *different* branch — worktree branches inherit tracking
/// from their start point (see `has_matching_upstream`), and counting against
/// origin/main turns "unpublished" into a bogus behind-main figure whose Pull
/// CTA would rebase the branch onto main. Both read as "unpublished → Publish"
/// in the UI, and Publish (`git push -u`) repairs the upstream. A rev-list
/// failure with a matching upstream bubbles up as `Err` so the UI doesn't
/// misread a transient git failure as "no upstream → Publish". A detached
/// HEAD (mid-rebase, mid-merge, mid-bisect) also bubbles as `Err`
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

    let head_ref = String::from_utf8_lossy(&symbolic.stdout).trim().to_string();
    let branch = head_ref.strip_prefix("refs/heads/").unwrap_or(&head_ref);
    let merge = git_command_sync()
        .args(["config", &format!("branch.{branch}.merge")])
        .current_dir(worktree_path)
        .output()
        .map_err(|e| AppError::Git(format!("failed to spawn git config: {e}")))?;
    if !merge.status.success() || String::from_utf8_lossy(&merge.stdout).trim() != head_ref {
        return Ok(None); // upstream is a different branch — treat as unpublished
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

/// `git wip`: stash uncommitted + untracked changes as a throwaway commit so
/// a history-rewriting operation runs on a clean tree. Tags the commit message
/// with the pre-wip HEAD SHA so we can unambiguously identify it later — even
/// after a rebase replays it onto a new base (where its own SHA changes but
/// the message is preserved). Returns the marker if the tree was dirty.
async fn wip_stash(worktree_path: &str) -> Result<Option<String>, AppError> {
    let status = git_command()
        .args(["status", "--porcelain"])
        .current_dir(worktree_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git status: {e}")))?;
    if status.stdout.is_empty() {
        return Ok(None);
    }

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
    Ok(Some(marker))
}

/// `git unwip`: if HEAD's subject contains our unique marker, the tip is still
/// our wip commit (possibly replayed onto a new base — its parent is then the
/// new base, so `reset --mixed HEAD~1` correctly restores the working tree
/// with the wip content as uncommitted changes again).
async fn unwip(worktree_path: &str, marker: &str) -> Result<(), AppError> {
    let head_subject = git_command()
        .args(["log", "-1", "--pretty=%s"])
        .current_dir(worktree_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git log: {e}")))?;
    let subject = String::from_utf8_lossy(&head_subject.stdout);
    if !subject.contains(marker) {
        // The wip commit isn't at HEAD. `unwip` only runs once the rebase step
        // has settled, and a failed rebase is always aborted first (which
        // restores the wip to HEAD, so the marker would still match here) — and
        // its error is surfaced ahead of unwip's by the caller regardless. So a
        // missing marker means the rebase SUCCEEDED and git dropped the wip
        // because its entire diff was already present on the new base ("patch
        // contents already upstream" / replayed to empty). The content is
        // therefore already in the working tree; there is nothing to restore, so
        // this is a benign no-op, not a failure.
        return Ok(());
    }
    let reset = git_command()
        .args(["reset", "--mixed", "HEAD~1"])
        .current_dir(worktree_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git reset (unwip): {e}")))?;
    if !reset.status.success() {
        let stderr = String::from_utf8_lossy(&reset.stderr);
        return Err(AppError::Git(format!("git unwip failed: {stderr}")));
    }
    Ok(())
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

    let wip_marker = wip_stash(worktree_path).await?;

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

    let unwip_result: Result<(), AppError> = match wip_marker.as_ref() {
        Some(marker) => unwip(worktree_path, marker).await,
        None => Ok(()),
    };

    // Surface the rebase error first if there was one; otherwise surface any unwip error.
    rebase_result?;
    unwip_result?;
    Ok(())
}

/// Rebase the current branch's commits since `baseline_sha` onto `target_sha`:
/// `git rebase --onto <target> <baseline>`. Replays only the child's own commits,
/// so it survives parent history rewrites and squash-merged parents.
/// `abort_on_failure: false` leaves a conflicted rebase in place (agent handoff path).
pub async fn rebase_onto_sha(
    worktree_path: &str,
    target_sha: &str,
    baseline_sha: &str,
    abort_on_failure: bool,
) -> Result<(), AppError> {
    validate_commit_hash(target_sha)?;
    validate_commit_hash(baseline_sha)?;

    let wip_marker = wip_stash(worktree_path).await?;

    let rebase_result: Result<(), AppError> = async {
        let rebase = git_command()
            .args(["rebase", "--onto", target_sha, baseline_sha])
            .current_dir(worktree_path)
            .output()
            .await
            .map_err(|e| AppError::Git(format!("failed to spawn git rebase: {e}")))?;
        if !rebase.status.success() {
            let stderr = String::from_utf8_lossy(&rebase.stderr).to_string();
            if abort_on_failure {
                let _ = git_command()
                    .args(["rebase", "--abort"])
                    .current_dir(worktree_path)
                    .output()
                    .await;
                return Err(AppError::Git(format!("rebase --onto failed (aborted): {stderr}")));
            }
            return Err(AppError::Git(format!("rebase --onto failed (left in place): {stderr}")));
        }
        Ok(())
    }
    .await;

    // Mirror rebase_onto's invariant: always unwip when we successfully finished or
    // aborted; skip only when we intentionally left a conflicted rebase in place.
    let left_in_place = rebase_result.is_err() && !abort_on_failure;
    let unwip_result: Result<(), AppError> = match (wip_marker.as_ref(), left_in_place) {
        (Some(marker), false) => unwip(worktree_path, marker).await,
        _ => Ok(()),
    };

    rebase_result?;
    unwip_result?;
    Ok(())
}

/// `git merge-base <a> <b>` — used as the baseline fallback for pre-existing stacks.
pub async fn merge_base(worktree_path: &str, a: &str, b: &str) -> Result<String, AppError> {
    let output = git_command()
        .args(["merge-base", a, b])
        .current_dir(worktree_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git merge-base: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("git merge-base failed: {stderr}")));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// True when the current branch's upstream is its *own* branch on a remote —
/// `branch.<name>.merge` names the branch itself and the tracking ref
/// resolves. A bare "has an upstream" check is not enough: worktree branches
/// used to inherit tracking from their start point (`git worktree add -b X
/// <dir> origin/main` leaves X tracking origin/main), which makes an
/// unpublished branch look published and sends a bare `git push
/// --force-with-lease` into push.default=simple's name-mismatch refusal.
/// `create_worktree` now passes `--no-track`, but branches created before
/// that fix — or outside Alfredo — still carry inherited upstreams, so this
/// guard stays.
pub async fn has_matching_upstream(worktree_path: &str) -> bool {
    let head = match git_command()
        .args(["symbolic-ref", "--quiet", "HEAD"])
        .current_dir(worktree_path)
        .output()
        .await
    {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => return false, // detached HEAD or spawn failure
    };
    let Some(branch) = head.strip_prefix("refs/heads/") else {
        return false;
    };
    let merge_matches = git_command()
        .args(["config", &format!("branch.{branch}.merge")])
        .current_dir(worktree_path)
        .output()
        .await
        .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).trim() == head)
        .unwrap_or(false);
    if !merge_matches {
        return false;
    }
    // The merge config can outlive the remote branch (deleted after merge);
    // only a resolvable tracking ref means there is something to lease against.
    git_command()
        .args(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"])
        .current_dir(worktree_path)
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Reject anything that isn't a plausible git object hash before it reaches a
/// `git` argument position — a value beginning with `-` would otherwise be
/// parsed as a flag rather than a revision.
///
/// `pub(crate)` so callers can pre-validate and classify a bad revision as their
/// own "never attempted" case, rather than only learning about it from
/// `rebase_onto_sha`'s error — which is indistinguishable from a real conflict.
pub(crate) fn validate_commit_hash(commit_hash: &str) -> Result<(), AppError> {
    if commit_hash.len() < 7
        || commit_hash.len() > 40
        || !commit_hash.chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(AppError::Git(format!("invalid commit hash: {commit_hash:?}")));
    }
    Ok(())
}

/// Remove a single commit from the current branch's history by replaying the
/// commits after it onto its parent (`git rebase --onto <hash>^ <hash>`).
/// Dirty-tree-safe via the same wip-stash machinery as `rebase_onto`. On
/// conflict the rebase is aborted and history is left untouched.
pub async fn drop_commit(worktree_path: &str, commit_hash: &str) -> Result<(), AppError> {
    // Hashes come from our own commit list, but validate anyway so a malformed
    // value can never be parsed as a flag by git.
    validate_commit_hash(commit_hash)?;

    let wip_marker = wip_stash(worktree_path).await?;

    // Every exit path after this point must unwip if we created a wip commit.
    let drop_result: Result<(), AppError> = async {
        let onto = format!("{commit_hash}^");
        let rebase = git_command()
            .args(["rebase", "--onto", &onto, commit_hash])
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
            return Err(AppError::Git(format!(
                "Couldn't drop the commit cleanly — a later commit depends on it. \
                 Nothing was changed. (git: {stderr})"
            )));
        }
        Ok(())
    }
    .await;

    let unwip_result: Result<(), AppError> = match wip_marker.as_ref() {
        Some(marker) => unwip(worktree_path, marker).await,
        None => Ok(()),
    };

    drop_result?;
    unwip_result?;
    Ok(())
}

/// Whether a commit is reachable from any remote-tracking branch — i.e.
/// dropping it rewrites history that has already been pushed.
pub async fn is_commit_pushed(worktree_path: &str, commit_hash: &str) -> Result<bool, AppError> {
    validate_commit_hash(commit_hash)?;

    let out = git_command()
        .args(["branch", "-r", "--contains", commit_hash])
        .current_dir(worktree_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git branch -r: {e}")))?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(AppError::Git(format!("git branch -r --contains failed: {stderr}")));
    }
    Ok(!out.stdout.is_empty())
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
    // Use the resolved diff base — local <parent> first (live checkout, restack
    // target), then origin/<parent>, then default branch.
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

/// Composite worktree id used across the app: `"<repo_path>::<branch>"`.
/// Single source of truth so the create-return, the setup-complete event, and
/// list_worktrees cannot drift in format.
pub fn worktree_id(repo_path: &str, branch: &str) -> String {
    format!("{repo_path}::{branch}")
}

/// Creation time of a worktree as epoch milliseconds, read from the birthtime
/// of the `<gitdir>/worktrees/<name>` metadata directory. Returns `None` on
/// filesystems without birthtime support — no error surfaced.
pub fn worktree_created_at_epoch(repo: &Repository, name: &str) -> Option<i64> {
    let meta_dir = repo.path().join("worktrees").join(name);
    std::fs::metadata(meta_dir)
        .and_then(|m| m.created())
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
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
        let Ok(Some(name)) = name else { continue };

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
            id: worktree_id(repo_path, &branch),
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
            setup_in_progress: false,
            assigned_port: None,
            created_at_epoch: worktree_created_at_epoch(&repo, name),
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
        let Ok(Some(name)) = name else { continue };
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
        if let Ok(name) = head.shorthand() {
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
        // Repo-local identity: CI runners have no global gitconfig and git's
        // ident auto-detection fails there, so bare `git commit` in tests
        // needs this to be deterministic.
        for (k, v) in [("user.name", "Test"), ("user.email", "test@test.com")] {
            StdCommand::new("git")
                .args(["config", k, v])
                .current_dir(path)
                .output()
                .expect("git config");
        }
        StdCommand::new("git")
            .args(["commit", "--allow-empty", "-m", "init"])
            .current_dir(path)
            .output()
            .expect("git initial commit");
        dir
    }

    fn commit_file(path: &std::path::Path, file: &str, content: &str, msg: &str) -> String {
        std::fs::write(path.join(file), content).expect("write file");
        StdCommand::new("git").args(["add", "-A"]).current_dir(path).output().expect("git add");
        StdCommand::new("git")
            .args(["commit", "--no-gpg-sign", "-m", msg])
            .current_dir(path)
            .output()
            .expect("git commit");
        let out = StdCommand::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(path)
            .output()
            .expect("git rev-parse");
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn log_subjects(path: &std::path::Path) -> Vec<String> {
        let out = StdCommand::new("git")
            .args(["log", "--pretty=%s"])
            .current_dir(path)
            .output()
            .expect("git log");
        String::from_utf8_lossy(&out.stdout).lines().map(str::to_string).collect()
    }

    #[tokio::test]
    async fn drop_commit_removes_middle_commit_and_keeps_later_ones() {
        let dir = init_test_repo();
        let path = dir.path();
        commit_file(path, "a.txt", "a", "add a");
        let b_sha = commit_file(path, "b.txt", "b", "add b");
        commit_file(path, "c.txt", "c", "add c");

        drop_commit(path.to_str().unwrap(), &b_sha).await.expect("drop should succeed");

        let subjects = log_subjects(path);
        assert!(!subjects.contains(&"add b".to_string()), "dropped commit still present: {subjects:?}");
        assert!(subjects.contains(&"add c".to_string()), "later commit lost: {subjects:?}");
        assert!(!path.join("b.txt").exists(), "b.txt should be gone after drop");
        assert!(path.join("c.txt").exists(), "c.txt should survive");
    }

    #[tokio::test]
    async fn drop_commit_preserves_uncommitted_changes() {
        let dir = init_test_repo();
        let path = dir.path();
        let a_sha = commit_file(path, "a.txt", "a", "add a");
        commit_file(path, "b.txt", "b", "add b");
        std::fs::write(path.join("dirty.txt"), "uncommitted").expect("write dirty file");

        drop_commit(path.to_str().unwrap(), &a_sha).await.expect("drop should succeed");

        assert_eq!(
            std::fs::read_to_string(path.join("dirty.txt")).unwrap(),
            "uncommitted",
            "uncommitted file must survive the drop"
        );
        let subjects = log_subjects(path);
        assert!(!subjects.iter().any(|s| s.contains("--wip--")), "wip commit leaked into history: {subjects:?}");
    }

    #[tokio::test]
    async fn drop_commit_conflict_aborts_and_leaves_history_intact() {
        let dir = init_test_repo();
        let path = dir.path();
        let a_sha = commit_file(path, "f.txt", "version-a", "edit f (a)");
        commit_file(path, "f.txt", "version-b", "edit f (b)");

        let err = drop_commit(path.to_str().unwrap(), &a_sha).await
            .expect_err("dropping a commit a later commit depends on must fail");
        assert!(err.to_string().contains("Couldn't drop"), "got: {err}");

        let subjects = log_subjects(path);
        assert!(subjects.contains(&"edit f (a)".to_string()), "history rewritten after abort: {subjects:?}");
        assert!(subjects.contains(&"edit f (b)".to_string()), "history rewritten after abort: {subjects:?}");
        assert!(!path.join(".git").join("rebase-merge").exists(), "rebase left in progress");
    }

    #[tokio::test]
    async fn drop_commit_dirty_conflict_aborts_and_restores_uncommitted() {
        let dir = init_test_repo();
        let path = dir.path();
        let a_sha = commit_file(path, "f.txt", "version-a", "edit f (a)");
        commit_file(path, "f.txt", "version-b", "edit f (b)");
        std::fs::write(path.join("dirty.txt"), "uncommitted").expect("write dirty file");

        let err = drop_commit(path.to_str().unwrap(), &a_sha).await
            .expect_err("dropping a commit a later commit depends on must fail");
        assert!(err.to_string().contains("Couldn't drop"), "got: {err}");

        let subjects = log_subjects(path);
        assert!(subjects.contains(&"edit f (a)".to_string()), "history rewritten after abort: {subjects:?}");
        assert!(subjects.contains(&"edit f (b)".to_string()), "history rewritten after abort: {subjects:?}");
        assert!(!path.join(".git").join("rebase-merge").exists(), "rebase left in progress");
        assert_eq!(
            std::fs::read_to_string(path.join("dirty.txt")).unwrap(),
            "uncommitted",
            "uncommitted file must survive the aborted drop"
        );
        assert!(!subjects.iter().any(|s| s.contains("--wip--")), "wip commit leaked into history: {subjects:?}");
    }

    #[tokio::test]
    async fn drop_commit_rejects_malformed_hash() {
        let dir = init_test_repo();
        let err = drop_commit(dir.path().to_str().unwrap(), "--exec=touch pwned").await
            .expect_err("malformed hash must be rejected");
        assert!(err.to_string().contains("invalid commit hash"), "got: {err}");
    }

    #[tokio::test]
    async fn is_commit_pushed_false_without_remote_true_after_push() {
        let dir = init_test_repo();
        let path = dir.path();
        let sha = commit_file(path, "a.txt", "a", "add a");

        assert!(!is_commit_pushed(path.to_str().unwrap(), &sha).await.unwrap());

        let remote = TempDir::new().expect("remote dir");
        StdCommand::new("git")
            .args(["init", "--bare", "-b", "main"])
            .current_dir(remote.path())
            .output()
            .expect("git init --bare");
        StdCommand::new("git")
            .args(["remote", "add", "origin", remote.path().to_str().unwrap()])
            .current_dir(path)
            .output()
            .expect("git remote add");
        StdCommand::new("git")
            .args(["push", "origin", "main"])
            .current_dir(path)
            .output()
            .expect("git push");

        assert!(is_commit_pushed(path.to_str().unwrap(), &sha).await.unwrap());
    }

    /// Regression: when the entire uncommitted change set is already present on
    /// the rebase target, the replayed wip commit becomes a no-op and git drops
    /// it ("patch contents already upstream"). `unwip` must treat that benign
    /// case as success — the content is already in the tree — rather than
    /// erroring out and stranding the user. See `unwip`.
    #[tokio::test]
    async fn rebase_onto_absorbs_already_upstream_wip_without_error() {
        let dir = init_test_repo();
        let path = dir.path();

        // Give the base repo an origin and publish main.
        let remote = TempDir::new().expect("remote dir");
        StdCommand::new("git")
            .args(["init", "--bare", "-b", "main"])
            .current_dir(remote.path())
            .output()
            .expect("git init --bare");
        StdCommand::new("git")
            .args(["remote", "add", "origin", remote.path().to_str().unwrap()])
            .current_dir(path)
            .output()
            .expect("git remote add");
        StdCommand::new("git")
            .args(["push", "origin", "main"])
            .current_dir(path)
            .output()
            .expect("git push main");

        // A second clone advances origin/main with a commit adding dup.txt.
        let other = TempDir::new().expect("other clone dir");
        StdCommand::new("git")
            .args(["clone", remote.path().to_str().unwrap(), other.path().to_str().unwrap()])
            .output()
            .expect("git clone");
        for (k, v) in [("user.name", "Other"), ("user.email", "other@test.com")] {
            StdCommand::new("git")
                .args(["config", k, v])
                .current_dir(other.path())
                .output()
                .expect("git config");
        }
        commit_file(other.path(), "dup.txt", "dupc\n", "upstream adds dup.txt");
        StdCommand::new("git")
            .args(["push", "origin", "main"])
            .current_dir(other.path())
            .output()
            .expect("git push dup");

        // Base repo: a local commit, plus an uncommitted change identical to what
        // upstream just committed — so the wip is an already-applied duplicate.
        commit_file(path, "local.txt", "local", "local work");
        std::fs::write(path.join("dup.txt"), "dupc\n").expect("write uncommitted dup");

        rebase_onto(path.to_str().unwrap(), Some("main"))
            .await
            .expect("rebase should succeed even when the wip is absorbed upstream");

        // The uncommitted change is now upstream, so the tree is clean...
        let status = StdCommand::new("git")
            .args(["status", "--porcelain"])
            .current_dir(path)
            .output()
            .expect("git status");
        assert!(
            status.stdout.is_empty(),
            "tree should be clean after the wip is absorbed, got: {}",
            String::from_utf8_lossy(&status.stdout)
        );
        // ...the content survived...
        assert_eq!(std::fs::read_to_string(path.join("dup.txt")).unwrap(), "dupc\n");
        // ...the local commit survived, and no wip commit leaked into history.
        let subjects = log_subjects(path);
        assert!(subjects.contains(&"local work".to_string()), "local commit lost: {subjects:?}");
        assert!(
            subjects.contains(&"upstream adds dup.txt".to_string()),
            "upstream commit missing: {subjects:?}"
        );
        assert!(!subjects.iter().any(|s| s.contains("--wip--")), "wip commit leaked: {subjects:?}");
    }

    fn run_git(dir: &str, args: &[&str]) {
        let out = std::process::Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    }
    fn rev_parse(dir: &str, r: &str) -> String {
        let out = std::process::Command::new("git").args(["rev-parse", r]).current_dir(dir).output().unwrap();
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    #[tokio::test]
    async fn rebase_onto_sha_survives_parent_rewrite() {
        // repo: main ── p1 ── p2 (parent)   child: p2 ── c1
        // parent then amends p2 → p2' (history rewrite).
        // Plain rebase would replay p2 onto p2' and conflict; --onto replays only c1.
        let dir = init_test_repo(); // main with one commit
        let root = dir.path().to_str().unwrap();
        run_git(root, &["checkout", "-b", "parent"]);
        std::fs::write(dir.path().join("p.txt"), "p1").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "p1"]);
        std::fs::write(dir.path().join("p.txt"), "p2").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "p2"]);
        let old_parent_tip = rev_parse(root, "HEAD");
        run_git(root, &["checkout", "-b", "child"]);
        std::fs::write(dir.path().join("c.txt"), "c1").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "c1"]);
        // rewrite parent: amend p2 with different content
        run_git(root, &["checkout", "parent"]);
        std::fs::write(dir.path().join("p.txt"), "p2-rewritten").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "--amend", "-m", "p2 rewritten"]);
        let new_parent_tip = rev_parse(root, "HEAD");
        run_git(root, &["checkout", "child"]);

        rebase_onto_sha(root, &new_parent_tip, &old_parent_tip, true).await.expect("rebase --onto must succeed where plain rebase conflicts");

        // child has exactly one commit on top of the rewritten parent
        let out = std::process::Command::new("git")
            .args(["rev-list", "--count", &format!("{new_parent_tip}..HEAD")])
            .current_dir(root).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "1");
        assert!(std::fs::read_to_string(dir.path().join("p.txt")).unwrap().contains("rewritten"));
    }

    #[tokio::test]
    async fn rebase_onto_sha_conflict_aborts_and_restores() {
        // child edits the same line the rewritten parent edits → genuine conflict.
        // With abort_on_failure=true the worktree must come back clean on the old tip.
        let dir = init_test_repo();
        let root = dir.path().to_str().unwrap();
        run_git(root, &["checkout", "-b", "parent"]);
        std::fs::write(dir.path().join("s.txt"), "base").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "p1"]);
        let old_parent_tip = rev_parse(root, "HEAD");
        run_git(root, &["checkout", "-b", "child"]);
        std::fs::write(dir.path().join("s.txt"), "child-edit").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "c1"]);
        let child_tip_before = rev_parse(root, "HEAD");
        run_git(root, &["checkout", "parent"]);
        std::fs::write(dir.path().join("s.txt"), "parent-edit").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "p2"]);
        let new_parent_tip = rev_parse(root, "HEAD");
        run_git(root, &["checkout", "child"]);

        let err = rebase_onto_sha(root, &new_parent_tip, &old_parent_tip, true).await;
        assert!(err.is_err());
        assert_eq!(rev_parse(root, "HEAD"), child_tip_before, "aborted rebase must restore the tip");
        let status = std::process::Command::new("git").args(["status", "--porcelain"])
            .current_dir(root).output().unwrap();
        assert!(status.stdout.is_empty(), "worktree must be clean after abort");
    }

    #[tokio::test]
    async fn merge_base_returns_fork_point() {
        let dir = init_test_repo();
        let root = dir.path().to_str().unwrap();
        let base = rev_parse(root, "HEAD");
        run_git(root, &["checkout", "-b", "a"]);
        std::fs::write(dir.path().join("a.txt"), "a").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "a"]);
        run_git(root, &["checkout", "-b", "b", &base]);
        std::fs::write(dir.path().join("b.txt"), "b").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "b"]);
        assert_eq!(merge_base(root, "a", "b").await.unwrap(), base);
    }

    #[tokio::test]
    async fn has_matching_upstream_requires_the_branchs_own_remote_ref() {
        let dir = init_test_repo();
        let root = dir.path().to_str().unwrap();

        let remote = TempDir::new().expect("remote dir");
        StdCommand::new("git")
            .args(["init", "--bare", "-b", "main"])
            .current_dir(remote.path())
            .output()
            .expect("git init --bare");
        run_git(root, &["remote", "add", "origin", remote.path().to_str().unwrap()]);
        run_git(root, &["push", "-u", "origin", "main"]);

        assert!(has_matching_upstream(root).await, "main should match after push -u");

        run_git(root, &["checkout", "-b", "no-upstream"]);
        assert!(!has_matching_upstream(root).await, "a fresh local branch should have no upstream");

        // The worktree-creation shape: branch started from origin/main inherits
        // origin/main as upstream. An upstream *exists* — but it is not this
        // branch's remote copy, so it must not count as published.
        run_git(root, &["branch", "--set-upstream-to=origin/main"]);
        let upstream = StdCommand::new("git")
            .args(["rev-parse", "--abbrev-ref", "@{upstream}"])
            .current_dir(root)
            .output()
            .expect("git rev-parse");
        assert!(upstream.status.success(), "setup must produce a resolvable upstream");
        assert!(
            !has_matching_upstream(root).await,
            "an upstream inherited from the start point is not the branch's own"
        );

        run_git(root, &["push", "-u", "origin", "no-upstream"]);
        assert!(has_matching_upstream(root).await, "push -u repairs the upstream");
    }

    #[tokio::test]
    async fn create_worktree_from_remote_base_sets_no_upstream() {
        // A branch started from origin/<base> must NOT inherit origin/<base>
        // as its upstream: a never-pushed branch claiming it tracks
        // origin/main misleads every tool that derives publish state or the
        // base branch from the upstream (bare force-push refusals, "behind
        // origin/main" banners, skills rebasing onto main).
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().unwrap();

        let remote = TempDir::new().expect("remote dir");
        StdCommand::new("git")
            .args(["init", "--bare", "-b", "main"])
            .current_dir(remote.path())
            .output()
            .expect("git init --bare");
        run_git(repo_path, &["remote", "add", "origin", remote.path().to_str().unwrap()]);
        run_git(repo_path, &["push", "-u", "origin", "main"]);

        let base_dir = TempDir::new().expect("create base temp dir");
        let base_path = base_dir.path().to_str().unwrap();
        let wt_path = create_worktree(repo_path, "stacked-child", "origin/main", Some(base_path))
            .await
            .expect("create_worktree should succeed");

        // Startpoint took effect…
        let wt = wt_path.to_str().unwrap();
        assert_eq!(rev_parse(wt, "HEAD"), rev_parse(repo_path, "origin/main"));
        // …but no upstream was recorded.
        let merge_cfg = git_in(&wt_path, &["config", "branch.stacked-child.merge"]);
        assert!(
            !merge_cfg.status.success(),
            "new branch must not inherit its startpoint as upstream, got {:?}",
            String::from_utf8_lossy(&merge_cfg.stdout)
        );

        delete_worktree(repo_path, "stacked-child", true, Some(base_path))
            .await
            .expect("delete should succeed");
    }

    #[tokio::test]
    async fn ahead_behind_treats_mismatched_upstream_as_unpublished() {
        let dir = init_test_repo();
        let root = dir.path().to_str().unwrap();

        let remote = TempDir::new().expect("remote dir");
        StdCommand::new("git")
            .args(["init", "--bare", "-b", "main"])
            .current_dir(remote.path())
            .output()
            .expect("git init --bare");
        run_git(root, &["remote", "add", "origin", remote.path().to_str().unwrap()]);
        run_git(root, &["push", "-u", "origin", "main"]);

        run_git(root, &["checkout", "-b", "child"]);
        run_git(root, &["branch", "--set-upstream-to=origin/main"]);
        std::fs::write(dir.path().join("c.txt"), "c").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "c1"]);

        assert_eq!(
            ahead_behind_vs_upstream(root).unwrap(),
            None,
            "a branch tracking origin/main is unpublished, not '1 ahead of main'"
        );

        run_git(root, &["push", "-u", "origin", "child"]);
        assert_eq!(
            ahead_behind_vs_upstream(root).unwrap(),
            Some((0, 0)),
            "a matching upstream counts normally"
        );
    }

    #[tokio::test]
    async fn rebase_onto_sha_preserves_uncommitted_changes() {
        // Same rewritten-parent scenario as rebase_onto_sha_survives_parent_rewrite,
        // but the child worktree is dirty when the rebase runs. wip-stash/unwip must
        // round-trip the uncommitted change untouched (present, but still uncommitted).
        let dir = init_test_repo();
        let root = dir.path().to_str().unwrap();
        run_git(root, &["checkout", "-b", "parent"]);
        std::fs::write(dir.path().join("p.txt"), "p1").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "p1"]);
        std::fs::write(dir.path().join("p.txt"), "p2").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "p2"]);
        let old_parent_tip = rev_parse(root, "HEAD");
        run_git(root, &["checkout", "-b", "child"]);
        std::fs::write(dir.path().join("c.txt"), "c1").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "c1"]);
        run_git(root, &["checkout", "parent"]);
        std::fs::write(dir.path().join("p.txt"), "p2-rewritten").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "--amend", "-m", "p2 rewritten"]);
        let new_parent_tip = rev_parse(root, "HEAD");
        run_git(root, &["checkout", "child"]);

        // Dirty the child worktree with an uncommitted, untracked file.
        std::fs::write(dir.path().join("dirty.txt"), "uncommitted").unwrap();

        rebase_onto_sha(root, &new_parent_tip, &old_parent_tip, true)
            .await
            .expect("rebase --onto must succeed with a dirty tree");

        // Rebase correctness unaffected by the wip wrapping.
        let out = std::process::Command::new("git")
            .args(["rev-list", "--count", &format!("{new_parent_tip}..HEAD")])
            .current_dir(root).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "1");

        // Uncommitted change is restored: present in the tree, not committed.
        assert_eq!(std::fs::read_to_string(dir.path().join("dirty.txt")).unwrap(), "uncommitted");
        let status = std::process::Command::new("git").args(["status", "--porcelain"])
            .current_dir(root).output().unwrap();
        let status_str = String::from_utf8_lossy(&status.stdout);
        assert!(status_str.contains("dirty.txt"), "dirty.txt should still be uncommitted, got status: {status_str}");
        let subjects = std::process::Command::new("git").args(["log", "--pretty=%s"])
            .current_dir(root).output().unwrap();
        assert!(
            !String::from_utf8_lossy(&subjects.stdout).contains("--wip--"),
            "wip commit leaked into history"
        );
    }

    #[tokio::test]
    async fn rebase_onto_sha_conflict_leaves_rebase_in_place_when_abort_on_failure_false() {
        // Genuine conflict, but abort_on_failure=false: the conflicted rebase must
        // be left in place for manual/agent resolution, not aborted.
        let dir = init_test_repo();
        let root = dir.path().to_str().unwrap();
        run_git(root, &["checkout", "-b", "parent"]);
        std::fs::write(dir.path().join("s.txt"), "base").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "p1"]);
        let old_parent_tip = rev_parse(root, "HEAD");
        run_git(root, &["checkout", "-b", "child"]);
        std::fs::write(dir.path().join("s.txt"), "child-edit").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "c1"]);
        run_git(root, &["checkout", "parent"]);
        std::fs::write(dir.path().join("s.txt"), "parent-edit").unwrap();
        run_git(root, &["add", "."]); run_git(root, &["commit", "-m", "p2"]);
        let new_parent_tip = rev_parse(root, "HEAD");
        run_git(root, &["checkout", "child"]);

        let err = rebase_onto_sha(root, &new_parent_tip, &old_parent_tip, false)
            .await
            .expect_err("conflicting rebase must fail");
        assert!(err.to_string().contains("left in place"), "got: {err}");

        let rebase_merge = dir.path().join(".git").join("rebase-merge");
        let rebase_apply = dir.path().join(".git").join("rebase-apply");
        assert!(
            rebase_merge.exists() || rebase_apply.exists(),
            "conflicted rebase should be left in place, not aborted"
        );
        let status = std::process::Command::new("git").args(["status", "--porcelain"])
            .current_dir(root).output().unwrap();
        assert!(!status.stdout.is_empty(), "conflict should be visible in git status");

        // Clean up so the tempdir teardown isn't left mid-rebase.
        std::process::Command::new("git").args(["rebase", "--abort"]).current_dir(root).output().unwrap();
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

    /// Renaming a worktree's branch and directory leaves git's admin entry under
    /// `.git/worktrees/` at its *original* name, and that stale name is exactly
    /// what `list_worktrees` reports as `Worktree.name` — so it's what the delete
    /// command receives. Resolution must still find the real path and branch.
    /// Otherwise the delete silently no-ops (the computed fallback path doesn't
    /// exist, so the forced cleanup "succeeds" having removed nothing) and
    /// worktree discovery re-adopts the survivor on its next tick, forever.
    #[tokio::test]
    async fn test_delete_worktree_resolves_stale_admin_name_after_rename() {
        let dir = init_test_repo();
        let repo_path = dir.path().to_str().expect("temp dir path is valid UTF-8");
        let base_dir = TempDir::new().expect("create base temp dir");
        let base_path = base_dir.path().to_str().expect("base path is valid UTF-8");

        let original = create_worktree(repo_path, "old-name", "main", Some(base_path))
            .await
            .expect("create_worktree should succeed");

        git_in(dir.path(), &["branch", "-m", "old-name", "chloe/renamed"]);
        let renamed = base_dir.path().join("chloe-renamed");
        std::fs::rename(&original, &renamed).expect("move worktree dir");
        git_in(
            dir.path(),
            &["worktree", "repair", renamed.to_str().expect("renamed path is valid UTF-8")],
        );

        let pre_delete_repo = Repository::open(repo_path).expect("open repo");
        let admin_names: Vec<String> = pre_delete_repo
            .worktrees()
            .expect("list worktrees")
            .iter()
            .filter_map(|n| match n {
                Ok(Some(name)) => Some(name.to_string()),
                _ => None,
            })
            .collect();
        assert_eq!(
            admin_names,
            vec!["old-name".to_string()],
            "git keeps the original admin name after a rename — the premise of this test",
        );

        delete_worktree(repo_path, "old-name", true, Some(base_path))
            .await
            .expect("delete_worktree should succeed");

        assert!(!renamed.exists(), "renamed worktree directory should be gone");
        let repo = Repository::open(repo_path).expect("reopen repo");
        assert!(
            repo.find_branch("chloe/renamed", git2::BranchType::Local).is_err(),
            "the worktree's actual branch should be deleted, not the stale admin name",
        );
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
