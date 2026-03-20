use crate::types::{AppError, PtyEvent, Session};
use tauri::ipc::Channel;

type Result<T> = std::result::Result<T, AppError>;

/// Spawn a new PTY session in the given worktree directory.
/// Returns the session ID. Output streams back via the `on_data` Channel.
#[tauri::command]
pub async fn spawn_pty(
    worktree_path: String,
    command: String,
    args: Vec<String>,
    on_data: Channel<PtyEvent>,
) -> Result<String> {
    let _ = (worktree_path, command, args, on_data);
    Err(AppError::Pty("not yet implemented".into()))
}

/// Write raw input bytes to a PTY session.
#[tauri::command]
pub async fn write_pty(session_id: String, data: Vec<u8>) -> Result<()> {
    let _ = (session_id, data);
    Err(AppError::Pty("not yet implemented".into()))
}

/// Resize a PTY session.
#[tauri::command]
pub async fn resize_pty(session_id: String, rows: u16, cols: u16) -> Result<()> {
    let _ = (session_id, rows, cols);
    Err(AppError::Pty("not yet implemented".into()))
}

/// Close a PTY session and kill the child process.
#[tauri::command]
pub async fn close_pty(session_id: String) -> Result<()> {
    let _ = session_id;
    Err(AppError::Pty("not yet implemented".into()))
}

/// List all active PTY sessions.
#[tauri::command]
pub async fn list_sessions() -> Result<Vec<Session>> {
    Err(AppError::Pty("not yet implemented".into()))
}
