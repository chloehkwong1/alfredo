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
use crate::platform::augmented_path;
use crate::types::{AgentState, AgentType, AppError, PtyEvent, Session, SessionStatus};

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
    /// Filesystem path to the worktree — needed for hook cleanup on close.
    worktree_path: String,
    /// Set to true when the reader thread detects the child has exited.
    exited: Arc<Mutex<Option<i32>>>,
    /// Shared flag to signal the reader thread to stop.
    stop_flag: Arc<AtomicBool>,
    /// Shared signals for the agent detector in the reader thread.
    detector_signals: Arc<Mutex<DetectorSignals>>,
}

/// Configuration for spawning a new PTY session.
pub struct SpawnConfig {
    pub worktree_id: String,
    pub worktree_path: String,
    pub command: String,
    pub args: Vec<String>,
    pub agent_type: AgentType,
    pub state_server_port: Option<u16>,
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

    /// Generate a session ID that can be pre-registered with the state server
    /// before spawning, eliminating the race where hooks fire before the
    /// channel is registered.
    pub fn generate_session_id() -> String {
        Uuid::new_v4().to_string()
    }

    /// Spawn a new PTY session with a pre-generated session ID.
    /// `config.agent_type` seeds the detector so it can track state immediately
    /// without waiting for a shell launch pattern or startup banner.
    /// `config.state_server_port` is set as an env var so hooks can call back.
    pub fn spawn(
        &self,
        session_id: String,
        config: SpawnConfig,
        channel: Channel<PtyEvent>,
    ) -> Result<String, AppError> {
        let SpawnConfig {
            worktree_id,
            worktree_path,
            command,
            args,
            agent_type,
            state_server_port,
        } = config;

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

        // GUI apps on macOS don't inherit the user's shell PATH, so CLI tools
        // like `claude`, `codex`, `aider` won't be found. Use the same
        // augmented PATH that git/gh commands use.
        cmd.env("PATH", augmented_path());

        // Set env vars for hook callbacks and write hooks config
        if let Some(port) = state_server_port {
            let base_url = format!("http://127.0.0.1:{port}");
            cmd.env("ALFREDO_STATE_URL", &base_url);
            cmd.env("ALFREDO_SESSION_ID", &session_id);
            cmd.env("ALFREDO_WORKTREE_ID", &worktree_id);

            // Write agent-specific hooks config
            match agent_type {
                AgentType::ClaudeCode => {
                    if let Err(e) = write_hooks_config(&worktree_path, &base_url, &worktree_id) {
                        eprintln!("[pty] failed to write Claude hooks config: {e}");
                    }
                }
                AgentType::GeminiCli => {
                    if let Err(e) = write_gemini_hooks_config(&worktree_path) {
                        eprintln!("[pty] failed to write Gemini hooks config: {e}");
                    }
                }
                AgentType::Codex => {
                    if let Err(e) = write_codex_hooks_config(&worktree_path) {
                        eprintln!("[pty] failed to write Codex hooks config: {e}");
                    }
                }
                _ => {}
            }
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| AppError::Pty(format!("failed to spawn command: {e}")))?;

        // We no longer need the slave side after spawning.
        drop(pair.slave);
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

            // Notify the frontend that the agent is no longer running.
            // Sent as HookAgentState (authoritative) rather than AgentState
            // (detector) so it bypasses the detector filter when hooks are active.
            if let Err(e) = reader_channel.send(PtyEvent::HookAgentState(AgentState::NotRunning)) {
                eprintln!("[pty-reader {id}] channel send failed (NotRunning): {e}");
            }

            // Stop the heartbeat thread so the frontend sees channelAlive go stale.
            reader_stop_flag.store(true, Ordering::Relaxed);

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
            command,
            worktree_id,
            worktree_path,
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

        // Remove Alfredo hooks from the worktree's config files so
        // standalone agent sessions don't inherit stale hooks.
        if let Err(e) = remove_hooks_config(&session.worktree_path) {
            eprintln!("[alfredo] failed to clean claude hooks on close: {e}");
        }
        if let Err(e) = remove_gemini_hooks_config(&session.worktree_path) {
            eprintln!("[alfredo] failed to clean gemini hooks on close: {e}");
        }
        if let Err(e) = remove_codex_hooks_config(&session.worktree_path) {
            eprintln!("[alfredo] failed to clean codex hooks on close: {e}");
        }

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

    /// Remove Alfredo hooks from all active sessions' worktree directories.
    /// Called on app exit to ensure no stale hooks are left behind.
    pub fn cleanup_all_hooks(&self) {
        let sessions = match self.sessions.lock() {
            Ok(s) => s,
            Err(_) => return,
        };

        // Deduplicate paths — multiple sessions may share the same worktree.
        let paths: std::collections::HashSet<String> = sessions
            .values()
            .map(|s| s.worktree_path.clone())
            .collect();

        for path in paths {
            if let Err(e) = remove_hooks_config(&path) {
                eprintln!("[alfredo] failed to clean claude hooks for {path}: {e}");
            }
            if let Err(e) = remove_gemini_hooks_config(&path) {
                eprintln!("[alfredo] failed to clean gemini hooks for {path}: {e}");
            }
            if let Err(e) = remove_codex_hooks_config(&path) {
                eprintln!("[alfredo] failed to clean codex hooks for {path}: {e}");
            }
        }
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
    _base_url: &str,
    _worktree_id: &str,
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
    if !config.get("hooks").is_some_and(serde_json::Value::is_object) {
        config["hooks"] = serde_json::json!({});
    }
    let hooks = config["hooks"]
        .as_object_mut()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "hooks is not an object after guard"))?;

