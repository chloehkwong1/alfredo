use crate::types::AppError;
use tauri::Manager;
use tokio::io::AsyncBufReadExt;

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

/// Maximum length of the returned summary. Keeps IPC messages compact and
/// bounds memory if a user pastes a huge prompt. Tab UI truncates further
/// via CSS.
const SUMMARY_MAX_CHARS: usize = 80;

/// Maximum number of JSONL lines to scan looking for the first `last-prompt`
/// entry. Claude writes it early in the file, but we cap so a malformed
/// session without any `last-prompt` can't OOM us.
const SUMMARY_MAX_LINES_SCANNED: usize = 5_000;

/// Read the first user prompt from a Claude Code session JSONL and return it
/// as a truncated string, suitable for use as a tab label.
///
/// Returns `Ok(None)` when:
/// - the project directory doesn't exist,
/// - the session `.jsonl` file doesn't exist,
/// - the file contains no `last-prompt` entries within the scan cap.
///
/// Errors only on unexpected IO failures (permissions, disk).
#[tauri::command]
pub async fn get_session_summary(
    session_id: String,
    worktree_path: String,
) -> Result<Option<String>> {
    let home = std::env::var("HOME").map(std::path::PathBuf::from).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "could not determine home directory")
    })?;
    let projects_dir = home.join(".claude").join("projects");

    let needle = normalize_project_dir(&worktree_path.replace('/', "-"));

    // Find the matching project directory (same tolerance as find_claude_session).
    let mut dir_listing = match tokio::fs::read_dir(&projects_dir).await {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    let mut jsonl_path: Option<std::path::PathBuf> = None;
    while let Some(entry) = dir_listing.next_entry().await? {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else { continue };
        if normalize_project_dir(name_str) != needle {
            continue;
        }
        let candidate = entry.path().join(format!("{session_id}.jsonl"));
        if tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            jsonl_path = Some(candidate);
            break;
        }
    }

    let Some(jsonl_path) = jsonl_path else { return Ok(None) };

    let file = match tokio::fs::File::open(&jsonl_path).await {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    let reader = tokio::io::BufReader::new(file);
    let mut lines = reader.lines();
    let mut scanned = 0usize;

    while let Some(line) = lines.next_line().await? {
        scanned += 1;
        if scanned > SUMMARY_MAX_LINES_SCANNED {
            break;
        }
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        if value.get("type").and_then(|v| v.as_str()) != Some("last-prompt") {
            continue;
        }
        let Some(prompt) = value.get("lastPrompt").and_then(|v| v.as_str()) else { continue };
        let trimmed = prompt.trim();
        if trimmed.is_empty() {
            continue;
        }
        return Ok(Some(truncate_chars(trimmed, SUMMARY_MAX_CHARS)));
    }

    Ok(None)
}

/// Truncate a string to at most `max` chars (not bytes). Appends an ellipsis
/// only if truncation occurred.
fn truncate_chars(s: &str, max: usize) -> String {
    let mut chars = s.chars();
    let head: String = chars.by_ref().take(max).collect();
    if chars.next().is_some() {
        format!("{head}…")
    } else {
        head
    }
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
            // Migrate from legacy location: <repo>/.alfredo/sessions/<id>.json
            let legacy_path = std::path::Path::new(&repo_path)
                .join(".alfredo/sessions")
                .join(format!("{safe_id}.json"));
            match tokio::fs::read_to_string(&legacy_path).await {
                Ok(content) => {
                    // Write to new location so future loads find it there.
                    // Only delete legacy file if write succeeds to avoid data loss.
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
