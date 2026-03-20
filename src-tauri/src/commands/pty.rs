use crate::pty_manager::PtyManager;
use crate::state_server::StateServerHandle;
use crate::types::{AgentType, AppError, PtyEvent, Session};
use tauri::ipc::Channel;
use tauri::State;

type Result<T> = std::result::Result<T, AppError>;

/// Spawn a new PTY session in the given worktree directory.
/// Returns the session ID. Output streams back via the `on_data` Channel.
/// `agent_type` tells the detector what agent is running so it can track
/// state immediately without relying on banner/launch detection.
#[tauri::command]
pub async fn spawn_pty(
    manager: State<'_, PtyManager>,
    state_server: State<'_, StateServerHandle>,
    worktree_id: String,
    worktree_path: String,
    command: String,
    args: Vec<String>,
    on_data: Channel<PtyEvent>,
    agent_type: Option<AgentType>,
) -> Result<String> {
    // Register this session's channel with the state server so hooks can push state
    state_server.register_channel(worktree_id.clone(), on_data.clone());

    manager.spawn(
        worktree_id,
        worktree_path,
        command,
        args,
        on_data,
        agent_type.unwrap_or(AgentType::Unknown),
        Some(state_server.port),
    )
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
