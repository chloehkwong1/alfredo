use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{StatusCode, Uri};
use axum::routing::post;
use axum::Router;
use tokio::net::TcpListener;

use crate::types::{AgentState, PtyEvent};
use tauri::ipc::Channel;

/// Inner state shared between the handle and the HTTP router.
#[derive(Clone, Default)]
struct ChannelRegistry {
    /// session_id → channel
    channels: HashMap<String, Channel<PtyEvent>>,
    /// worktree_id → list of session_ids (fan-out)
    worktree_sessions: HashMap<String, Vec<String>>,
}

/// Shared state for the HTTP server.
/// Maps session IDs to their PtyEvent channels and provides fan-out by worktree.
#[derive(Clone)]
pub struct StateServerHandle {
    /// The port the server is listening on.
    pub port: u16,
    /// Channel registry shared with the HTTP handler.
    registry: Arc<Mutex<ChannelRegistry>>,
}

impl StateServerHandle {
    /// Register a channel for a session so hooks can push state to it.
    pub fn register_channel(
        &self,
        session_id: String,
        worktree_id: String,
        channel: Channel<PtyEvent>,
    ) {
        let mut reg = self.registry.lock().expect("state server registry lock poisoned");
        reg.channels.insert(session_id.clone(), channel);
        reg.worktree_sessions
            .entry(worktree_id)
            .or_default()
            .push(session_id);
    }

    /// Create a handle with an empty registry (for testing).
    #[cfg(test)]
    pub fn new_for_test() -> Self {
        Self {
            port: 0,
            registry: Arc::new(Mutex::new(ChannelRegistry::default())),
        }
    }

    /// Remove a channel when a session is closed.
    pub fn unregister_channel(&self, session_id: &str, worktree_id: &str) {
        let mut reg = self.registry.lock().expect("state server registry lock poisoned");
        reg.channels.remove(session_id);
        if let Some(ids) = reg.worktree_sessions.get_mut(worktree_id) {
            ids.retain(|id| id != session_id);
            if ids.is_empty() {
                reg.worktree_sessions.remove(worktree_id);
            }
        }
    }
}

/// Start the state HTTP server on a random port.
/// Returns a handle containing the port and channel registry.
pub async fn start() -> Result<StateServerHandle, std::io::Error> {
    let registry = Arc::new(Mutex::new(ChannelRegistry::default()));

    let app = Router::new()
        .route(
            "/agent-state/{*path}",
            post(handle_state_update),
        )
        .with_state(Arc::clone(&registry));

    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[state-server] server error: {e}");
        }
    });

    Ok(StateServerHandle {
        port,
        registry,
    })
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
    State(registry): State<Arc<Mutex<ChannelRegistry>>>,
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

    let reg = registry.lock().expect("registry lock poisoned");
    if let Some(session_ids) = reg.worktree_sessions.get(worktree_id) {
        for session_id in session_ids {
            if let Some(channel) = reg.channels.get(session_id) {
                if let Err(e) = channel.send(PtyEvent::HookAgentState(state.clone())) {
                    eprintln!(
                        "[state-server] failed to send state to session {session_id}: {e}"
                    );
                }
            }
        }
    }
    // No channels registered — session(s) may have closed. Not an error.
    StatusCode::OK
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_channel() -> Channel<PtyEvent> {
        Channel::new(|_| Ok(()))
    }

    #[test]
    fn fan_out_sends_to_all_sessions_for_worktree() {
        let handle = StateServerHandle::new_for_test();

        let ch1 = dummy_channel();
        let ch2 = dummy_channel();
        handle.register_channel("s1".into(), "wt1".into(), ch1);
        handle.register_channel("s2".into(), "wt1".into(), ch2);

        let reg = handle.registry.lock().unwrap();
        let ids = reg.worktree_sessions.get("wt1").unwrap();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"s1".to_string()));
        assert!(ids.contains(&"s2".to_string()));
        assert!(reg.channels.contains_key("s1"));
        assert!(reg.channels.contains_key("s2"));
    }

    #[test]
    fn unregister_removes_session_and_cleans_up_empty_worktree() {
        let handle = StateServerHandle::new_for_test();

        handle.register_channel("s1".into(), "wt1".into(), dummy_channel());
        handle.register_channel("s2".into(), "wt1".into(), dummy_channel());

        // Remove one session — worktree entry should still exist
        handle.unregister_channel("s1", "wt1");
        {
            let reg = handle.registry.lock().unwrap();
            assert!(!reg.channels.contains_key("s1"));
            let ids = reg.worktree_sessions.get("wt1").unwrap();
            assert_eq!(ids, &vec!["s2".to_string()]);
        }

        // Remove last session — worktree entry should be cleaned up
        handle.unregister_channel("s2", "wt1");
        {
            let reg = handle.registry.lock().unwrap();
            assert!(!reg.channels.contains_key("s2"));
            assert!(!reg.worktree_sessions.contains_key("wt1"));
        }
    }

    #[test]
    fn separate_worktrees_are_independent() {
        let handle = StateServerHandle::new_for_test();

        handle.register_channel("s1".into(), "wt1".into(), dummy_channel());
        handle.register_channel("s2".into(), "wt2".into(), dummy_channel());

        handle.unregister_channel("s1", "wt1");

        let reg = handle.registry.lock().unwrap();
        assert!(!reg.worktree_sessions.contains_key("wt1"));
        assert!(reg.worktree_sessions.contains_key("wt2"));
        assert!(reg.channels.contains_key("s2"));
    }
}
