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

/// Scan `projects_dir` for every top-level `{uuid}.jsonl` belonging to
/// `worktree_path`, returning `(session_uuid, mtime)` for each.
///
/// Subagent transcripts live one level deeper in `<uuid>/subagents/` and are
/// intentionally NOT recursed into — only top-level interactive sessions are
/// resumable, so they're the only ones we surface.
async fn scan_sessions_in(
    projects_dir: &std::path::Path,
    worktree_path: &str,
) -> Result<Vec<(String, std::time::SystemTime)>> {
    let needle = normalize_project_dir(&worktree_path.replace('/', "-"));

    let mut dir_listing = match tokio::fs::read_dir(projects_dir).await {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };

    // Collect matching project directories (encoding drifts across Claude
    // versions, so compare normalized names rather than requiring equality).
    let mut matching_dirs = Vec::new();
    while let Some(entry) = dir_listing.next_entry().await? {
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else { continue };
        if normalize_project_dir(name_str) == needle {
            matching_dirs.push(entry.path());
        }
    }

    let mut sessions = Vec::new();
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
            let Some(uuid) = path.file_stem().and_then(|s| s.to_str()) else { continue };
            sessions.push((uuid.to_string(), mtime));
        }
    }
    Ok(sessions)
}

/// Resolve `~/.claude/projects` and scan it for `worktree_path`'s sessions.
async fn scan_sessions(worktree_path: &str) -> Result<Vec<(String, std::time::SystemTime)>> {
    let home = std::env::var("HOME").map(std::path::PathBuf::from).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "could not determine home directory")
    })?;
    let projects_dir = home.join(".claude").join("projects");
    scan_sessions_in(&projects_dir, worktree_path).await
}

/// Pick the most-recently-modified session, skipping any UUID in `exclude`.
fn latest_session(
    sessions: Vec<(String, std::time::SystemTime)>,
    exclude: &[String],
) -> Option<String> {
    // HashSet lookup keeps this O(sessions) — the discovery loop calls it every
    // 5s with the full pre-spawn baseline, which can be large on worktrees that
    // accumulate many historical sessions.
    let excluded: std::collections::HashSet<&str> = exclude.iter().map(String::as_str).collect();
    sessions
        .into_iter()
        .filter(|(uuid, _)| !excluded.contains(uuid.as_str()))
        .max_by_key(|(_, mtime)| *mtime)
        .map(|(uuid, _)| uuid)
}

/// Find the most recent Claude Code session for a worktree, skipping any UUIDs
/// in `exclude_ids`.
///
/// Claude keys conversation logs (`~/.claude/projects/{project-dir}/{uuid}.jsonl`)
/// only by launch cwd. That one directory is shared by EVERY Claude that ever ran
/// at this path — other Alfredo tabs/worktrees at the same cwd, the user's own
/// terminals, and the pile a single worktree accumulates (`/code-review`,
/// `/open-pr`, restarts, `/clear` forks). Picking "newest mtime" blindly resolves
/// to the wrong conversation constantly (resuming a stale/foreign session and
/// stranding the user's real work). `exclude_ids` carries the sessions that
/// already existed when this tab spawned, so the discovery loop only adopts a
/// session born from this tab's own run rather than a sibling's.
#[tauri::command]
pub async fn find_claude_session(
    worktree_path: String,
    exclude_ids: Vec<String>,
) -> Result<Option<String>> {
    let sessions = scan_sessions(&worktree_path).await?;
    Ok(latest_session(sessions, &exclude_ids))
}

