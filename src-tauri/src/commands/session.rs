use crate::types::AppError;
use std::path::Path;

type Result<T> = std::result::Result<T, AppError>;

async fn ensure_sessions_dir(repo_path: &str) -> Result<()> {
    let dir = Path::new(repo_path).join(".alfredo/sessions");
    tokio::fs::create_dir_all(&dir).await?;
    Ok(())
}

#[tauri::command]
pub async fn save_session_file(repo_path: String, worktree_id: String, data: String) -> Result<()> {
    ensure_sessions_dir(&repo_path).await?;
    let path = Path::new(&repo_path).join(format!(".alfredo/sessions/{worktree_id}.json"));
    tokio::fs::write(&path, data).await?;
    Ok(())
}

#[tauri::command]
pub async fn load_session_file(repo_path: String, worktree_id: String) -> Result<Option<String>> {
    let path = Path::new(&repo_path).join(format!(".alfredo/sessions/{worktree_id}.json"));
    match tokio::fs::read_to_string(&path).await {
        Ok(content) => Ok(Some(content)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

#[tauri::command]
pub async fn delete_session_file(repo_path: String, worktree_id: String) -> Result<()> {
    let path = Path::new(&repo_path).join(format!(".alfredo/sessions/{worktree_id}.json"));
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
