/// Build a PATH string that includes common Homebrew locations so that CLI tools
/// installed via Homebrew are discoverable from a GUI app, which does not
/// inherit the user's shell PATH on macOS. Also use this when spawning `sh -c`
/// so that user-defined scripts can reference Homebrew-installed tools.
pub(crate) fn augmented_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let homebrew_paths = "/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/local/sbin";
    if current.is_empty() {
        format!("{homebrew_paths}:/usr/bin:/bin:/usr/sbin:/sbin")
    } else {
        format!("{homebrew_paths}:{current}")
    }
}

/// Return a `tokio::process::Command` for `git` with an augmented PATH.
pub(crate) fn git_command() -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("git");
    cmd.env("PATH", augmented_path());
    cmd
}

/// Sync variant of `git_command` for use inside `tokio::task::spawn_blocking` closures.
pub(crate) fn git_command_sync() -> std::process::Command {
    let mut cmd = std::process::Command::new("git");
    cmd.env("PATH", augmented_path());
    cmd
}

/// Return a `tokio::process::Command` for `gh` (GitHub CLI) with an augmented PATH.
pub(crate) fn gh_command() -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new("gh");
    cmd.env("PATH", augmented_path());
    cmd
}