/// List every top-level session UUID for a worktree path (order unspecified).
/// Snapshotted at spawn time so the discovery loop can tell THIS tab's freshly
/// created session apart from the foreign/historical ones already on disk.
#[tauri::command]
pub async fn list_claude_sessions(worktree_path: String) -> Result<Vec<String>> {
    let sessions = scan_sessions(&worktree_path).await?;
    Ok(sessions.into_iter().map(|(uuid, _)| uuid).collect())
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

/// Path of the per-worktree resume-id sidecar — a small `{ tabId: sessionId }`
/// map persisted eagerly the moment discovery adopts a session, so a Force Quit
/// / crash (uncatchable SIGKILL) can't strand a freshly-discovered id between
/// the 30s blob autosaves. Lives beside the full session blob, sanitised the
/// same way so slashy branch names stay flat.
fn resume_sidecar_path(dir: &std::path::Path, worktree_id: &str) -> std::path::PathBuf {
    dir.join(format!("{}.resume.json", sanitise_id(worktree_id)))
}

/// Read the sidecar map, treating a missing or unparsable file as empty — a
/// stale/garbled sidecar must never block restore, which still has the session
/// blob's own resumeSessionId to fall back on.
async fn read_resume_map(
    path: &std::path::Path,
) -> Result<std::collections::HashMap<String, String>> {
    match tokio::fs::read_to_string(path).await {
        Ok(s) => Ok(serde_json::from_str(&s).unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            Ok(std::collections::HashMap::new())
        }
        Err(e) => Err(e.into()),
    }
}

/// Serializes sidecar writes. Discovery is per-*tab*, not global: every agent
/// tab in a worktree runs its own discovery loop, so two tabs adopting sessions
/// near-simultaneously (multi-tab restore, background open-issue + foreground
/// tab) can interleave the sidecar's read→insert→write and silently drop one
/// entry — which never self-heals, because discovery stops re-persisting once
/// its own id matches. Writes are tiny and rare, so one app-wide async mutex
/// (mirroring worktree.rs's PortConfigLock) is plenty.
#[derive(Default)]
pub struct ResumeSidecarLock(pub tokio::sync::Mutex<()>);

/// Upsert one tab's resume id in the sidecar under `dir`. Callers must hold
/// `ResumeSidecarLock` across this read-modify-write. `dir` must already exist.
async fn upsert_resume_id(
    dir: &std::path::Path,
    worktree_id: &str,
    tab_id: &str,
    session_id: &str,
) -> Result<()> {
    let path = resume_sidecar_path(dir, worktree_id);
    let mut map = read_resume_map(&path).await?;
    map.insert(tab_id.to_string(), session_id.to_string());
    let data = serde_json::to_string(&map)
        .map_err(|e| AppError::Config(format!("serialize resume sidecar: {e}")))?;
    // Write-temp-then-rename: this file exists to survive Force Quit / crash,
    // so a kill mid-write must not tear it and discard every tab's id.
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, data).await?;
    tokio::fs::rename(&tmp, &path).await?;
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

/// Eagerly persist one tab's freshly-discovered Claude session id to the
/// sidecar. Called by TerminalView's discovery loop the instant it adopts a
/// session — a tiny scoped write that survives Force Quit / crash, unlike the
/// 30s blob autosave and the (SIGKILL-skipped) onCloseRequested save.
#[tauri::command]
pub async fn record_resume_session_id(
    app: tauri::AppHandle,
    lock: tauri::State<'_, ResumeSidecarLock>,
    repo_path: String,
    worktree_id: String,
    tab_id: String,
    session_id: String,
) -> Result<()> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("no app data dir: {e}")))?;
    let _guard = lock.0.lock().await;
    ensure_sessions_dir(&app_data_dir, &repo_path).await?;
    let dir = sessions_dir(&app_data_dir, &repo_path);
    upsert_resume_id(&dir, &worktree_id, &tab_id, &session_id).await
}

/// Load the resume-id sidecar map (`{ tabId: sessionId }`) for a worktree.
/// Empty when no sidecar exists yet (e.g. first run after this feature, or a
/// worktree that never spawned an agent). Restore overlays these onto the
/// session blob's per-tab ids, which they always supersede in freshness.
#[tauri::command]
pub async fn load_resume_session_ids(
    app: tauri::AppHandle,
    repo_path: String,
    worktree_id: String,
) -> Result<std::collections::HashMap<String, String>> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("no app data dir: {e}")))?;
    let dir = sessions_dir(&app_data_dir, &repo_path);
    read_resume_map(&resume_sidecar_path(&dir, &worktree_id)).await
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
    screenshot: Option<String>,
}

