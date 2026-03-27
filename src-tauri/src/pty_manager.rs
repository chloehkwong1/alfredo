use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use uuid::Uuid;

use crate::agent_detector::AgentDetector;
use crate::types::{AgentType, AppError, PtyEvent, Session, SessionStatus};

/// Shared timestamps for signalling resize/input events to the reader thread's
/// agent detector. The main thread writes; the reader thread reads.
struct DetectorSignals {
    last_resize: Option<Instant>,
    last_input: Option<Instant>,
}

/// Metadata tracked per PTY session.
struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    command: String,
    worktree_id: String,
    worktree_path: String,
    /// Set to true when the reader thread detects the child has exited.
    exited: Arc<Mutex<Option<i32>>>,
    /// Shared flag to signal the reader thread to stop.
    stop_flag: Arc<AtomicBool>,
    /// Shared signals for the agent detector in the reader thread.
    detector_signals: Arc<Mutex<DetectorSignals>>,
}

/// Manages all PTY sessions. Stored as Tauri managed state.
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Spawn a new PTY session, returning its UUID.
    /// `agent_type` seeds the detector so it can track state immediately
    /// without waiting for a shell launch pattern or startup banner.
    /// `state_server_port` is set as an env var so hooks can call back.
    pub fn spawn(
        &self,
        worktree_id: String,
        worktree_path: String,
        command: String,
        args: Vec<String>,
        channel: Channel<PtyEvent>,
        agent_type: AgentType,
        state_server_port: Option<u16>,
    ) -> Result<String, AppError> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Pty(format!("failed to open PTY pair: {e}")))?;

        let mut cmd = CommandBuilder::new(&command);
        cmd.args(&args);
        cmd.cwd(&worktree_path);

        // Set env vars for hook callbacks and write hooks config
        if let Some(port) = state_server_port {
            let base_url = format!("http://127.0.0.1:{port}");
            cmd.env("ALFREDO_STATE_URL", &base_url);
            cmd.env("ALFREDO_WORKTREE_ID", &worktree_id);

            // Write .claude/settings.local.json with hook config
            if let Err(e) = write_hooks_config(&worktree_path, &base_url, &worktree_id) {
                eprintln!("[alfredo] failed to write hooks config: {e}");
                // Non-fatal — agent detection falls back to PTY output parsing
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Pty(format!("failed to spawn command: {e}")))?;

        // We no longer need the slave side after spawning.
        drop(pair.slave);

        let session_id = Uuid::new_v4().to_string();
        let exited: Arc<Mutex<Option<i32>>> = Arc::new(Mutex::new(None));
        let detector_signals = Arc::new(Mutex::new(DetectorSignals {
            last_resize: None,
            last_input: None,
        }));

        let stop_flag = Arc::new(AtomicBool::new(false));

        // Wrap channel in Arc so it can be shared between reader and heartbeat threads.
        let arc_channel = Arc::new(channel);

        // --- reader thread ---
        let reader_session_id = session_id.clone();
        let reader_exited = Arc::clone(&exited);
        let reader_signals = Arc::clone(&detector_signals);
        let reader_stop_flag = Arc::clone(&stop_flag);
        let reader_channel = Arc::clone(&arc_channel);
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Pty(format!("failed to clone PTY reader: {e}")))?;

        thread::spawn(move || {
            let id = &reader_session_id;
            let mut buf = [0u8; 4096];
            let mut detector = AgentDetector::with_agent_type(agent_type);
            eprintln!("[pty-reader {id}] started");
            loop {
                if reader_stop_flag.load(Ordering::Relaxed) {
                    eprintln!("[pty-reader {id}] stop flag set, exiting");
                    break;
                }

                match reader.read(&mut buf) {
                    Ok(0) => {
                        eprintln!("[pty-reader {id}] EOF — child closed PTY");
                        break;
                    }
                    Ok(n) => {
                        let data = buf[..n].to_vec();

                        // Propagate resize/input timestamps to the detector
                        if let Ok(signals) = reader_signals.lock() {
                            if let Some(ts) = signals.last_resize {
                                detector.notify_resize_at(ts);
                            }
                            if let Some(ts) = signals.last_input {
                                detector.notify_input_at(ts);
                            }
                        }

                        // Run output through agent detector before forwarding
                        if let Some((_agent_type, agent_state)) = detector.feed(&data) {
                            // State changed — notify frontend
                            if let Err(err) = reader_channel.send(PtyEvent::AgentState(agent_state)) {
                                eprintln!("[pty-reader {id}] channel send failed (AgentState): {err}");
                            }
                        }

                        // On channel send failure, log but continue reading to
                        // keep the child process alive.
                        if let Err(err) = reader_channel.send(PtyEvent::Output(data)) {
                            eprintln!("[pty-reader {id}] channel send failed (Output): {err}");
                        }
                    }
                    Err(e) => {
                        if e.raw_os_error() == Some(libc::EIO) {
                            eprintln!("[pty-reader {id}] EIO — child exited");
                            break;
                        }
                        eprintln!("[pty-reader {id}] read error: {e}, stopping");
                        break;
                    }
                }
            }

            // Mark session as exited. We don't know the exit code from the
            // reader thread, so store a sentinel (-1). The real code is
            // available via `child.wait()` but we can't call that here without
            // the child handle. We'll reconcile when `list` or `close` is
            // called.
            if let Ok(mut guard) = reader_exited.lock() {
                *guard = Some(-1);
            }
        });

        // --- heartbeat thread ---
        let hb_channel = Arc::clone(&arc_channel);
        let hb_stop = Arc::clone(&stop_flag);
        let hb_session_id = session_id.clone();
        thread::spawn(move || {
            while !hb_stop.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_secs(2));
                if hb_stop.load(Ordering::Relaxed) {
                    break;
                }
                if hb_channel.send(PtyEvent::Heartbeat).is_err() {
                    eprintln!("[pty-heartbeat {hb_session_id}] channel send failed, exiting");
                    break;
                }
            }
        });

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Pty(format!("failed to take PTY writer: {e}")))?;

        let session = PtySession {
            master: pair.master,
            writer,
            child,
            command: command.clone(),
            worktree_id: worktree_id.clone(),
            worktree_path: worktree_path.clone(),
            exited,
            stop_flag,
            detector_signals,
        };

        self.sessions
            .lock()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?
            .insert(session_id.clone(), session);

        Ok(session_id)
    }

    /// Write raw bytes to the PTY master (i.e. send input to the child).
    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?;

        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| AppError::Pty(format!("session not found: {session_id}")))?;

        // Check if the session already exited.
        if session.exited.lock().map(|g| g.is_some()).unwrap_or(false) {
            return Err(AppError::Pty("session has exited".into()));
        }

        // Signal input to the agent detector for echo suppression
        if let Ok(mut signals) = session.detector_signals.lock() {
            signals.last_input = Some(Instant::now());
        }

        session
            .writer
            .write_all(data)
            .map_err(|e| AppError::Pty(format!("write failed: {e}")))?;

        Ok(())
    }

    /// Resize the PTY.
    pub fn resize(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), AppError> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?;

        let session = sessions
            .get(session_id)
            .ok_or_else(|| AppError::Pty(format!("session not found: {session_id}")))?;

        // Signal resize to the agent detector for grace period
        if let Ok(mut signals) = session.detector_signals.lock() {
            signals.last_resize = Some(Instant::now());
        }

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AppError::Pty(format!("resize failed: {e}")))?;

        Ok(())
    }

    /// Close and clean up a PTY session.
    /// Look up the worktree_id for a session.
    pub fn get_worktree_id(&self, session_id: &str) -> Result<String, AppError> {
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?;

        sessions
            .get(session_id)
            .map(|s| s.worktree_id.clone())
            .ok_or_else(|| AppError::Pty(format!("session not found: {session_id}")))
    }

    pub fn close(&self, session_id: &str) -> Result<(), AppError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?;

        let mut session = sessions
            .remove(session_id)
            .ok_or_else(|| AppError::Pty(format!("session not found: {session_id}")))?;

        // Signal the reader thread to stop before killing the child.
        session.stop_flag.store(true, Ordering::Relaxed);

        // Send SIGTERM to the entire process group so child processes (e.g. dev
        // servers launched inside the shell) are terminated too, not just the
        // shell. The shell called setsid() so its PID == PGID.
        let pid = session.child.process_id();
        if let Some(pid) = pid {
            unsafe {
                libc::kill(-(pid as i32), libc::SIGTERM);
            }
        } else {
            let _ = session.child.kill();
        }

        // Drop the PTY master fd immediately — this unblocks any reader thread
        // stuck in read() and signals hangup to the child.
        drop(session.master);

        // Reap the process tree in a background thread so we never block the
        // Tauri command thread (child.wait() can stall).
        thread::spawn(move || {
            if let Some(pid) = pid {
                thread::sleep(Duration::from_millis(200));
                // Force-kill any survivors.
                unsafe {
                    libc::kill(-(pid as i32), libc::SIGKILL);
                }
            }
            let _ = session.child.wait();
        });

        Ok(())
    }

    /// List all sessions with current status.
    pub fn list(&self) -> Result<Vec<Session>, AppError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?;

        let mut result = Vec::with_capacity(sessions.len());

        for (id, session) in sessions.iter_mut() {
            let status = if session.exited.lock().map(|g| g.is_some()).unwrap_or(false) {
                // Try to get the real exit code.
                match session.child.try_wait() {
                    Ok(Some(exit)) => {
                        SessionStatus::Exited(exit.exit_code() as i32)
                    }
                    _ => SessionStatus::Exited(-1),
                }
            } else {
                // Check if the child has exited since we last looked.
                match session.child.try_wait() {
                    Ok(Some(exit)) => {
                        let code = exit.exit_code() as i32;
                        if let Ok(mut g) = session.exited.lock() {
                            *g = Some(code);
                        }
                        SessionStatus::Exited(code)
                    }
                    _ => SessionStatus::Running,
                }
            };

            result.push(Session {
                id: id.clone(),
                worktree_id: session.worktree_id.clone(),
                command: session.command.clone(),
                status,
            });
        }

        Ok(result)
    }
}

