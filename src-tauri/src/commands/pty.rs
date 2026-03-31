use crate::pty_manager::{PtyManager, SpawnConfig};
use crate::state_server::StateServerHandle;
use crate::types::{AgentType, AppError, PtyEvent, Session};
use tauri::ipc::Channel;
use tauri::State;

type Result<T> = std::result::Result<T, AppError>;

/// Spawn a new PTY session in the given worktree directory.
/// Returns the session ID. Output streams back via the `on_data` Channel.
/// `agent_type` tells the detector what agent is running so it can track
/// state immediately without relying on banner/launch detection.
///
/// `mode` determines the command to run: `"shell"` spawns the user's
/// default shell, `"claude"` spawns Claude Code, etc. The backend maps
/// mode to the actual binary — the frontend never specifies a raw command.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn spawn_pty(
    manager: State<'_, PtyManager>,
    state_server: State<'_, StateServerHandle>,
    worktree_id: String,
    worktree_path: String,
    mode: String,
    args: Vec<String>,
    on_data: Channel<PtyEvent>,
    agent_type: Option<AgentType>,
) -> Result<String> {
    let command = match mode.as_str() {
        "shell" => std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string()),
        "claude" => "claude".to_string(),
        "codex" => "codex".to_string(),
        "aider" => "aider".to_string(),
        _ => return Err(AppError::Pty(format!("unknown PTY mode: {mode}"))),
    };

    let session_id = PtyManager::generate_session_id();

    // Register the channel with the state server BEFORE spawning so that
    // early hook callbacks (e.g. SessionStart) are not silently dropped.
    state_server.register_channel(session_id.clone(), worktree_id.clone(), on_data.clone());

    let config = SpawnConfig {
        worktree_id: worktree_id.clone(),
        worktree_path,
        command,
        args,
        agent_type: agent_type.unwrap_or(AgentType::Unknown),
        state_server_port: Some(state_server.port),
    };

    match manager.spawn(session_id.clone(), config, on_data) {
        Ok(id) => Ok(id),
        Err(e) => {
            // Spawn failed — clean up the pre-registered channel
            state_server.unregister_channel(&session_id, &worktree_id);
            Err(e)
        }
    }
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
pub async fn close_pty(
    manager: State<'_, PtyManager>,
    state_server: State<'_, StateServerHandle>,
    session_id: String,
) -> Result<()> {
    // Look up worktree_id before closing so we can unregister the channel
    if let Ok(worktree_id) = manager.get_worktree_id(&session_id) {
        state_server.unregister_channel(&session_id, &worktree_id);
    }
    manager.close(&session_id)
}

/// List all active PTY sessions.
#[tauri::command]
pub async fn list_sessions(manager: State<'_, PtyManager>) -> Result<Vec<Session>> {
    manager.list()
}
