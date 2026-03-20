use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{StatusCode, Uri};
use axum::routing::post;
use axum::Router;
use tokio::net::TcpListener;

use crate::types::{AgentState, PtyEvent};
use tauri::ipc::Channel;

/// Shared state for the HTTP server.
/// Maps worktree IDs to their PtyEvent channels so we can push state changes.
#[derive(Clone)]
pub struct StateServerHandle {
    /// The port the server is listening on.
    pub port: u16,
    /// Map of worktree_id -> channel for forwarding state events.
    channels: Arc<Mutex<HashMap<String, Channel<PtyEvent>>>>,
}

impl StateServerHandle {
    /// Register a channel for a worktree so hooks can push state to it.
    pub fn register_channel(&self, worktree_id: String, channel: Channel<PtyEvent>) {
        self.channels
            .lock()
            .expect("state server channels lock poisoned")
            .insert(worktree_id, channel);
    }

    /// Remove a channel when a session is closed.
    pub fn unregister_channel(&self, worktree_id: &str) {
        self.channels
            .lock()
            .expect("state server channels lock poisoned")
            .remove(worktree_id);
    }
}

/// Start the state HTTP server on a random port.
/// Returns a handle containing the port and channel registry.
pub async fn start() -> StateServerHandle {
    let channels: Arc<Mutex<HashMap<String, Channel<PtyEvent>>>> =
        Arc::new(Mutex::new(HashMap::new()));

    let handle = StateServerHandle {
        port: 0, // filled after bind
        channels: Arc::clone(&channels),
    };

    let app = Router::new()
        .route(
            "/agent-state/{*path}",
            post(handle_state_update),
        )
        .with_state(Arc::clone(&channels));

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("failed to bind state server");

    let port = listener.local_addr().unwrap().port();

    tokio::spawn(async move {
        axum::serve(listener, app)
            .await
            .expect("state server crashed");
    });

    StateServerHandle {
        port,
        channels: handle.channels,
    }
}

/// Parse a state string from the URL path into an AgentState.
fn parse_state(s: &str) -> Option<AgentState> {
    match s {
        "busy" => Some(AgentState::Busy),
        "idle" => Some(AgentState::Idle),
        "waitingForInput" => Some(AgentState::WaitingForInput),
        "notRunning" => Some(AgentState::NotRunning),
        _ => None,
    }
}

/// POST /agent-state/{worktree_id...}/{state}
///
/// The worktree ID may contain slashes (e.g. "chloe/test-worktree"), so we
/// use a wildcard route and split: everything before the last `/` is the
/// worktree ID, the last segment is the state.
async fn handle_state_update(
    State(channels): State<Arc<Mutex<HashMap<String, Channel<PtyEvent>>>>>,
    uri: Uri,
) -> StatusCode {
    let path = uri.path();
    let rest = path.strip_prefix("/agent-state/").unwrap_or("");

    // Split off the last segment as the state
    let (worktree_id, state_str) = match rest.rsplit_once('/') {
        Some((id, st)) => (id, st),
        None => return StatusCode::BAD_REQUEST,
    };

    let state = match parse_state(state_str) {
        Some(s) => s,
        None => return StatusCode::BAD_REQUEST,
    };

    let channels = channels.lock().expect("channels lock poisoned");
    if let Some(channel) = channels.get(worktree_id) {
        let _ = channel.send(PtyEvent::HookAgentState(state));
        StatusCode::OK
    } else {
        // No channel registered — session may have closed. Not an error.
        StatusCode::OK
    }
}
