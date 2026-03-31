use crate::types::AppError;
use std::path::Path;

type Result<T> = std::result::Result<T, AppError>;

/// Find the most recent Claude Code session for a given worktree path.
///
/// Claude Code stores conversation logs at `~/.claude/projects/{project-dir}/{uuid}.jsonl`
/// where `project-dir` is the worktree's absolute path with `/` replaced by `-`.
/// Returns the UUID (filename stem) of the `.jsonl` file with the latest mtime, or None.
#[tauri::command]
pub async fn find_claude_session(worktree_path: String) -> Result<Option<String>> {
    let project_dir_name = worktree_path.replace('/', "-");
    let home = std::env::var("HOME").map(std::path::PathBuf::from).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::NotFound, "could not determine home directory")
    })?;
    let sessions_dir = home
        .join(".claude")
        .join("projects")
        .join(&project_dir_name);

    let mut read_dir = match tokio::fs::read_dir(&sessions_dir).await {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.into()),
    };

    let mut best: Option<(String, std::time::SystemTime)> = None;

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

    Ok(best.map(|(uuid, _)| uuid))
}

/// Sanitise a worktree ID for use as a flat filename.
/// Branch names may contain `/` (e.g. `feat/foo`), which would create nested
/// directories if used directly.  Replace `/` with `--` so the session file
/// stays in `.alfredo/sessions/`.
fn sanitise_id(worktree_id: &str) -> String {
    worktree_id.replace('/', "--")
}

async fn ensure_sessions_dir(repo_path: &str) -> Result<()> {
    let dir = Path::new(repo_path).join(".alfredo/sessions");
    tokio::fs::create_dir_all(&dir).await?;
    Ok(())
}

#[tauri::command]
pub async fn save_session_file(repo_path: String, worktree_id: String, data: String) -> Result<()> {
    ensure_sessions_dir(&repo_path).await?;
    let safe_id = sanitise_id(&worktree_id);
    let path = Path::new(&repo_path).join(format!(".alfredo/sessions/{safe_id}.json"));
    tokio::fs::write(&path, data).await?;
    Ok(())
}

#[tauri::command]
pub async fn load_session_file(repo_path: String, worktree_id: String) -> Result<Option<String>> {
    let safe_id = sanitise_id(&worktree_id);
    let path = Path::new(&repo_path).join(format!(".alfredo/sessions/{safe_id}.json"));
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn delete_session_file(repo_path: String, worktree_id: String) -> Result<()> {
    let safe_id = sanitise_id(&worktree_id);
    let path = Path::new(&repo_path).join(format!(".alfredo/sessions/{safe_id}.json"));
    match tokio::fs::remove_file(&path).await {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn ensure_alfredo_gitignore(repo_path: String) -> Result<()> {
    let gitignore_path = Path::new(&repo_path).join(".gitignore");
    let content = tokio::fs::read_to_string(&gitignore_path).await.unwrap_or_default();
    if !content.lines().any(|line| line.trim() == ".alfredo/" || line.trim() == ".alfredo") {
        let entry = if content.ends_with('\n') || content.is_empty() {
            ".alfredo/\n"
        } else {
            "\n.alfredo/\n"
        };
        tokio::fs::write(&gitignore_path, format!("{content}{entry}")).await?;
    }
    Ok(())
}