/// Marker substring embedded in Alfredo hook URLs so we can identify and
/// replace our own hooks without disturbing user-defined ones.
const ALFREDO_HOOK_MARKER: &str = "/agent-state/";

/// Write Alfredo's hooks into `.claude/settings.local.json` in the worktree
/// directory. Merges with any existing content so user settings are preserved.
/// Stale Alfredo hooks (from previous sessions) are replaced, not accumulated.
fn write_hooks_config(
    worktree_path: &str,
    base_url: &str,
    worktree_id: &str,
) -> Result<(), std::io::Error> {
    let claude_dir = std::path::Path::new(worktree_path).join(".claude");
    std::fs::create_dir_all(&claude_dir)?;

    let path = claude_dir.join("settings.local.json");

    // Read existing config, or start with an empty object
    let mut config: serde_json::Value = if path.exists() {
        let contents = std::fs::read_to_string(&path)?;
        serde_json::from_str(&contents).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Ensure config.hooks exists as an object
    if !config.get("hooks").is_some_and(|h| h.is_object()) {
        config["hooks"] = serde_json::json!({});
    }
    let hooks = config["hooks"].as_object_mut().unwrap();

    // Build hook entries using command hooks with env var interpolation.
    // Each PTY process has ALFREDO_STATE_URL and ALFREDO_WORKTREE_ID set,
    // so the shell expands them correctly per-session — even when
    // settings.local.json is shared across git worktrees.
    let cmd = |state: &str| -> serde_json::Value {
        serde_json::json!({
            "hooks": [{
                "type": "command",
                "command": format!("curl -s -o /dev/null -X POST $ALFREDO_STATE_URL/agent-state/$ALFREDO_WORKTREE_ID/{state}")
            }]
        })
    };

    let alfredo_hooks: Vec<(&str, serde_json::Value)> = vec![
        ("SessionStart",    cmd("idle")),
        ("UserPromptSubmit", cmd("busy")),
        ("Stop",            cmd("idle")),
        ("PreToolUse",      cmd("busy")),
        ("Notification", serde_json::json!({
            "matcher": "permission_prompt",
            "hooks": [{
                "type": "command",
                "command": "curl -s -o /dev/null -X POST $ALFREDO_STATE_URL/agent-state/$ALFREDO_WORKTREE_ID/waitingForInput"
            }]
        })),
        ("SubagentStart",   cmd("busy")),
        ("SubagentStop",    cmd("busy")),
        ("PostToolUse",     cmd("busy")),
        ("TaskCreated",     cmd("busy")),
        ("TaskCompleted",   cmd("busy")),
        ("StopFailure",     cmd("idle")),
    ];

    for (hook_name, entry) in alfredo_hooks {
        let arr = hooks
            .entry(hook_name)
            .or_insert_with(|| serde_json::json!([]))
            .as_array_mut();

        if let Some(arr) = arr {
            // Remove any previous Alfredo entries (stale ports / worktree IDs)
            arr.retain(|item| !is_alfredo_hook_entry(item));
            // Append our fresh entry
            arr.push(entry);
        }
    }

    std::fs::write(&path, serde_json::to_string_pretty(&config).unwrap())?;

    Ok(())
}

/// Returns true if a hook entry was created by Alfredo.
/// Detects both old HTTP hooks (url contains marker) and new command hooks
/// (command contains $ALFREDO_STATE_URL).
fn is_alfredo_hook_entry(entry: &serde_json::Value) -> bool {
    if let Some(hooks) = entry.get("hooks").and_then(|h| h.as_array()) {
        hooks.iter().any(|h| {
            // Old-style HTTP hooks
            let is_http = h.get("url")
                .and_then(|u| u.as_str())
                .is_some_and(|u| u.contains(ALFREDO_HOOK_MARKER));
            // New-style command hooks
            let is_cmd = h.get("command")
                .and_then(|c| c.as_str())
                .is_some_and(|c| c.contains("$ALFREDO_STATE_URL"));
            is_http || is_cmd
        })
    } else {
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify that the manager can spawn, list, and close a simple session.
    #[test]
    fn spawn_list_close() {
        let manager = PtyManager::new();

        // Use a short-lived command.
        let call_count = Arc::new(Mutex::new(0u32));
        let call_count_clone = Arc::clone(&call_count);
        let channel = Channel::new(move |_body| {
            if let Ok(mut g) = call_count_clone.lock() {
                *g += 1;
            }
            Ok(())
        });

        let id = manager
            .spawn(
                "test-worktree".to_string(),
                "/tmp".to_string(),
                "echo".to_string(),
                vec!["hello".to_string()],
                channel,
                AgentType::Unknown,
                None,
            )
            .expect("spawn should succeed");

        // Give the reader thread a moment to read output.
        thread::sleep(std::time::Duration::from_millis(300));

        assert!(
            *call_count.lock().unwrap() > 0,
            "should have received at least one output event"
        );

        // List should show the session (may already be exited).
        let sessions = manager.list().expect("list should succeed");
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].id, id);

        // Close should succeed.
        manager.close(&id).expect("close should succeed");

        // List should be empty now.
        let sessions = manager.list().expect("list should succeed");
        assert_eq!(sessions.len(), 0);
    }

    /// Writing to a non-existent session returns an error.
    #[test]
    fn write_missing_session() {
        let manager = PtyManager::new();
        let result = manager.write("nonexistent", b"data");
        assert!(result.is_err());
    }

    /// Resizing a non-existent session returns an error.
    #[test]
    fn resize_missing_session() {
        let manager = PtyManager::new();
        let result = manager.resize("nonexistent", 24, 80);
        assert!(result.is_err());
    }

    /// Closing a non-existent session returns an error.
    #[test]
    fn close_missing_session() {
        let manager = PtyManager::new();
        let result = manager.close("nonexistent");
        assert!(result.is_err());
    }
}