/// Capture the full screen to `path` via macOS `screencapture`. This is the
/// only way to record the *garble itself*: the corruption lives in WebKit's
/// GPU-composited output, so `canvas.toDataURL()` (which reads the drawing
/// buffer) would miss exactly what we're hunting. Requires Screen Recording
/// permission — the first invocation prompts, and may yield a window-less
/// image until granted and the app is relaunched. Returns the path only when
/// a file was actually written.
#[cfg(target_os = "macos")]
async fn capture_screen(path: &std::path::Path) -> Option<String> {
    // `-x` suppresses the camera shutter sound.
    let status = tokio::process::Command::new("screencapture")
        .arg("-x")
        .arg(path)
        .status()
        .await;
    match status {
        Ok(s) if s.success() && path.exists() => Some(path.to_string_lossy().into_owned()),
        Ok(s) => {
            tracing::warn!("screencapture did not produce a file (exit: {s:?})");
            None
        }
        Err(e) => {
            tracing::warn!("screencapture failed to spawn: {e}");
            None
        }
    }
}

#[cfg(not(target_os = "macos"))]
async fn capture_screen(_path: &std::path::Path) -> Option<String> {
    None
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
    capture_screenshot: bool,
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

    // Sibling screenshot under the same stamp captures the on-screen garble
    // that the byte/serialized halves can't (renderer-state corruption).
    let screenshot_path = if capture_screenshot {
        let p = dir.join(format!("pty-dump-{stamp}-{safe_id}.png"));
        capture_screen(&p).await
    } else {
        None
    };

    Ok(PtyDumpPaths {
        raw: raw_path.to_string_lossy().into_owned(),
        serialized: serialized_path,
        screenshot: screenshot_path,
    })
}