    // Build hook entries using command hooks with env var interpolation.
    // Each PTY process has ALFREDO_STATE_URL and ALFREDO_WORKTREE_ID set,
    // so the shell expands them correctly per-session — even when
    // settings.local.json is shared across git worktrees.
    let cmd = |state: &str| -> serde_json::Value {
        serde_json::json!({
            "hooks": [{
                "type": "command",
                "command": format!("if [ -n \"$ALFREDO_STATE_URL\" ]; then curl -s -o /dev/null -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/{state}\"; fi")
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
                "command": "if [ -n \"$ALFREDO_STATE_URL\" ]; then curl -s -o /dev/null -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/waitingForInput\"; fi"
            }]
        })),
        ("Notification", serde_json::json!({
            "matcher": "elicitation_dialog",
            "hooks": [{
                "type": "command",
                "command": "if [ -n \"$ALFREDO_STATE_URL\" ]; then curl -s -o /dev/null -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/waitingForInput\"; fi"
            }]
        })),
        ("Notification", serde_json::json!({
            "matcher": "idle_prompt",
            "hooks": [{
                "type": "command",
                "command": "if [ -n \"$ALFREDO_STATE_URL\" ]; then curl -s -o /dev/null -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/idle\"; fi"
            }]
        })),
        // PermissionRequest fires for ALL permission dialogs (file creation,
        // tool approval, settings changes). This is separate from
        // Notification(permission_prompt) and has broader coverage.
        ("PermissionRequest", serde_json::json!({
            "hooks": [{
                "type": "command",
                "command": "if [ -n \"$ALFREDO_STATE_URL\" ]; then curl -s -o /dev/null -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/waitingForInput\"; fi"
            }]
        })),
        // PostToolUseFailure with is_interrupt — fires when user interrupts a
        // running tool. Stop hooks do NOT fire on interrupts, so this is the
        // only hook signal. The grep checks for is_interrupt before signalling.
        ("PostToolUseFailure", serde_json::json!({
            "hooks": [{
                "type": "command",
                "command": "if [ -n \"$ALFREDO_STATE_URL\" ] && cat | grep -q '\"is_interrupt\".*true'; then curl -s -o /dev/null -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/waitingForInput\"; fi"
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

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&path, json)?;

    Ok(())
}

/// Remove Alfredo's hooks from `.claude/settings.local.json` in the given
/// worktree directory. Leaves user-defined hooks intact. If the hooks object
/// becomes empty after cleanup, removes it to keep the file tidy.
fn remove_hooks_config(worktree_path: &str) -> Result<(), std::io::Error> {
    let path = std::path::Path::new(worktree_path)
        .join(".claude")
        .join("settings.local.json");

    if !path.exists() {
        return Ok(());
    }

    let contents = std::fs::read_to_string(&path)?;
    let mut config: serde_json::Value =
        serde_json::from_str(&contents).unwrap_or_else(|_| serde_json::json!({}));

    let Some(hooks) = config.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return Ok(());
    };

    // Strip Alfredo entries from each hook array; collect empty keys.
    let mut empty_keys = Vec::new();
    for (key, value) in hooks.iter_mut() {
        if let Some(arr) = value.as_array_mut() {
            arr.retain(|item| !is_alfredo_hook_entry(item));
            if arr.is_empty() {
                empty_keys.push(key.clone());
            }
        }
    }
    for key in &empty_keys {
        hooks.remove(key);
    }

    // If hooks is now empty, remove the key entirely.
    if hooks.is_empty() {
        if let Some(obj) = config.as_object_mut() {
            obj.remove("hooks");
        }
    }

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&path, json)?;

    Ok(())
}

/// Remove Alfredo's hooks from `.gemini/settings.json` in the given worktree
/// directory. Leaves user-defined hooks intact.
fn remove_gemini_hooks_config(worktree_path: &str) -> Result<(), std::io::Error> {
    let path = std::path::Path::new(worktree_path)
        .join(".gemini")
        .join("settings.json");

    if !path.exists() {
        return Ok(());
    }

    let contents = std::fs::read_to_string(&path)?;
    let mut config: serde_json::Value =
        serde_json::from_str(&contents).unwrap_or_else(|_| serde_json::json!({}));

    let Some(hooks) = config.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return Ok(());
    };

    let mut empty_keys = Vec::new();
    for (key, value) in hooks.iter_mut() {
        if let Some(arr) = value.as_array_mut() {
            arr.retain(|item| !is_alfredo_hook_entry(item));
            if arr.is_empty() {
                empty_keys.push(key.clone());
            }
        }
    }
    for key in &empty_keys {
        hooks.remove(key);
    }

    if hooks.is_empty() {
        if let Some(obj) = config.as_object_mut() {
            obj.remove("hooks");
        }
    }

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&path, json)?;

