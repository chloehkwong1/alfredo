/// Build a PATH string that includes common tool locations so that CLI tools
/// are discoverable from a GUI app, which does not inherit the user's shell
/// PATH on macOS. Also use this when spawning `sh -c` so that user-defined
/// scripts can reference tools installed via Homebrew, npm, pip, cargo, etc.
pub(crate) fn augmented_path() -> String {
    let current = std::env::var("PATH").unwrap_or_default();
    let home = std::env::var("HOME").unwrap_or_default();

    // Common locations for CLI tools installed by package managers:
    //   ~/.local/bin         — Claude Code standalone installer, pipx
    //   ~/.cargo/bin         — Rust tools (aider, etc.)
    //   /opt/homebrew/bin    — Homebrew on Apple Silicon
    //   /usr/local/bin       — Homebrew on Intel, manual installs
    let mut extra_paths: Vec<String> = Vec::new();
    if !home.is_empty() {
        extra_paths.push(format!("{home}/.local/bin"));
        extra_paths.push(format!("{home}/.cargo/bin"));
    }
    extra_paths.extend([
        "/opt/homebrew/bin".to_string(),
        "/opt/homebrew/sbin".to_string(),
        "/usr/local/bin".to_string(),
        "/usr/local/sbin".to_string(),
    ]);

    let prefix = extra_paths.join(":");
    if current.is_empty() {
        format!("{prefix}:/usr/bin:/bin:/usr/sbin:/sbin")
    } else {
        format!("{prefix}:{current}")
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
