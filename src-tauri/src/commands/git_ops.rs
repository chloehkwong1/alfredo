use crate::git_manager::git_command;
use crate::types::AppError;

type Result<T> = std::result::Result<T, AppError>;

/// Cap network-touching git ops at 30s so a hung remote (cred prompt, dead VPN)
/// can't lock the UI behind a "Pushing…" button indefinitely.
const NETWORK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// Strip `user:token@` from URLs in git stderr before surfacing to the UI. Git
/// will print the full remote URL on failure; for HTTPS remotes with embedded
/// credentials (gh-cli helpers, CI tokens) that leaks secrets into copy-paste.
/// Plain `user@host` (no password, e.g. `ssh://git@github.com`) is left alone
/// — the username there isn't a secret.
fn redact_credentials(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(proto_idx) = rest.find("://") {
        out.push_str(&rest[..proto_idx + 3]);
        rest = &rest[proto_idx + 3..];
        // Find the end of the authority component (next '/', whitespace, or end).
        let auth_end = rest.find(|c: char| c == '/' || c.is_whitespace()).unwrap_or(rest.len());
        let auth = &rest[..auth_end];
        if let Some(at_idx) = auth.find('@') {
            // Only redact when the user portion has a password (`user:pass@`).
            // `git@host` is a public SSH username, not a credential.
            if auth[..at_idx].contains(':') {
                out.push_str("***@");
                out.push_str(&auth[at_idx + 1..]);
            } else {
                out.push_str(auth);
            }
        } else {
            out.push_str(auth);
        }
        rest = &rest[auth_end..];
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_https_userpass() {
        assert_eq!(
            redact_credentials("fatal: remote https://user:tok@github.com/foo/bar.git rejected"),
            "fatal: remote https://***@github.com/foo/bar.git rejected"
        );
    }

    #[test]
    fn redacts_oauth_token_pattern() {
        assert_eq!(
            redact_credentials("error: https://oauth2:ghp_secretX@gitlab.com/x/y.git"),
            "error: https://***@gitlab.com/x/y.git"
        );
    }

    #[test]
    fn leaves_ssh_git_user_alone() {
        // `git@` is a public SSH username, not a credential.
        let s = "fatal: ssh://git@github.com/foo/bar.git no such host";
        assert_eq!(redact_credentials(s), s);
    }

    #[test]
    fn leaves_no_auth_urls_alone() {
        let s = "fatal: could not read https://github.com/foo/bar";
        assert_eq!(redact_credentials(s), s);
    }

    #[test]
    fn redacts_multiple_urls_in_one_line() {
        assert_eq!(
            redact_credentials("from https://a:1@x.com/r and https://b:2@y.com/r"),
            "from https://***@x.com/r and https://***@y.com/r"
        );
    }

    #[test]
    fn preserves_port_when_no_auth() {
        let s = "https://github.com:443/foo/bar";
        assert_eq!(redact_credentials(s), s);
    }

    #[test]
    fn redacts_authority_with_port() {
        assert_eq!(
            redact_credentials("https://user:tok@host.local:8443/r"),
            "https://***@host.local:8443/r"
        );
    }

    #[test]
    fn empty_and_no_scheme_passthrough() {
        assert_eq!(redact_credentials(""), "");
        assert_eq!(redact_credentials("plain stderr line"), "plain stderr line");
        // SCP-style SSH (no scheme) is intentionally not touched.
        let scp = "fatal: git@github.com:foo/bar.git no such host";
        assert_eq!(redact_credentials(scp), scp);
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub success: bool,
    pub conflicted_files: Vec<String>,
}

/// Run `git merge <base_branch>` in the given repo.
/// Returns success status and list of conflicted files (if any).
#[tauri::command]
pub async fn git_merge(repo_path: String, base_branch: String) -> Result<MergeResult> {
    let output = git_command()
        .args(["merge", "--no-edit", &base_branch])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git merge: {e}")))?;

    if output.status.success() {
        return Ok(MergeResult {
            success: true,
            conflicted_files: vec![],
        });
    }

    // Check if the failure was due to conflicts
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.contains("CONFLICT") && !stderr.contains("Automatic merge failed") {
        return Err(AppError::Git(format!("git merge failed: {stderr}")));
    }

    // Collect conflicted files via `git diff --name-only --diff-filter=U`
    let diff_output = git_command()
        .args(["diff", "--name-only", "--diff-filter=U"])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to list conflicts: {e}")))?;

    let files: Vec<String> = String::from_utf8_lossy(&diff_output.stdout)
        .lines()
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect();

    Ok(MergeResult {
        success: false,
        conflicted_files: files,
    })
}

/// Run `git push --force-with-lease` in the given repo.
#[tauri::command]
pub async fn git_push_force_with_lease(repo_path: String) -> Result<()> {
    let output = git_command()
        .args(["push", "--force-with-lease"])
        .current_dir(&repo_path)
        .output()
        .await
        .map_err(|e| AppError::Git(format!("failed to spawn git push: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("git push failed: {stderr}")));
    }

    Ok(())
}

/// Run plain `git push` in the given repo (no force).
#[tauri::command]
pub async fn git_push(repo_path: String) -> Result<()> {
    let fut = git_command()
        .args(["push"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .current_dir(&repo_path)
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(NETWORK_TIMEOUT, fut)
        .await
        .map_err(|_| AppError::Git("git push timed out — remote may be unreachable or asking for credentials".into()))?
        .map_err(|e| AppError::Git(format!("failed to spawn git push: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("git push failed: {}", redact_credentials(&stderr))));
    }
    Ok(())
}

/// Run `git pull --rebase --autostash` in the given repo. `--autostash` keeps
/// the Changes panel's typical dirty state from blocking the pull. If the
/// rebase conflicts, the autostash entry stays in `git stash list` and the
/// error message points users to it.
#[tauri::command]
pub async fn git_pull_rebase(repo_path: String) -> Result<()> {
    let fut = git_command()
        .args(["pull", "--rebase", "--autostash"])
        .env("GIT_TERMINAL_PROMPT", "0")
        .current_dir(&repo_path)
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(NETWORK_TIMEOUT, fut)
        .await
        .map_err(|_| AppError::Git("git pull timed out — remote may be unreachable or asking for credentials".into()))?
        .map_err(|e| AppError::Git(format!("failed to spawn git pull: {e}")))?;
    if !output.status.success() {
        let stderr_raw = String::from_utf8_lossy(&output.stderr);
        let stderr = redact_credentials(&stderr_raw);
        // When --autostash is in play and the rebase conflicts, the user's
        // working changes vanish into the stash with no UI breadcrumb. Append
        // a hint so they can find them.
        let hint = if stderr.contains("CONFLICT") || stderr.contains("could not apply") {
            "\n\nNote: --autostash saved your working changes to `git stash` — run `git stash pop` after resolving conflicts."
        } else {
            ""
        };
        return Err(AppError::Git(format!("git pull --rebase failed: {stderr}{hint}")));
    }
    Ok(())
}

/// Run `git push -u origin -- <branch>` to publish a branch with no upstream.
/// The `--` separator prevents a branch name with a leading dash from being
/// parsed as a flag.
#[tauri::command]
pub async fn git_publish_branch(repo_path: String, branch: String) -> Result<()> {
    let fut = git_command()
        .args(["push", "-u", "origin", "--", &branch])
        .env("GIT_TERMINAL_PROMPT", "0")
        .current_dir(&repo_path)
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(NETWORK_TIMEOUT, fut)
        .await
        .map_err(|_| AppError::Git("git push -u timed out — remote may be unreachable or asking for credentials".into()))?
        .map_err(|e| AppError::Git(format!("failed to spawn git push -u: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Git(format!("git push -u failed: {}", redact_credentials(&stderr))));
    }
    Ok(())
}
