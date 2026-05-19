use crate::types::AppError;
use tauri::Manager;

type Result<T> = std::result::Result<T, AppError>;

/// Normalize a project directory name for comparison. Both Claude and Alfredo
/// replace `/` with `-`, but Claude versions differ on `_`: older versions
/// preserve it, newer versions also replace `_` → `-`. Normalizing just `_`
/// lets us match either encoding without collapsing unrelated path components.
fn normalize_project_dir(s: &str) -> String {
    s.replace('_', "-")
}

/// Find the most recent Claude Code session for a given worktree path.
///
/// Claude Code stores conversation logs at `~/.claude/projects/{project-dir}/{uuid}.jsonl`
/// where `project-dir` is derived from the worktree's absolute path. The exact encoding
/// has changed across Claude versions, so we normalize both sides and scan for a match.
#[tauri::command]
pub async fn find_claude_session(worktree_path: String) -> Result<Option<String>> {
    let home = std::env::var("HOME").map(std::path::PathBuf::from).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "could not determine home directory")
    })?;
    let projects_dir = home.join(".claude").join("projects");

    let needle = normalize_project_dir(&worktree_path.replace('/', "-"));

    let mut dir_listing = match tokio::fs::read_dir(&projects_dir).await {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    // Collect matching project directories.
    let mut matching_dirs = Vec::new();
    while let Some(entry) = dir_listing.next_entry().await? {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else { continue };
        if normalize_project_dir(name_str) == needle {
            matching_dirs.push(entry.path());
        }
    }

    // Scan all matching directories for the most recent .jsonl file.
    let mut best: Option<(String, std::time::SystemTime)> = None;

    for dir in matching_dirs {
        let mut read_dir = match tokio::fs::read_dir(&dir).await {
            Ok(rd) => rd,
            Err(_) => continue,
        };

        while let Some(entry) = read_dir.next_entry().await? {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let meta = entry.metadata().await?;
            let mtime = meta.modified()?;
            let uuid = match path.file_stem().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            if best.as_ref().is_none_or(|(_, best_time)| mtime > *best_time) {
                best = Some((uuid, mtime));
            }
        }
    }

    Ok(best.map(|(uuid, _)| uuid))
}

/// Sanitise a worktree ID for use as a flat filename.
/// Branch names may contain `/` (e.g. `feat/foo`), which would create nested
/// directories if used directly.  Replace `/` with `--` so the session file
/// stays flat.
fn sanitise_id(worktree_id: &str) -> String {
    worktree_id.replace('/', "--")
}

/// Compute the sessions directory inside the app data dir for a given repo.
fn sessions_dir(app_data_dir: &std::path::Path, repo_path: &str) -> std::path::PathBuf {
    crate::config_manager::repo_data_dir(app_data_dir, repo_path).join("sessions")
}

async fn ensure_sessions_dir(app_data_dir: &std::path::Path, repo_path: &str) -> Result<()> {
    let dir = sessions_dir(app_data_dir, repo_path);
    tokio::fs::create_dir_all(&dir).await?;
    Ok(())
}

#[tauri::command]
pub async fn save_session_file(app: tauri::AppHandle, repo_path: String, worktree_id: String, data: String) -> Result<()> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("no app data dir: {e}")))?;
    ensure_sessions_dir(&app_data_dir, &repo_path).await?;
    let safe_id = sanitise_id(&worktree_id);
    let path = sessions_dir(&app_data_dir, &repo_path).join(format!("{safe_id}.json"));
    tokio::fs::write(&path, data).await?;
    Ok(())
}

