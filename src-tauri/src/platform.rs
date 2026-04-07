/// Return the user's login shell, defaulting to /bin/zsh.
pub(crate) fn login_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

/// Resolve the user's login shell PATH once and cache it. On macOS, GUI apps
/// don't inherit the shell PATH, so tools installed via version managers (nvm,
/// fnm, volta, mise, etc.) aren't discoverable. Running `$SHELL -l -c 'echo
/// $PATH'` gives us the same PATH the user gets in a terminal.
///
/// NOTE: The first call spawns a subprocess and blocks until it completes.
/// All current callers run on background/command threads, so this is fine —
/// avoid calling from `setup()` or the main thread.
fn shell_path() -> &'static str {
    use std::sync::OnceLock;
    static SHELL_PATH: OnceLock<String> = OnceLock::new();
    SHELL_PATH.get_or_init(|| {
        let shell = login_shell();
        std::process::Command::new(&shell)
            .args(["-li", "-c", "echo $PATH"])
            .stdin(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .output()
            .ok()
            .and_then(|o| {
                if !o.status.success() {
                    return None;
                }
                let path = String::from_utf8(o.stdout).ok()?.trim().to_string();
                // Sanity check: must look like a colon-separated PATH (covers
                // fish shell which prints space-separated values).
                if path.contains(':') && path.contains('/') {
                    Some(path)
                } else {
                    None
                }
            })
            .unwrap_or_default()
    })
}

/// Build a PATH string that includes common tool locations so that CLI tools
/// are discoverable from a GUI app, which does not inherit the user's shell
/// PATH on macOS. Also use this when spawning `sh -c` so that user-defined
/// scripts can reference tools installed via Homebrew, npm, pip, cargo, etc.
pub(crate) fn augmented_path() -> String {
    let home = std::env::var("HOME").unwrap_or_default();

    // Common locations for CLI tools installed by package managers:
    //   ~/.asdf/shims        — asdf version manager (ruby, node, python, etc.)
    //   ~/.mise/shims        — mise version manager (asdf successor)
    //   ~/.volta/bin         — Volta (node version manager)
    //   ~/.local/bin         — Claude Code standalone installer, pipx
    //   ~/.cargo/bin         — Rust tools (aider, etc.)
    //   /opt/homebrew/bin    — Homebrew on Apple Silicon
    //   /usr/local/bin       — Homebrew on Intel, manual installs
    let mut extra_paths: Vec<String> = Vec::new();
    if !home.is_empty() {
        extra_paths.push(format!("{home}/.asdf/shims"));
        extra_paths.push(format!("{home}/.mise/shims"));
        extra_paths.push(format!("{home}/.volta/bin"));
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
    let resolved = shell_path();
    if resolved.is_empty() {
        // Fallback: use the process PATH (covers dev builds where it's fine)
        let current = std::env::var("PATH").unwrap_or_default();
        if current.is_empty() {
            format!("{prefix}:/usr/bin:/bin:/usr/sbin:/sbin")
        } else {
            format!("{prefix}:{current}")
        }
    } else {
        format!("{prefix}:{resolved}")
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
