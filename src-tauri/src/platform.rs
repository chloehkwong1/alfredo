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

/// Marker the capture command prints before `env -0`, so anything an rc
/// file writes to stdout during startup can be discarded.
const ENV_SENTINEL: &[u8] = b"__ALFREDO_ENV_START__\n";

/// How long the login shell may take to start and dump its environment
/// before the capture gives up. Slow rc files (nvm, compinit) are normal;
/// an rc file waiting on input is not, and stdin is null so it cannot be.
const ENV_CAPTURE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Resolve the environment the user's login + interactive shell exports,
/// once, and cache it. Agent PTYs spawn their binary directly rather than
/// through a shell, so without this they never see variables exported from
/// `.zshrc` / `.bashrc` (API keys, `NODE_OPTIONS`, tool config).
///
/// Same caveat as `shell_path()`: the first call blocks for as long as the
/// shell takes to start. Call from command or background threads only.
pub(crate) fn login_shell_env() -> &'static std::collections::HashMap<String, String> {
    use std::sync::OnceLock;
    static LOGIN_ENV: OnceLock<std::collections::HashMap<String, String>> = OnceLock::new();
    LOGIN_ENV.get_or_init(|| capture_login_shell_env(ENV_CAPTURE_TIMEOUT))
}

fn capture_login_shell_env(
    timeout: std::time::Duration,
) -> std::collections::HashMap<String, String> {
    use std::io::Read;
    use std::process::{Command, Stdio};
    use std::sync::mpsc;

    let shell = login_shell();
    let mut child = match Command::new(&shell)
        .args(["-li", "-c", "echo __ALFREDO_ENV_START__; env -0"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => {
            eprintln!("[platform] login-shell env capture could not start {shell}: {e}");
            return std::collections::HashMap::new();
        }
    };

    // Read stdout on a helper thread so a hung shell cannot hang us; the
    // thread is leaked on timeout, once per process, which is acceptable.
    let mut stdout = child.stdout.take();
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(out) = stdout.as_mut() {
            let _ = out.read_to_end(&mut buf);
        }
        let _ = tx.send(buf);
    });

    match rx.recv_timeout(timeout) {
        Ok(raw) => {
            let ok = child.wait().map(|s| s.success()).unwrap_or(false);
            if !ok {
                eprintln!("[platform] login-shell env capture exited non-zero; agents get Alfredo's own env");
                return std::collections::HashMap::new();
            }
            parse_env_capture(&raw)
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            eprintln!(
                "[platform] login-shell env capture timed out after {}s; agents get Alfredo's own env",
                timeout.as_secs()
            );
            std::collections::HashMap::new()
        }
    }
}

/// Parse `echo <sentinel>; env -0` output. Bytes before the sentinel are rc
/// noise. `env -0` NUL-terminates every entry, so the segment after the last
/// NUL is never an entry (it is `.zlogout` output, if anything) and is
/// dropped. Entries without a key or an `=` are skipped.
fn parse_env_capture(raw: &[u8]) -> std::collections::HashMap<String, String> {
    let Some(pos) = raw
        .windows(ENV_SENTINEL.len())
        .position(|w| w == ENV_SENTINEL)
    else {
        return std::collections::HashMap::new();
    };
    let body = &raw[pos + ENV_SENTINEL.len()..];
    let mut segments: Vec<&[u8]> = body.split(|b| *b == 0).collect();
    segments.pop();
    segments
        .into_iter()
        .filter_map(|seg| {
            let s = std::str::from_utf8(seg).ok()?;
            let (k, v) = s.split_once('=')?;
            if k.is_empty() {
                return None;
            }
            Some((k.to_string(), v.to_string()))
        })
        .collect()
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

/// Reap a fire-and-forget `Child` (an `open`/editor/terminal launcher) off
/// the calling thread. These exit almost immediately after handing off to
/// the target app; without an explicit `wait()` the process would sit as a
/// zombie until Alfredo itself exits, since dropping a `Child` never reaps it.
pub(crate) fn reap(mut child: std::process::Child) {
    std::thread::spawn(move || {
        let _ = child.wait();
    });
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    fn capture(before: &[u8], entries: &[&str], after: &[u8]) -> Vec<u8> {
        let mut raw = before.to_vec();
        raw.extend_from_slice(ENV_SENTINEL);
        for e in entries {
            raw.extend_from_slice(e.as_bytes());
            raw.push(0);
        }
        raw.extend_from_slice(after);
        raw
    }

    #[test]
    fn parses_nul_separated_entries_after_the_sentinel() {
        let raw = capture(b"", &["HOME=/Users/x", "FOO=bar"], b"");
        let env = parse_env_capture(&raw);
        assert_eq!(env.get("HOME").map(String::as_str), Some("/Users/x"));
        assert_eq!(env.get("FOO").map(String::as_str), Some("bar"));
        assert_eq!(env.len(), 2);
    }

    #[test]
    fn ignores_rc_file_noise_printed_before_the_sentinel() {
        let raw = capture(b"welcome from .zshrc\nNOT=an-entry\n", &["FOO=bar"], b"");
        let env = parse_env_capture(&raw);
        assert_eq!(env.len(), 1);
        assert_eq!(env.get("FOO").map(String::as_str), Some("bar"));
    }

    #[test]
    fn ignores_zlogout_noise_printed_after_the_last_nul() {
        let raw = capture(b"", &["FOO=bar"], b"bye from .zlogout\nX=y");
        let env = parse_env_capture(&raw);
        assert_eq!(env.len(), 1);
        assert!(!env.contains_key("X"));
    }

    #[test]
    fn keeps_equals_signs_inside_values() {
        let raw = capture(b"", &["QUERY=a=b=c"], b"");
        assert_eq!(parse_env_capture(&raw).get("QUERY").map(String::as_str), Some("a=b=c"));
    }

    #[test]
    fn skips_entries_without_a_key_or_without_equals() {
        let raw = capture(b"", &["=novalue", "NOEQUALS", "OK=1"], b"");
        let env = parse_env_capture(&raw);
        assert_eq!(env.len(), 1);
        assert_eq!(env.get("OK").map(String::as_str), Some("1"));
    }

    #[test]
    fn missing_sentinel_yields_an_empty_map() {
        assert!(parse_env_capture(b"FOO=bar\0").is_empty());
        assert!(parse_env_capture(b"").is_empty());
    }
}
