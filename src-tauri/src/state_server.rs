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

/// Per-session registration details.
struct SessionEntry {
    #[allow(dead_code)]
    worktree_id: String,
    channel: Channel<PtyEvent>,
    /// First hook-script ppid seen for this session. Subsequent hooks with a
    /// different ppid are dropped — this filters out hooks fired by child
    /// `claude -p` processes spawned by plugins (e.g. memsearch's summariser)
    /// that inherit $ALFREDO_STATE_URL and would otherwise mis-attribute
    /// phantom busy/idle transitions to the parent session.
    authoritative_ppid: Option<String>,
}

/// Inner state shared between the handle and the HTTP router.
#[derive(Default)]
struct ChannelRegistry {
    /// session_id → SessionEntry
    channels: HashMap<String, SessionEntry>,
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
    ///
    /// Replaces any existing entry for the same session_id. Sibling sessions on
    /// the same worktree (multi-tab) are left untouched.
    pub fn register_channel(
        &self,
        session_id: &str,
        worktree_id: &str,
        channel: Channel<PtyEvent>,
    ) {
        let Ok(mut reg) = self.registry.lock() else {
            tracing::info!("[state-server] registry lock poisoned in register_channel");
            return;
        };
        // Preserve authoritative_ppid across reattach (frontend reload calls
        // register again with a new Channel but the session is the same).
        let authoritative_ppid = reg
            .channels
            .get(session_id)
            .and_then(|e| e.authoritative_ppid.clone());
        reg.channels.insert(
            session_id.to_string(),
            SessionEntry {
                worktree_id: worktree_id.to_string(),
                channel,
                authoritative_ppid,
            },
        );
        tracing::info!(
            "[state-server] register session={session_id} worktree={worktree_id} (total={})",
            reg.channels.len()
        );
    }

    /// Create a handle with an empty registry (for testing).
    #[cfg(test)]
    pub fn new_for_test() -> Self {
        Self {
            port: 0,
            registry: Arc::new(Mutex::new(ChannelRegistry::default())),
        }
    }

    /// Bind the authoritative parent pid for a session to the known PTY child
    /// pid (the `claude` process Alfredo spawned). This makes the hppid gate
    /// deterministic instead of first-seen, eliminating the race where a
    /// plugin-spawned `claude -p` child could bind the session to itself if
    /// its hook fired before the parent's first hook.
    pub fn bind_authoritative_pid(&self, session_id: &str, child_pid: u32) {
        let Ok(mut reg) = self.registry.lock() else {
            tracing::info!("[state-server] registry lock poisoned in bind_authoritative_pid");
            return;
        };
        if let Some(entry) = reg.channels.get_mut(session_id) {
            entry.authoritative_ppid = Some(child_pid.to_string());
            tracing::info!("[state-server] bind session={session_id} authoritative_pid={child_pid} (from PTY child)");
        }
    }

    /// Remove a channel when a session is closed.
    pub fn unregister_channel(&self, session_id: &str, worktree_id: &str) {
        let Ok(mut reg) = self.registry.lock() else {
            tracing::info!("[state-server] registry lock poisoned in unregister_channel");
            return;
        };
        tracing::info!("[state-server] unregister session={session_id} worktree={worktree_id} (remaining={})", reg.channels.len().saturating_sub(1));
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
            tracing::info!("[state-server] server error: {e}");
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

fn parse_hppid(query: Option<&str>) -> Option<String> {
    query
        .into_iter()
        .flat_map(|q| q.split('&'))
        .find_map(|pair| pair.strip_prefix("hppid="))
        .filter(|v| !v.is_empty())
        .map(str::to_string)
}

fn parse_phase(query: Option<&str>) -> HookPhase {
    let value = query
        .into_iter()
        .flat_map(|q| q.split('&'))
        .find_map(|pair| pair.strip_prefix("phase="));
    match value {
        Some("promptStart") => HookPhase::PromptStart,
        Some("toolStart") => HookPhase::ToolStart,
        Some("toolEnd") => HookPhase::ToolEnd,
        Some("turnEnd") => HookPhase::TurnEnd,
        Some("subagentEnd") => HookPhase::SubagentEnd,
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
    let hppid = parse_hppid(uri.query());

    // Update sleep inhibitor based on agent state
    router_state.sleep_inhibitor.update(session_id, &state);

    let Ok(mut reg) = router_state.registry.lock() else {
        tracing::info!("[state-server] registry lock poisoned in handle_state_update");
        return StatusCode::INTERNAL_SERVER_ERROR;
    };
    // Deliver to the specific session only — not fan-out by worktree.
    // When a session is unregistered (tab closed), stale hooks are silently dropped.
    if let Some(entry) = reg.channels.get_mut(session_id) {
        // Authoritative-ppid gate: first hook whose hppid query param is set
        // binds the session to that ppid. Later hooks from a *different* ppid
        // (e.g. a child `claude -p` spawned by memsearch's Stop hook) are
        // dropped — they inherit $ALFREDO_STATE_URL but have a different
        // parent process. Hooks without hppid bypass the gate (backward-compat
        // during tab transition).
        match (&entry.authoritative_ppid, &hppid) {
            (None, Some(pp)) => {
                entry.authoritative_ppid = Some(pp.clone());
                tracing::info!("[state-server] bind session={session_id} hppid={pp}");
            }
            (Some(expected), Some(pp)) if expected != pp => {
                tracing::info!(
                    "[state-server] ⊘ drop foreign hook session={session_id} state={state:?} phase={phase:?} notify={notify:?} hppid={pp} (expected {expected})"
                );
                return StatusCode::OK;
            }
            _ => {}
        }
        let desc = format!(
            "{session_id} {state:?} phase={phase:?} notify={notify:?}"
        );
        let send_result = entry.channel.send(PtyEvent::HookAgentState { state, notify, phase });
        let registered = reg.channels.len();
        match send_result {
            Ok(()) => tracing::info!("[state-server] → {desc} (SEND OK, registered={registered})"),
            Err(e) => tracing::info!("[state-server] → {desc} (SEND ERR: {e}, registered={registered}) — channel is dead, hook lost"),
        }
    } else {
        let known: Vec<&String> = reg.channels.keys().collect();
        tracing::info!(
            "[state-server] hook dropped: no channel for session {session_id} (state={state:?}, registered={}, known={known:?})",
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

        handle.register_channel("s1", "wt1", dummy_channel());
        handle.register_channel("s2", "wt2", dummy_channel());

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

    /// Pins: when the PTY reader thread exits (EOF/error) it calls
    /// `unregister_channel`, which must drop the registry entry for that
    /// session so subsequent hook POSTs fall through to the "no channel"
    /// branch instead of fan-ing out to a dead `Channel`. This test is a
    /// direct proxy for the real reader-thread call site in pty_manager.rs.
    #[test]
    fn reader_exit_unregisters_state_server_channel() {
        let handle = StateServerHandle::new_for_test();
        handle.register_channel("s1", "wt1", dummy_channel());

        {
            let reg = handle.registry.lock().unwrap();
            assert!(reg.channels.contains_key("s1"));
        }

        // Simulate reader thread exit.
        handle.unregister_channel("s1", "wt1");

        let reg = handle.registry.lock().unwrap();
        assert!(!reg.channels.contains_key("s1"));
    }
}
