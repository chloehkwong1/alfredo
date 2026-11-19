use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::extract::State;
use axum::http::{StatusCode, Uri};
use axum::routing::post;
use axum::Router;
use tokio::net::TcpListener;

use crate::sleep_inhibitor::SleepInhibitor;
use crate::types::{AgentState, HookActivity, HookPhase, HookQuestion, NotifyReason, PtyEvent};
use tauri::ipc::Channel;

/// Per-session registration details.
struct SessionEntry {
    #[allow(dead_code)]
    worktree_id: String,
    channel: Channel<PtyEvent>,
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
    /// Shared with the HTTP handler so closing a session also releases its
    /// sleep-inhibitor hold.
    sleep_inhibitor: Arc<SleepInhibitor>,
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
        reg.channels.insert(
            session_id.to_string(),
            SessionEntry {
                worktree_id: worktree_id.to_string(),
                channel,
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
            sleep_inhibitor: Arc::new(SleepInhibitor::new()),
        }
    }

    /// Remove a channel when a session is closed.
    pub fn unregister_channel(&self, session_id: &str, worktree_id: &str) {
        {
            let Ok(mut reg) = self.registry.lock() else {
                tracing::info!("[state-server] registry lock poisoned in unregister_channel");
                return;
            };
            tracing::info!("[state-server] unregister session={session_id} worktree={worktree_id} (remaining={})", reg.channels.len().saturating_sub(1));
            reg.channels.remove(session_id);
        }
        // A session that is going away can no longer report Idle, so release
        // its sleep-inhibitor hold here — otherwise hibernating a busy tab
        // pins `caffeinate` for the rest of the app's lifetime.
        self.sleep_inhibitor.remove_session(session_id);
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
        sleep_inhibitor,
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
        Some("promptStart") => HookPhase::PromptStart,
        Some("toolStart") => HookPhase::ToolStart,
        Some("toolEnd") => HookPhase::ToolEnd,
        Some("turnEnd") => HookPhase::TurnEnd,
        Some("subagentStart") => HookPhase::SubagentStart,
        Some("subagentEnd") => HookPhase::SubagentEnd,
        Some("monitorStart") => HookPhase::MonitorStart,
        Some("questionEnd") => HookPhase::QuestionEnd,
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

/// Extracts the question the agent is parked on from a PreToolUse hook body.
/// AskUserQuestion yields its first question; ExitPlanMode a fixed label.
/// Anything else (empty, malformed, other tools, blank text) is `None`.
fn parse_hook_question(body: &[u8]) -> Option<HookQuestion> {
    let v: serde_json::Value = serde_json::from_slice(body).ok()?;
    match v.get("tool_name")?.as_str()? {
        "ExitPlanMode" => Some(HookQuestion { text: "Plan ready for review".to_string(), header: None }),
        "AskUserQuestion" => {
            let first = v.get("tool_input")?.get("questions")?.as_array()?.first()?;
            let text = first.get("question")?.as_str()?.trim();
            if text.is_empty() {
                return None;
            }
            let header = first
                .get("header")
                .and_then(|h| h.as_str())
                .map(str::trim)
                .filter(|h| !h.is_empty())
                .map(str::to_string);
            Some(HookQuestion { text: text.to_string(), header })
        }
        _ => None,
    }
}

#[derive(serde::Deserialize)]
struct HookBody {
    cwd: Option<String>,
    agent_id: Option<String>,
    tool_name: Option<String>,
    tool_input: Option<HookToolInput>,
}

#[derive(serde::Deserialize)]
struct HookToolInput {
    file_path: Option<String>,
    notebook_path: Option<String>,
}

/// Reads where a hook's tool call ran: the session `cwd`, the sub-agent id,
/// and the file a write tool targets. Typed structs let serde skip the rest of
/// a body that can be 64 KB. Empty strings count as absent; `None` when all
/// three are absent or the body is empty or broken.
fn parse_hook_activity(body: &[u8]) -> Option<HookActivity> {
    let parsed: HookBody = serde_json::from_slice(body).ok()?;
    let non_empty = |s: Option<String>| s.filter(|s| !s.is_empty());
    let is_write = matches!(
        parsed.tool_name.as_deref(),
        Some("Edit" | "Write" | "MultiEdit" | "NotebookEdit")
    );
    let write_path = if is_write {
        parsed.tool_input.and_then(|i| non_empty(i.file_path).or_else(|| non_empty(i.notebook_path)))
    } else {
        None
    };
    let activity = HookActivity {
        cwd: non_empty(parsed.cwd),
        write_path,
        agent_id: non_empty(parsed.agent_id),
    };
    (activity.cwd.is_some() || activity.write_path.is_some() || activity.agent_id.is_some()).then_some(activity)
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
    body: axum::body::Body,
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

    // Read the body before taking the registry lock (a std Mutex must not be
    // held across an .await). Oversized or broken bodies are `None`: the
    // status update is still delivered.
    let bytes = axum::body::to_bytes(body, 64 * 1024).await.ok();
    let question = if state == AgentState::WaitingForInput {
        bytes.as_deref().and_then(parse_hook_question)
    } else {
        None
    };
    let activity = bytes.as_deref().and_then(parse_hook_activity);

    let Ok(mut reg) = router_state.registry.lock() else {
        tracing::info!("[state-server] registry lock poisoned in handle_state_update");
        return StatusCode::INTERNAL_SERVER_ERROR;
    };
    // Deliver to the specific session only — not fan-out by worktree.
    // When a session is unregistered (tab closed), stale hooks are silently dropped.
    // Hooks spawned inside a nested `claude -p` (e.g. memsearch's Stop summariser)
    // are suppressed at the shell layer in pty_manager::write_hooks_config, so we
    // don't need to filter them here.
    if let Some(entry) = reg.channels.get_mut(session_id) {
        // Only a live session may arm the sleep inhibitor. A straggler from a
        // closed or hibernated tab has nothing left to release its hold.
        router_state.sleep_inhibitor.update(session_id, &state, &phase);
        let desc = format!(
            "{session_id} {state:?} phase={phase:?} notify={notify:?}"
        );
        let send_result = entry.channel.send(PtyEvent::HookAgentState { state, notify, phase, question, activity });
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

    /// Pins the hibernate/close leak: `unregister_channel` must also clear the
    /// session's entry in the sleep inhibitor. Observed in the wild — a tab
    /// hibernated while Busy unregistered its channel but stayed in
    /// `busy_sessions` forever, holding `caffeinate` for the app's lifetime.
    #[test]
    fn unregister_clears_sleep_inhibitor_busy_session() {
        let handle = StateServerHandle::new_for_test();
        handle.register_channel("s1", "wt1", dummy_channel());
        handle
            .sleep_inhibitor
            .update("s1", &AgentState::Busy, &HookPhase::ToolStart);
        assert!(handle.sleep_inhibitor.is_busy("s1"));

        // Tab is hibernated / closed.
        handle.unregister_channel("s1", "wt1");

        assert!(
            !handle.sleep_inhibitor.is_busy("s1"),
            "unregistering a session must release its sleep-inhibitor hold"
        );
    }

    /// Pins: a Busy hook for a session with no channel (a straggler from a
    /// closed or hibernated tab) must not arm the sleep inhibitor. The tab is
    /// gone, so nothing releases the hold short of the stale-busy TTL.
    #[tokio::test]
    async fn hook_for_unregistered_session_does_not_arm_sleep_inhibitor() {
        let handle = StateServerHandle::new_for_test();
        handle.register_channel("live", "wt1", dummy_channel());
        let router_state = RouterState {
            registry: Arc::clone(&handle.registry),
            sleep_inhibitor: Arc::clone(&handle.sleep_inhibitor),
        };

        for sid in ["live", "gone"] {
            let uri: Uri = format!("/agent-state/{sid}/wt1/busy?phase=toolStart").parse().unwrap();
            handle_state_update(State(router_state.clone()), uri, axum::body::Body::empty()).await;
        }

        assert!(handle.sleep_inhibitor.is_busy("live"));
        assert!(
            !handle.sleep_inhibitor.is_busy("gone"),
            "a hook for an unregistered session must not hold caffeinate"
        );
    }

    #[test]
    fn parse_hook_question_reads_first_question() {
        let body = br#"{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Which copy?","header":"Error copy"},{"question":"Second?","header":"B"}]}}"#;
        let q = parse_hook_question(body).unwrap();
        assert_eq!(q.text, "Which copy?");
        assert_eq!(q.header.as_deref(), Some("Error copy"));
    }

    #[test]
    fn parse_hook_question_exit_plan_mode() {
        let q = parse_hook_question(br#"{"tool_name":"ExitPlanMode","tool_input":{"plan":"..."}}"#).unwrap();
        assert_eq!(q.text, "Plan ready for review");
        assert_eq!(q.header, None);
    }

    #[test]
    fn parse_hook_question_rejects_other_input() {
        assert!(parse_hook_question(b"").is_none());
        assert!(parse_hook_question(b"not json").is_none());
        assert!(parse_hook_question(br#"{"tool_name":"Bash","tool_input":{"command":"ls"}}"#).is_none());
        assert!(parse_hook_question(br#"{"tool_name":"AskUserQuestion","tool_input":{"questions":[]}}"#).is_none());
        assert!(parse_hook_question(br#"{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"   "}]}}"#).is_none());
    }

    /// Posts a waitingForInput hook with `body` and returns the `question`
    /// carried by the event the session's channel received.
    async fn post_waiting_with_body(body: Vec<u8>) -> Option<HookQuestion> {
        post_with_body("waitingForInput", body).await
    }

    async fn post_with_body(state: &str, body: Vec<u8>) -> Option<HookQuestion> {
        let data = post_and_read_data(state, "notify=input&phase=toolStart", body).await;
        data.get("question").map(|q| HookQuestion {
            text: q["text"].as_str().unwrap().to_string(),
            header: q["header"].as_str().map(str::to_string),
        })
    }

    /// Posts a hook and returns the whole `data` object of the single event
    /// the session's channel received.
    async fn post_and_read_data(state: &str, query: &str, body: Vec<u8>) -> serde_json::Value {
        let handle = StateServerHandle::new_for_test();
        let seen: Arc<Mutex<Vec<serde_json::Value>>> = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        let channel = Channel::new(move |resp| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = resp {
                let v: serde_json::Value = serde_json::from_str(&json).unwrap();
                sink.lock().unwrap().push(v["data"].clone());
            }
            Ok(())
        });
        handle.register_channel("s1", "wt1", channel);
        let router_state = RouterState {
            registry: Arc::clone(&handle.registry),
            sleep_inhibitor: Arc::clone(&handle.sleep_inhibitor),
        };
        let uri: Uri = format!("/agent-state/s1/wt1/{state}?{query}").parse().unwrap();
        let status = handle_state_update(State(router_state), uri, axum::body::Body::from(body)).await;
        assert_eq!(status, StatusCode::OK);
        let events = seen.lock().unwrap();
        assert_eq!(events.len(), 1, "the status update must always be delivered");
        events[0].clone()
    }

    #[tokio::test]
    async fn handler_delivers_question_from_body() {
        let body = br#"{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Which copy?","header":"H"}]}}"#;
        let q = post_waiting_with_body(body.to_vec()).await.unwrap();
        assert_eq!(q.text, "Which copy?");
        assert_eq!(q.header.as_deref(), Some("H"));
    }

    #[tokio::test]
    async fn handler_ignores_question_body_for_busy_state() {
        let body = br#"{"tool_name":"AskUserQuestion","tool_input":{"questions":[{"question":"Which copy?","header":"H"}]}}"#;
        assert_eq!(post_with_body("busy", body.to_vec()).await, None);
    }

    #[tokio::test]
    async fn handler_without_body_still_delivers_status() {
        assert_eq!(post_waiting_with_body(Vec::new()).await, None);
    }

    #[tokio::test]
    async fn handler_with_oversized_body_still_delivers_status() {
        assert_eq!(post_waiting_with_body(vec![b'x'; 100 * 1024]).await, None);
    }

    #[test]
    fn parse_hook_activity_reads_cwd_agent_and_write_path() {
        let body = br#"{"session_id":"s","cwd":"/wt/b","agent_id":"a1","agent_type":"general-purpose","tool_name":"Edit","tool_input":{"file_path":"/wt/b/x.rs","old_string":"a"}}"#;
        assert_eq!(
            parse_hook_activity(body),
            Some(HookActivity { cwd: Some("/wt/b".into()), write_path: Some("/wt/b/x.rs".into()), agent_id: Some("a1".into()) })
        );
    }

    #[test]
    fn parse_hook_activity_ignores_read_paths() {
        let body = br#"{"cwd":"/wt/a","tool_name":"Read","tool_input":{"file_path":"/wt/b/x.rs"}}"#;
        assert_eq!(parse_hook_activity(body), Some(HookActivity { cwd: Some("/wt/a".into()), write_path: None, agent_id: None }));
    }

    #[test]
    fn parse_hook_activity_reads_write_and_notebook_targets() {
        let write = br#"{"cwd":"/wt/a","tool_name":"Write","tool_input":{"file_path":"/wt/b/n.txt","content":"x"}}"#;
        assert_eq!(parse_hook_activity(write).unwrap().write_path.as_deref(), Some("/wt/b/n.txt"));
        let nb = br#"{"cwd":"/wt/a","tool_name":"NotebookEdit","tool_input":{"notebook_path":"/wt/b/n.ipynb"}}"#;
        assert_eq!(parse_hook_activity(nb).unwrap().write_path.as_deref(), Some("/wt/b/n.ipynb"));
    }

    #[test]
    fn parse_hook_activity_rejects_empty_broken_and_placeless_bodies() {
        assert_eq!(parse_hook_activity(b""), None);
        assert_eq!(parse_hook_activity(br#"{"cwd":"/wt/a","tool_name":"Wri"#), None); // cut by the 65000-byte cap
        assert_eq!(parse_hook_activity(br#"{"hook_event_name":"Stop"}"#), None);
        assert_eq!(parse_hook_activity(br#"{"cwd":""}"#), None);
    }

    #[tokio::test]
    async fn handler_delivers_activity_for_busy_state() {
        let body = br#"{"cwd":"/wt/b","agent_id":"a1","tool_name":"Bash","tool_input":{"command":"ls"}}"#;
        let data = post_and_read_data("busy", "phase=toolStart", body.to_vec()).await;
        assert_eq!(data["activity"]["cwd"], "/wt/b");
        assert_eq!(data["activity"]["agentId"], "a1");
        assert!(data["activity"].get("writePath").is_none());
        assert!(data.get("question").is_none());
    }

    #[tokio::test]
    async fn handler_with_broken_body_delivers_status_without_activity() {
        for body in [vec![b'x'; 100 * 1024], br#"{"cwd":"/wt/a","tool_na"#.to_vec(), Vec::new()] {
            let data = post_and_read_data("busy", "phase=toolStart", body).await;
            assert_eq!(data["state"], "busy");
            assert!(data.get("activity").is_none());
        }
    }
}
