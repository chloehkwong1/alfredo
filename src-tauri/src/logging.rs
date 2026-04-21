use std::path::PathBuf;
use std::sync::OnceLock;

use tracing_appender::non_blocking::WorkerGuard;
use tracing_subscriber::{fmt, prelude::*, EnvFilter};

/// Resolve `~/Library/Logs/Alfredo` on macOS, `~/.local/state/alfredo`
/// on Linux. Falls back to a temp dir if neither is available.
fn log_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            return home.join("Library/Logs/Alfredo");
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(state) = dirs::state_dir() {
            return state.join("alfredo");
        }
        if let Some(home) = dirs::home_dir() {
            return home.join(".local/state/alfredo");
        }
    }
    std::env::temp_dir().join("alfredo")
}

/// Initialise file + stderr logging. Safe to call once at startup.
/// On failure (e.g. cannot create log dir) logs to stderr only.
pub fn init() {
    let dir = log_dir();
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("[logging] failed to create log dir {}: {e}", dir.display());
        let _ = fmt().with_env_filter(filter()).try_init();
        return;
    }

    static LOG_GUARD: OnceLock<WorkerGuard> = OnceLock::new();

    let file_appender = tracing_appender::rolling::never(&dir, "alfredo.log");
    // Hold the guard for process lifetime so the background writer thread
    // can flush on clean shutdown.
    let (file_writer, guard) = tracing_appender::non_blocking(file_appender);
    let _ = LOG_GUARD.set(guard);

    let stderr_layer = fmt::layer().with_writer(std::io::stderr).with_target(false);
    let file_layer = fmt::layer().with_writer(file_writer).with_ansi(false);

    let _ = tracing_subscriber::registry()
        .with(filter())
        .with(stderr_layer)
        .with(file_layer)
        .try_init();

    tracing::info!(path = %dir.join("alfredo.log").display(), "alfredo file logger initialised");
}

fn filter() -> EnvFilter {
    EnvFilter::try_from_env("ALFREDO_LOG").unwrap_or_else(|_| EnvFilter::new("info,alfredo=debug"))
}
