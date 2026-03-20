use crate::pty_manager::PtyManager;
use crate::types::{AppError, PtyEvent, Session};
use tauri::ipc::Channel;
use tauri::State;

type Result<T> = std::result::Result<T, AppError>;

/// Spawn a new PTY session in the given worktree directory.
/// Returns the session ID. Output streams back via the `on_data` Channel.
#[tauri::command]
pub async fn spawn_pty(
    manager: State<'_, PtyManager>,
    worktree_path: String,
    command: String,
    args: Vec<String>,
    on_data: Channel<PtyEvent>,
) -> Result<String> {
    manager.spawn(worktree_path, command, args, on_data)
}

/// Write raw input bytes to a PTY session.
#[tauri::command]
pub async fn write_pty(manager: State<'_, PtyManager>, session_id: String, data: Vec<u8>) -> Result<()> {
    manager.write(&session_id, &data)
}

/// Resize a PTY session.
#[tauri::command]
pub async fn resize_pty(
    manager: State<'_, PtyManager>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<()> {
    manager.resize(&session_id, rows, cols)
}

/// Close a PTY session and kill the child process.
#[tauri::command]
pub async fn close_pty(manager: State<'_, PtyManager>, session_id: String) -> Result<()> {
    manager.close(&session_id)
}

/// List all active PTY sessions.
#[tauri::command]
pub async fn list_sessions(manager: State<'_, PtyManager>) -> Result<Vec<Session>> {
    manager.list()
}
