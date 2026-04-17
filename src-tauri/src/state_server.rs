use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{StatusCode, Uri};
use axum::routing::post;
use axum::Router;
use tokio::net::TcpListener;

use crate::sleep_inhibitor::SleepInhibitor;
use crate::types::{AgentState, HookPhase, NotifyReason, PtyEvent};
use tauri::ipc::Channel;

/// Inner state shared between the handle and the HTTP router.
#[derive(Clone, Default)]
struct ChannelRegistry {
    /// session_id → channel
    channels: HashMap<String, Channel<PtyEvent>>,
}

/// Shared state for the HTTP server.
/// Maps session IDs to their PtyEvent channels.
#[derive(Clone)]
pub struct StateServerHandle {
    /// The port the server is listening on.
    pub port: u16,
    /// Channel registry shared with the HTTP handler.
    registry: Arc<Mutex<ChannelRegistry>>,
}

/// Combined state passed to the axum router.
#[derive(Clone)]
struct RouterState {
    registry: Arc<Mutex<ChannelRegistry>>,
    sleep_inhibitor: Arc<SleepInhibitor>,
}

impl StateServerHandle {
    /// Register (or replace) a channel for a session so hooks can push state to it.
    /// Called on initial spawn AND on reattach after frontend reload.
    pub fn register_channel(
        &self,
        session_id: String,
        worktree_id: String,
        channel: Channel<PtyEvent>,
    ) {
        let Ok(mut reg) = self.registry.lock() else {
            eprintln!("[state-server] registry lock poisoned in register_channel");
            return;
        };
        eprintln!("[state-server] register session={session_id} worktree={worktree_id} (total={})", reg.channels.len() + 1);
        reg.channels.insert(session_id, channel);
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
        let Ok(mut reg) = self.registry.lock() else {
            eprintln!("[state-server] registry lock poisoned in unregister_channel");
            return;
        };
        eprintln!("[state-server] unregister session={session_id} worktree={worktree_id} (remaining={})", reg.channels.len().saturating_sub(1));
        reg.channels.remove(session_id);
    }
}

/// Start the state HTTP server on a random port.
/// Returns a handle containing the port and channel registry.
pub async fn start(
    sleep_inhibitor: Arc<SleepInhibitor>,
) -> Result<StateServerHandle, std::io::Error> {
    let registry = Arc::new(Mutex::new(ChannelRegistry::default()));

    let router_state = RouterState {
        registry: Arc::clone(&registry),
        sleep_inhibitor: Arc::clone(&sleep_inhibitor),
    };

    let app = Router::new()
        .route(
            "/agent-state/{*path}",
            post(handle_state_update),
        )
        .with_state(router_state);

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

fn parse_notify_reason(query: Option<&str>) -> NotifyReason {
    let value = query
        .into_iter()
        .flat_map(|q| q.split('&'))
        .find_map(|pair| pair.strip_prefix("notify="));
    match value {
        Some("finished") => NotifyReason::Finished,
        Some("error") => NotifyReason::Error,
        Some("input") => NotifyReason::Input,
        _ => NotifyReason::None,
    }
}

fn parse_phase(query: Option<&str>) -> HookPhase {
    let value = query
        .into_iter()
        .flat_map(|q| q.split('&'))
        .find_map(|pair| pair.strip_prefix("phase="));
    match value {
        Some("toolStart") => HookPhase::ToolStart,
        Some("toolEnd") => HookPhase::ToolEnd,
        Some("turnEnd") => HookPhase::TurnEnd,
        _ => HookPhase::None,
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

/// POST /agent-state/{session_id}/{worktree_id...}/{state}
///
/// Routes hook events to the specific session that originated them, preventing
/// stale hooks from a dying process from polluting a replacement session.
/// The worktree ID may contain slashes (e.g. "chloe/test-worktree"), so we
/// split: first segment is session_id, last segment is state, middle is
/// worktree_id.
async fn handle_state_update(
    State(router_state): State<RouterState>,
    uri: Uri,
) -> StatusCode {
    let path = uri.path();
    let rest = path.strip_prefix("/agent-state/").unwrap_or("");

    // Split: session_id / worktree_id (may contain slashes) / state
    let (session_id, remainder) = match rest.split_once('/') {
        Some((sid, rem)) => (sid, rem),
        None => return StatusCode::BAD_REQUEST,
    };
    let (_worktree_id, state_str) = match remainder.rsplit_once('/') {
        Some((wid, st)) => (wid, st),
        None => return StatusCode::BAD_REQUEST,
    };

    let state = match parse_state(state_str) {
        Some(s) => s,
        None => return StatusCode::BAD_REQUEST,
    };

    let notify = parse_notify_reason(uri.query());
    let phase = parse_phase(uri.query());

    // Update sleep inhibitor based on agent state
    router_state.sleep_inhibitor.update(session_id, &state);

    let Ok(reg) = router_state.registry.lock() else {
        eprintln!("[state-server] registry lock poisoned in handle_state_update");
        return StatusCode::INTERNAL_SERVER_ERROR;
    };
    // Deliver to the specific session only — not fan-out by worktree.
    // When a session is unregistered (tab closed), stale hooks are silently dropped.
    if let Some(channel) = reg.channels.get(session_id) {
        eprintln!(
            "[state-server] → {session_id} {state:?} phase={phase:?} notify={notify:?}"
        );
        if let Err(e) = channel.send(PtyEvent::HookAgentState { state, notify, phase }) {
            eprintln!(
                "[state-server] failed to send state to session {session_id}: {e}"
            );
        }
    } else {
        eprintln!(
            "[state-server] hook dropped: no channel for session {session_id} (state={state:?}, registered={})",
            reg.channels.len()
        );
    }
    StatusCode::OK
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    fn dummy_channel() -> Channel<PtyEvent> {
        Channel::new(|_| Ok(()))
    }

    #[test]
    fn register_and_unregister_channels() {
        let handle = StateServerHandle::new_for_test();

        handle.register_channel("s1".into(), "wt1".into(), dummy_channel());
        handle.register_channel("s2".into(), "wt2".into(), dummy_channel());

        {
            let reg = handle.registry.lock().unwrap();
            assert!(reg.channels.contains_key("s1"));
            assert!(reg.channels.contains_key("s2"));
        }

        handle.unregister_channel("s1", "wt1");

        {
            let reg = handle.registry.lock().unwrap();
            assert!(!reg.channels.contains_key("s1"));
            assert!(reg.channels.contains_key("s2"));
        }
    }
}
