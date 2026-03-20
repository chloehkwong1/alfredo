use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

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
    worktree_path: String,
    /// Set to true when the reader thread detects the child has exited.
    exited: Arc<Mutex<Option<i32>>>,
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

        // --- reader thread ---
        let reader_session_id = session_id.clone();
        let reader_exited = Arc::clone(&exited);
        let reader_signals = Arc::clone(&detector_signals);
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Pty(format!("failed to clone PTY reader: {e}")))?;

        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut detector = AgentDetector::with_agent_type(agent_type);
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        // EOF – child closed its side.
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
                            let _ = channel.send(PtyEvent::AgentState(agent_state));
                        }

                        // If the channel send fails the frontend disconnected; stop reading.
                        if channel.send(PtyEvent::Output(data)).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        // On macOS an EIO means the child closed the PTY.
                        if e.raw_os_error() == Some(libc::EIO) {
                            break;
                        }
                        // Log but keep trying on transient errors.
                        eprintln!(
                            "[pty-reader {reader_session_id}] read error: {e}"
                        );
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

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| AppError::Pty(format!("failed to take PTY writer: {e}")))?;

        let session = PtySession {
            master: pair.master,
            writer,
            child,
            command: command.clone(),
            worktree_path: worktree_path.clone(),
            exited,
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
    pub fn close(&self, session_id: &str) -> Result<(), AppError> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?;

        let mut session = sessions
            .remove(session_id)
            .ok_or_else(|| AppError::Pty(format!("session not found: {session_id}")))?;

        // Kill the child if it's still running.
        let _ = session.child.kill();
        // Wait to reap zombie.
        let _ = session.child.wait();
        // Dropping the master will close the PTY fd, which unblocks the reader
        // thread if it's stuck in read().
        drop(session.master);

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
                worktree_id: session.worktree_path.clone(),
                command: session.command.clone(),
                status,
            });
        }

        Ok(result)
    }
}

/// Write `.claude/settings.local.json` into the worktree directory with hooks
/// that call back to Alfredo's state server on agent lifecycle events.
fn write_hooks_config(
    worktree_path: &str,
    base_url: &str,
    worktree_id: &str,
) -> Result<(), std::io::Error> {
    let claude_dir = std::path::Path::new(worktree_path).join(".claude");
    std::fs::create_dir_all(&claude_dir)?;

    let config = serde_json::json!({
        "hooks": {
            "SessionStart": [{
                "hooks": [{
                    "type": "http",
                    "url": format!("{base_url}/agent-state/{worktree_id}/idle")
                }]
            }],
            "UserPromptSubmit": [{
                "hooks": [{
                    "type": "http",
                    "url": format!("{base_url}/agent-state/{worktree_id}/busy")
                }]
            }],
            "Stop": [{
                "hooks": [{
                    "type": "http",
                    "url": format!("{base_url}/agent-state/{worktree_id}/idle")
                }]
            }],
            "Notification": [{
                "matcher": "permission_prompt",
                "hooks": [{
                    "type": "http",
                    "url": format!("{base_url}/agent-state/{worktree_id}/waitingForInput")
                }]
            }]
        }
    });

    let path = claude_dir.join("settings.local.json");
    std::fs::write(&path, serde_json::to_string_pretty(&config).unwrap())?;

    Ok(())
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