    Ok(())
}

/// Remove Alfredo's hooks from `.codex/hooks.json` in the given worktree
/// directory. Leaves user-defined hooks intact.
fn remove_codex_hooks_config(worktree_path: &str) -> Result<(), std::io::Error> {
    let path = std::path::Path::new(worktree_path)
        .join(".codex")
        .join("hooks.json");

    if !path.exists() {
        return Ok(());
    }

    let contents = std::fs::read_to_string(&path)?;
    let mut config: serde_json::Value =
        serde_json::from_str(&contents).unwrap_or_else(|_| serde_json::json!({}));

    let Some(hooks) = config.get_mut("hooks").and_then(|h| h.as_object_mut()) else {
        return Ok(());
    };

    let mut empty_keys = Vec::new();
    for (key, value) in hooks.iter_mut() {
        if let Some(arr) = value.as_array_mut() {
            arr.retain(|item| !is_alfredo_hook_entry(item));
            if arr.is_empty() {
                empty_keys.push(key.clone());
            }
        }
    }
    for key in &empty_keys {
        hooks.remove(key);
    }

    if hooks.is_empty() {
        if let Some(obj) = config.as_object_mut() {
            obj.remove("hooks");
        }
    }

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&path, json)?;

    Ok(())
}

/// Write Alfredo state hooks to `.gemini/settings.json` in the worktree.
/// Gemini CLI hooks use stdin/stdout JSON protocol — the command drains
/// stdin, POSTs to the state server, and prints `{}` to stdout.
fn write_gemini_hooks_config(worktree_path: &str) -> Result<(), std::io::Error> {
    let gemini_dir = std::path::Path::new(worktree_path).join(".gemini");
    std::fs::create_dir_all(&gemini_dir)?;

    let path = gemini_dir.join("settings.json");

    let mut config: serde_json::Value = if path.exists() {
        let contents = std::fs::read_to_string(&path)?;
        serde_json::from_str(&contents).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if !config.get("hooks").is_some_and(serde_json::Value::is_object) {
        config["hooks"] = serde_json::json!({});
    }
    let hooks = config["hooks"]
        .as_object_mut()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "hooks is not an object"))?;

    // Gemini hooks: command receives JSON on stdin, must print JSON to stdout.
    // We drain stdin, curl the state server, and print {} (success, no modifications).
    let cmd = |state: &str| -> serde_json::Value {
        serde_json::json!({
            "hooks": [{
                "type": "command",
                "command": format!(
                    "cat > /dev/null; if [ -n \"$ALFREDO_STATE_URL\" ]; then curl -s -o /dev/null -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/{state}\"; fi; echo '{{}}'"
                )
            }]
        })
    };

    let alfredo_hooks: Vec<(&str, serde_json::Value)> = vec![
        ("SessionStart", cmd("idle")),
        ("BeforeAgent",  cmd("busy")),
        ("AfterAgent",   cmd("idle")),
        ("BeforeTool",   cmd("busy")),
        ("AfterTool",    cmd("busy")),
        ("SessionEnd",   cmd("notRunning")),
    ];

    for (hook_name, entry) in alfredo_hooks {
        let arr = hooks
            .entry(hook_name)
            .or_insert_with(|| serde_json::json!([]))
            .as_array_mut();

        if let Some(arr) = arr {
            arr.retain(|item| !is_alfredo_hook_entry(item));
            arr.push(entry);
        }
    }

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&path, json)?;

    Ok(())
}