#[tauri::command]
pub async fn delete_session_file(
    app: tauri::AppHandle,
    lock: tauri::State<'_, ResumeSidecarLock>,
    repo_path: String,
    worktree_id: String,
) -> Result<()> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Config(format!("no app data dir: {e}")))?;
    let safe_id = sanitise_id(&worktree_id);
    let dir = sessions_dir(&app_data_dir, &repo_path);
    // Drop the resume-id sidecar alongside the blob so a recreated worktree at
    // the same id never inherits a stale tab→session mapping. Hold the sidecar
    // lock so a discovery tick racing this delete can't recreate the file.
    let _guard = lock.0.lock().await;
    let _ = tokio::fs::remove_file(resume_sidecar_path(&dir, &worktree_id)).await;
    let path = dir.join(format!("{safe_id}.json"));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::{latest_session, read_resume_map, resume_sidecar_path, scan_sessions_in, upsert_resume_id};
    use std::time::{Duration, SystemTime};

    #[tokio::test]
    async fn resume_sidecar_missing_reads_empty() {
        let tmp = tempfile::tempdir().unwrap();
        let map = read_resume_map(&resume_sidecar_path(tmp.path(), "repo::branch"))
            .await
            .unwrap();
        assert!(map.is_empty());
    }

    #[tokio::test]
    async fn resume_sidecar_records_and_updates_per_tab() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        upsert_resume_id(dir, "repo::branch", "tab-1", "sess-A").await.unwrap();
        upsert_resume_id(dir, "repo::branch", "tab-2", "sess-B").await.unwrap();

        let map = read_resume_map(&resume_sidecar_path(dir, "repo::branch")).await.unwrap();
        assert_eq!(map.get("tab-1"), Some(&"sess-A".to_string()));
        assert_eq!(map.get("tab-2"), Some(&"sess-B".to_string()));

        // A later discovery for the same tab (e.g. /clear) overwrites only that tab.
        upsert_resume_id(dir, "repo::branch", "tab-1", "sess-A2").await.unwrap();
        let map = read_resume_map(&resume_sidecar_path(dir, "repo::branch")).await.unwrap();
        assert_eq!(map.get("tab-1"), Some(&"sess-A2".to_string()));
        assert_eq!(map.get("tab-2"), Some(&"sess-B".to_string()));
    }

    #[tokio::test]
    async fn resume_sidecar_filename_flattens_slashy_branches() {
        let tmp = tempfile::tempdir().unwrap();
        // worktree_id carrying a `/` (branch feat/x) must not create nested dirs.
        upsert_resume_id(tmp.path(), "repo::feat/x", "tab-1", "sess-A").await.unwrap();
        let path = resume_sidecar_path(tmp.path(), "repo::feat/x");
        assert!(path.file_name().unwrap().to_str().unwrap().ends_with(".resume.json"));
        assert!(!path.to_str().unwrap().contains("feat/x"));
        let map = read_resume_map(&path).await.unwrap();
        assert_eq!(map.get("tab-1"), Some(&"sess-A".to_string()));
    }

    /// Write `{uuid}.jsonl` into `dir` with an explicit mtime so ordering is
    /// deterministic (no sleeps).
    async fn write_session(dir: &std::path::Path, uuid: &str, modified: SystemTime) {
        let path = dir.join(format!("{uuid}.jsonl"));
        tokio::fs::write(&path, b"{}\n").await.unwrap();
        let f = std::fs::File::options().write(true).open(&path).unwrap();
        f.set_modified(modified).unwrap();
    }

    fn at(secs: u64) -> SystemTime {
        SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000 + secs)
    }

    #[tokio::test]
    async fn picks_newest_top_level_session() {
        let tmp = tempfile::tempdir().unwrap();
        let proj = tmp.path().join("-tmp-wt");
        tokio::fs::create_dir_all(&proj).await.unwrap();
        write_session(&proj, "old", at(0)).await;
        write_session(&proj, "new", at(10)).await;

        let sessions = scan_sessions_in(tmp.path(), "/tmp/wt").await.unwrap();
        assert_eq!(latest_session(sessions, &[]), Some("new".to_string()));
    }

    #[tokio::test]
    async fn exclude_skips_foreign_sessions() {
        let tmp = tempfile::tempdir().unwrap();
        let proj = tmp.path().join("-tmp-wt");
        tokio::fs::create_dir_all(&proj).await.unwrap();
        write_session(&proj, "mine", at(0)).await;
        // A foreign session (another tab/terminal) touched more recently.
        write_session(&proj, "foreign", at(10)).await;

        let sessions = scan_sessions_in(tmp.path(), "/tmp/wt").await.unwrap();
        // The bug: newest mtime is the foreign session.
        assert_eq!(latest_session(sessions.clone(), &[]), Some("foreign".to_string()));
        // The fix: excluding the pre-existing foreign session yields our own.
        assert_eq!(
            latest_session(sessions, &["foreign".to_string()]),
            Some("mine".to_string()),
        );
    }

    #[tokio::test]
    async fn ignores_subagent_transcripts_in_subdirs() {
        let tmp = tempfile::tempdir().unwrap();
        let proj = tmp.path().join("-tmp-wt");
        let subagents = proj.join("abc").join("subagents");
        tokio::fs::create_dir_all(&subagents).await.unwrap();
        write_session(&proj, "main", at(0)).await;
        // A subagent transcript with a much newer mtime must not be surfaced.
        write_session(&subagents, "subagent", at(99)).await;

        let sessions = scan_sessions_in(tmp.path(), "/tmp/wt").await.unwrap();
        assert_eq!(latest_session(sessions, &[]), Some("main".to_string()));
    }

    #[tokio::test]
    async fn no_matching_dir_yields_none() {
        let tmp = tempfile::tempdir().unwrap();
        let sessions = scan_sessions_in(tmp.path(), "/tmp/missing").await.unwrap();
        assert!(latest_session(sessions, &[]).is_none());
    }
}