#[tauri::command]
pub async fn load_session_file(app: tauri::AppHandle, repo_path: String, worktree_id: String) -> Result<Option<String>> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("no app data dir: {e}")))?;
    let safe_id = sanitise_id(&worktree_id);
    let new_path = sessions_dir(&app_data_dir, &repo_path).join(format!("{safe_id}.json"));
    match tokio::fs::read_to_string(&new_path).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // Pre-composite-id format: filename was just the sanitized branch (dir_name).
            // worktree_id is now "{repo_path}::{branch}". Strip the known repo prefix
            // rather than rsplit on "::" — branch names may legitimately contain "::".
            let pre_composite_path = worktree_id
                .strip_prefix(&repo_path)
                .and_then(|rest| rest.strip_prefix("::"))
                .map(|branch| {
                    sessions_dir(&app_data_dir, &repo_path)
                        .join(format!("{}.json", branch.replace('/', "-")))
                });
            if let Some(path) = pre_composite_path.as_ref() {
                if let Ok(content) = tokio::fs::read_to_string(path).await {
                    ensure_sessions_dir(&app_data_dir, &repo_path).await?;
                    if tokio::fs::write(&new_path, &content).await.is_ok() {
                        let _ = tokio::fs::remove_file(path).await;
                    }
                    return Ok(Some(content));
                }
            }

            // Older legacy location: <repo>/.alfredo/sessions/<id>.json
            let legacy_path = std::path::Path::new(&repo_path)
                .join(".alfredo/sessions")
                .join(format!("{safe_id}.json"));
            match tokio::fs::read_to_string(&legacy_path).await {
                Ok(content) => {
                    ensure_sessions_dir(&app_data_dir, &repo_path).await?;
                    if tokio::fs::write(&new_path, &content).await.is_ok() {
                        let _ = tokio::fs::remove_file(&legacy_path).await;
                    }
                    Ok(Some(content))
                }
                Err(_) => Ok(None),
            }
        }
        Err(e) => Err(e.into()),
    }
}

/// Strict path-component sanitiser for frontend-supplied identifiers used in
/// filenames. Keeps alnum / `-` / `_`; everything else becomes `_`. Stricter
/// than `sanitise_id` (which only strips `/`) because `dump_pty_buffer`
/// accepts arbitrary IPC input rather than controlled branch names.
fn sanitise_filename_component(s: &str) -> String {
    let cleaned: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    // Strip leading dots so we never produce hidden files.
    cleaned.trim_start_matches('.').to_string()
}

#[derive(serde::Serialize)]
pub struct PtyDumpPaths {
    raw: String,
    serialized: Option<String>,
}

/// Diagnostic: write a snapshot of an xterm session for offline replay.
///
/// - `raw` (always): the replay-buffer bytes, written to
///   `~/Library/Logs/Alfredo/pty-dump-<UTC>-<safe-id>.bin`. Replay via
///   `cat <path> > /dev/tty` in a clean terminal.
/// - `serialized` (when provided): xterm's own view of its visible buffer,
///   produced by `@xterm/addon-serialize`, written to a sibling
///   `pty-dump-<UTC>-<safe-id>.serialized.txt`. Comparing both halves tells
///   us whether corruption is "deterministic from the byte stream" (parser
///   bug) or "diverged from the byte stream" (renderer-state bug).
#[tauri::command]
pub async fn dump_pty_buffer(
    session_id: String,
    bytes: Vec<u8>,
    serialized: Option<String>,
) -> Result<PtyDumpPaths> {
    // Bounded by today's 50KB ring buffer; cap defends against future buffer
    // size changes or direct devtools invocation with a huge array.
    const MAX_DUMP_BYTES: usize = 4 * 1024 * 1024;
    if bytes.len() > MAX_DUMP_BYTES {
        return Err(AppError::Config(format!(
            "dump_pty_buffer: {} bytes exceeds cap of {}",
            bytes.len(),
            MAX_DUMP_BYTES,
        )));
    }
    if let Some(s) = &serialized {
        if s.len() > MAX_DUMP_BYTES {
            return Err(AppError::Config(format!(
                "dump_pty_buffer: serialized {} bytes exceeds cap of {}",
                s.len(),
                MAX_DUMP_BYTES,
            )));
        }
    }

    let dir = crate::logging::log_dir();
    tokio::fs::create_dir_all(&dir).await?;
    let safe_id = sanitise_filename_component(&session_id);
    let stamp = chrono::Utc::now().format("%Y-%m-%dT%H-%M-%SZ").to_string();
    let raw_path = dir.join(format!("pty-dump-{stamp}-{safe_id}.bin"));
    tokio::fs::write(&raw_path, &bytes).await?;

    let serialized_path = if let Some(s) = serialized {
        let p = dir.join(format!("pty-dump-{stamp}-{safe_id}.serialized.txt"));
        tokio::fs::write(&p, s.as_bytes()).await?;
        Some(p.to_string_lossy().into_owned())
    } else {
        None
    };

    Ok(PtyDumpPaths {
        raw: raw_path.to_string_lossy().into_owned(),
        serialized: serialized_path,
    })
}

#[tauri::command]
pub async fn delete_session_file(app: tauri::AppHandle, repo_path: String, worktree_id: String) -> Result<()> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("no app data dir: {e}")))?;
    let safe_id = sanitise_id(&worktree_id);
    let path = sessions_dir(&app_data_dir, &repo_path).join(format!("{safe_id}.json"));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}