/// Write Alfredo state hooks to `.codex/hooks.json` in the worktree.
/// Codex CLI hooks use the same stdin/stdout JSON protocol as Gemini.
fn write_codex_hooks_config(worktree_path: &str) -> Result<(), std::io::Error> {
    let codex_dir = std::path::Path::new(worktree_path).join(".codex");
    std::fs::create_dir_all(&codex_dir)?;

    let path = codex_dir.join("hooks.json");

    let mut config: serde_json::Value = if path.exists() {
        let contents = std::fs::read_to_string(&path)?;
        serde_json::from_str(&contents).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    if !config.get("hooks").is_some_and(serde_json::Value::is_object) {
        config["hooks"] = serde_json::json!({});
    }
    let hooks = config["hooks"]
        .as_object_mut()
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "hooks is not an object"))?;

    let cmd = |state: &str| -> serde_json::Value {
        serde_json::json!({
            "hooks": [{
                "type": "command",
                "command": format!(
                    "cat > /dev/null; if [ -n \"$ALFREDO_STATE_URL\" ]; then curl -s -o /dev/null -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/{state}\"; fi; echo '{{}}'"
                )
            }]
        })
    };

    let alfredo_hooks: Vec<(&str, serde_json::Value)> = vec![
        ("SessionStart",     cmd("idle")),
        ("UserPromptSubmit", cmd("busy")),
        ("PreToolUse",       cmd("busy")),
        ("Stop",             cmd("idle")),
    ];

    for (hook_name, entry) in alfredo_hooks {
        let arr = hooks
            .entry(hook_name)
            .or_insert_with(|| serde_json::json!([]))
            .as_array_mut();

        if let Some(arr) = arr {
            arr.retain(|item| !is_alfredo_hook_entry(item));
            arr.push(entry);
        }
    }

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&path, json)?;

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
#[allow(clippy::unwrap_used, clippy::expect_used)]
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

        let session_id = PtyManager::generate_session_id();
        let id = manager
            .spawn(
                session_id,
                SpawnConfig {
                    worktree_id: "test-worktree".to_string(),
                    worktree_path: "/tmp".to_string(),
                    command: "echo".to_string(),
                    args: vec!["hello".to_string()],
                    agent_type: AgentType::Unknown,
                    state_server_port: None,
                },
                channel,
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
