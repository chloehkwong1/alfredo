use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::Channel;
use uuid::Uuid;

use crate::agent_detector::AgentDetector;
use crate::platform::augmented_path;
use crate::sleep_inhibitor::SleepInhibitor;
use crate::state_server::StateServerHandle;
use crate::types::{AgentState, AgentType, AppError, HookPhase, NotifyReason, PtyEvent, Session, SessionStatus, SessionType};

/// Events emitted by the OSC scanner.
#[derive(Debug, Clone, PartialEq)]
pub enum OscEvent {
    /// OSC 0/1/2 title. `None` means empty title (revert to fallback).
    Title(Option<String>),
    /// OSC 7 working directory. `None` means failed to parse.
    Cwd(Option<String>),
}

/// Maximum bytes we'll buffer for a single OSC payload. Titles longer
/// than this are silently discarded to bound memory usage per session.
const OSC_MAX_PAYLOAD: usize = 256;

/// Byte-stream state machine that extracts OSC 0/1/2 title and OSC 7 CWD
/// sequences from PTY output. Tolerant of sequences split across chunks.
#[derive(Debug)]
pub struct OscScanner {
    state: OscState,
    /// Which OSC number we're collecting (0, 1, 2, or 7). `None` = ignore.
    kind: Option<u8>,
    /// Collected payload bytes for the current sequence.
    buf: Vec<u8>,
    /// Set when we've exceeded OSC_MAX_PAYLOAD; remain in Collecting until
    /// terminator, then discard.
    overflowed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum OscState {
    /// Normal byte stream.
    Idle,
    /// Saw ESC (0x1b) — waiting for `]`.
    EscSeen,
    /// Saw ESC ] — reading the numeric prefix.
    ReadingNumber,
    /// Inside the payload, collecting until terminator.
    Collecting,
    /// Saw ESC inside Collecting — waiting for `\` (ST terminator) or abort.
    CollectingEsc,
}

impl OscScanner {
    pub fn new() -> Self {
        Self {
            state: OscState::Idle,
            kind: None,
            buf: Vec::new(),
            overflowed: false,
        }
    }

    /// Feed a chunk of bytes. Any complete OSC events are appended to `out`.
    pub fn feed(&mut self, bytes: &[u8], out: &mut Vec<OscEvent>) {
        for &b in bytes {
            self.step(b, out);
        }
    }

    fn step(&mut self, b: u8, out: &mut Vec<OscEvent>) {
        match self.state {
            OscState::Idle => {
                if b == 0x1b {
                    self.state = OscState::EscSeen;
                }
            }
            OscState::EscSeen => {
                if b == b']' {
                    self.state = OscState::ReadingNumber;
                    self.kind = None;
                    self.buf.clear();
                    self.overflowed = false;
                } else {
                    // Not an OSC — ignore and reset.
                    self.state = OscState::Idle;
                }
            }
            OscState::ReadingNumber => {
                if b == b';' {
                    // Number terminated. If we don't care about this OSC, we
                    // still need to consume until terminator so we don't
                    // mis-parse the payload as subsequent bytes.
                    self.state = OscState::Collecting;
                } else if b.is_ascii_digit() {
                    let digit = b - b'0';
                    self.kind = Some(match self.kind {
                        Some(n) => n.saturating_mul(10).saturating_add(digit),
                        None => digit,
                    });
                } else {
                    // Malformed — reset.
                    self.state = OscState::Idle;
                    self.kind = None;
                }
            }
            OscState::Collecting => {
                match b {
                    0x07 => {
                        // BEL terminator.
                        self.emit(out);
                        self.state = OscState::Idle;
                    }
                    0x1b => {
                        self.state = OscState::CollectingEsc;
                    }
                    _ => {
                        if self.buf.len() >= OSC_MAX_PAYLOAD {
                            self.overflowed = true;
                        } else {
                            self.buf.push(b);
                        }
                    }
                }
            }
            OscState::CollectingEsc => {
                if b == b'\\' {
                    // ST terminator (ESC \).
                    self.emit(out);
                    self.state = OscState::Idle;
                } else {
                    // Not ST — abort this OSC, consume byte as normal.
                    self.state = OscState::Idle;
                    self.buf.clear();
                    self.kind = None;
                    self.overflowed = false;
                }
            }
        }
    }

    fn emit(&mut self, out: &mut Vec<OscEvent>) {
        if !self.overflowed {
            match self.kind {
                Some(0) | Some(1) | Some(2) => {
                    let title = String::from_utf8(std::mem::take(&mut self.buf))
                        .ok()
                        .filter(|s| !s.is_empty());
                    out.push(OscEvent::Title(title));
                }
                Some(7) => {
                    let raw = String::from_utf8(std::mem::take(&mut self.buf)).ok();
                    let cwd = raw.as_deref().and_then(parse_osc7_path);
                    out.push(OscEvent::Cwd(cwd));
                }
                _ => {}
            }
        }
        self.buf.clear();
        self.kind = None;
        self.overflowed = false;
    }
}

/// Extract the path from an OSC 7 payload like `file://host/Users/chloe/alfredo`.
/// Returns `None` if the payload doesn't parse.
fn parse_osc7_path(payload: &str) -> Option<String> {
    let rest = payload.strip_prefix("file://")?;
    // Skip the host component (everything up to the first '/').
    let slash = rest.find('/')?;
    Some(rest[slash..].to_string())
}

/// Swappable channel handle. `None` means the frontend disconnected (e.g. page reload).
type SwappableChannel = Arc<RwLock<Option<Channel<PtyEvent>>>>;

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
    session_type: SessionType,
    channel: SwappableChannel,
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
    /// Absolute path of the main repo checkout. Exposed to PTY children as
    /// `$ALFREDO_ROOT_PATH` so the configured run-script (which executes in
    /// a shell PTY) can reach files in the main checkout. `None` in tests.
    pub repo_path: Option<String>,
    pub command: String,
    pub args: Vec<String>,
    pub agent_type: AgentType,
    pub state_server_port: Option<u16>,
    pub session_type: SessionType,
    pub assigned_port: Option<u16>,
    /// Environment variable name for the port (defaults to "PORT").
    pub port_env_var: Option<String>,
    /// State server handle used to release the channel registration when the
    /// PTY reader thread exits (EOF/error). `None` in tests where no state
    /// server is running.
    pub state_server: Option<StateServerHandle>,
}

/// Manages all PTY sessions. Stored as Tauri managed state.
pub struct PtyManager {
    sessions: Arc<RwLock<HashMap<String, Arc<Mutex<PtySession>>>>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
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
    #[allow(clippy::needless_pass_by_value)]
    pub fn spawn(
        &self,
        session_id: String,
        config: SpawnConfig,
        channel: Channel<PtyEvent>,
        sleep_inhibitor: Arc<SleepInhibitor>,
    ) -> Result<String, AppError> {
        let SpawnConfig {
            worktree_id,
            worktree_path,
            repo_path,
            command,
            args,
            agent_type,
            state_server_port,
            session_type,
            assigned_port,
            port_env_var,
            state_server,
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

        // GUI apps also lack TERM/COLORTERM, so CLI tools (e.g. Claude Code)
        // fall back to basic colors. Set them explicitly for xterm.js.
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");

        // Mirror Conductor's `$CONDUCTOR_ROOT_PATH`: scripts running in the
        // PTY (notably the configured run-script, which spawns through a
        // shell PTY) need a reliable pointer back to the main checkout for
        // multi-repo setups that copy or symlink files from there.
        cmd.env("ALFREDO_WORKTREE_PATH", &worktree_path);
        if let Some(ref rp) = repo_path {
            cmd.env("ALFREDO_ROOT_PATH", rp);
        }

        // Inject assigned port so dev servers pick up the right port
        if let Some(port) = assigned_port {
            let env_name = port_env_var.as_deref().unwrap_or("PORT");
            cmd.env(env_name, port.to_string());
            cmd.env("ALFREDO_PORT", port.to_string());
        }

        // Capture before agent_type is moved into the reader thread closure
        // — used post-spawn to gate the protective sidecar write.
        let is_claude = matches!(agent_type, AgentType::ClaudeCode);

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

        // Wrap channel in Arc<RwLock<Option>> so it can be swapped on frontend reload.
        let arc_channel: SwappableChannel = Arc::new(RwLock::new(Some(channel)));

        // --- reader thread ---
        let reader_session_id = session_id.clone();
        let reader_worktree_id = worktree_id.clone();
        let reader_exited = Arc::clone(&exited);
        let reader_signals = Arc::clone(&detector_signals);
        let reader_stop_flag = Arc::clone(&stop_flag);
        let reader_channel = Arc::clone(&arc_channel);
        let reader_inhibitor = std::sync::Arc::clone(&sleep_inhibitor);
        let reader_state_server = state_server.clone();
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| AppError::Pty(format!("failed to clone PTY reader: {e}")))?;

        thread::spawn(move || {
            let id = &reader_session_id;
            let mut buf = [0u8; 4096];
            let mut detector = AgentDetector::with_agent_type(agent_type);
            let mut osc = OscScanner::new();
            let mut osc_events: Vec<OscEvent> = Vec::new();
            // Debounce title emissions: some agents update the title many times
            // per second. Only emit to the frontend if the title changed and at
            // least DEBOUNCE_MS has elapsed since the last emission, OR it's a
            // clear-to-None (those go through immediately so fallbacks can kick in).
            let mut last_title_sent: Option<Option<String>> = None;
            let mut last_title_sent_at: Option<Instant> = None;
            const DEBOUNCE_MS: u128 = 100;
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
                            reader_inhibitor.update(id, &agent_state);
                            if let Ok(guard) = reader_channel.read() {
                                if let Some(ch) = guard.as_ref() {
                                    if let Err(err) = ch.send(PtyEvent::AgentState(agent_state)) {
                                        eprintln!("[pty-reader {id}] channel send failed (AgentState): {err}");
                                    }
                                }
                            }
                        }

                        // Scan for OSC title/cwd sequences. Scanner has tiny
                        // overhead (byte-per-byte state machine, no allocs on
                        // the hot path for non-OSC bytes).
                        osc_events.clear();
                        osc.feed(&data, &mut osc_events);
                        for ev in osc_events.drain(..) {
                            match ev {
                                OscEvent::Title(title) => {
                                    let now = Instant::now();
                                    let changed = last_title_sent.as_ref() != Some(&title);
                                    let debounced = last_title_sent_at
                                        .map(|t| now.duration_since(t).as_millis() >= DEBOUNCE_MS)
                                        .unwrap_or(true);
                                    // Emit if the value changed AND either it's
                                    // a clear-to-None or enough time has passed.
                                    if changed && (title.is_none() || debounced) {
                                        if let Ok(guard) = reader_channel.read() {
                                            if let Some(ch) = guard.as_ref() {
                                                if let Err(e) = ch.send(PtyEvent::Title(title.clone())) {
                                                    eprintln!("[pty-reader {id}] channel send failed (Title): {e}");
                                                }
                                            }
                                        }
                                        last_title_sent = Some(title);
                                        last_title_sent_at = Some(now);
                                    }
                                }
                                OscEvent::Cwd(cwd) => {
                                    if let Ok(guard) = reader_channel.read() {
                                        if let Some(ch) = guard.as_ref() {
                                            if let Err(e) = ch.send(PtyEvent::Cwd(cwd)) {
                                                eprintln!("[pty-reader {id}] channel send failed (Cwd): {e}");
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        // On channel send failure, log but continue reading to
                        // keep the child process alive.
                        if let Ok(guard) = reader_channel.read() {
                            if let Some(ch) = guard.as_ref() {
                                if let Err(err) = ch.send(PtyEvent::Output(data)) {
                                    eprintln!("[pty-reader {id}] channel send failed (Output): {err}");
                                }
                            }
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
            if let Ok(guard) = reader_channel.read() {
                if let Some(ch) = guard.as_ref() {
                    if let Err(e) = ch.send(PtyEvent::HookAgentState {
                        state: AgentState::NotRunning,
                        notify: NotifyReason::None,
                        phase: HookPhase::None,
                    }) {
                        eprintln!("[pty-reader {id}] channel send failed (NotRunning): {e}");
                    }
                    // Clear title on exit so stale titles don't linger.
                    let _ = ch.send(PtyEvent::Title(None));
                }
            }

            reader_inhibitor.remove_session(id);
            reader_stop_flag.store(true, Ordering::Relaxed);

            if let Ok(mut guard) = reader_exited.lock() {
                *guard = Some(-1);
            }

            if let Some(handle) = reader_state_server.as_ref() {
                handle.unregister_channel(&reader_session_id, &reader_worktree_id);
                eprintln!("[pty-reader {reader_session_id}] exited, unregistered state_server channel");
            }

            // Remove the session's pid file (best-effort; stale files are harmless
            // because the pid they reference is gone from the host process table).
            let _ = std::fs::remove_file(format!("/tmp/alfredo-claude-{reader_session_id}.pid"));
            // Sidecar containing the canonical settings.local.json path —
            // consulted by cleanup_stale_hooks_in_paths / cleanup_all_hooks
            // to skip stripping hooks against this file while we're alive.
            let _ = std::fs::remove_file(format!("/tmp/alfredo-claude-{reader_session_id}.worktree"));
        });

        // Capture shell PID before `child` gets moved into PtySession — only
        // used by the poller thread for shell sessions.
        let shell_pid_opt = child.process_id();

        // Write the PTY child pid to a per-session file so hook scripts can
        // short-circuit their nested-claude ancestry walk: if walking upward
        // they reach this pid without first encountering a `claude -p`
        // ancestor, they know they're a legitimate main-session hook and can
        // skip the rest of the walk. Cleanup happens in the reader thread's
        // exit handler below.
        if let Some(pid) = shell_pid_opt {
            let pid_path = format!("/tmp/alfredo-claude-{session_id}.pid");
            if let Err(e) = std::fs::write(&pid_path, pid.to_string()) {
                eprintln!("[pty] failed to write pid file {pid_path}: {e}");
            }
            // Sidecar: canonical path of this session's claude settings file.
            // Read at boot/exit cleanup to avoid stripping hooks from a file
            // a still-live alfredo session is using (multi-instance + symlinked
            // settings.local.json case — see cleanup_stale_hooks_in_paths).
            // Only meaningful for sessions that wrote Claude hooks — gating by
            // agent_type+state_server_port mirrors the write_hooks_config call
            // above so we don't write protective sidecars for files we never
            // touched.
            if is_claude && state_server_port.is_some() {
                // Canonicalize the parent dir and append the filename rather
                // than canonicalizing the full path. write_hooks_config runs
                // synchronously before spawn so the file should exist, but if
                // its disk write was deferred or transiently failed, parent-dir
                // resolution still produces a usable canonical path. The dir
                // itself is created by write_hooks_config via create_dir_all.
                let claude_dir = std::path::Path::new(&worktree_path).join(".claude");
                if let Ok(canonical_dir) = std::fs::canonicalize(&claude_dir) {
                    let canonical = canonical_dir.join("settings.local.json");
                    let sidecar_path = format!("/tmp/alfredo-claude-{session_id}.worktree");
                    if let Err(e) = std::fs::write(&sidecar_path, canonical.to_string_lossy().as_ref()) {
                        eprintln!("[pty] failed to write worktree sidecar {sidecar_path}: {e}");
                    }
                }
            }
        }

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
                if let Ok(guard) = hb_channel.read() {
                    if let Some(ch) = guard.as_ref() {
                        if let Err(e) = ch.send(PtyEvent::Heartbeat) {
                            drop(guard);
                            // Channel invalidated — clear it so we skip until reattach
                            if let Ok(mut w) = hb_channel.write() {
                                *w = None;
                            }
                            eprintln!("[pty-heartbeat {hb_session_id}] channel invalidated ({e}), will skip until reattach — NOTE: state_server registry still holds its own copy of this channel and will continue delivering hooks to it until reattach_pty is called");
                        }
                    }
                    // None → frontend disconnected, skip silently
                }
            }
        });

        // --- process + cwd poller (shell sessions only) ---
        if session_type == SessionType::Shell {
            if let Some(shell_pid) = shell_pid_opt {
                let poll_channel = Arc::clone(&arc_channel);
                let poll_stop = Arc::clone(&stop_flag);
                let poll_session_id = session_id.clone();
                thread::spawn(move || {
                    let mut last_process: Option<Option<String>> = None;
                    let mut last_cwd: Option<Option<String>> = None;
                    // Short grace period so OSC 7 from a shell prompt has a
                    // chance to arrive before our first poll.
                    thread::sleep(Duration::from_millis(300));
                    while !poll_stop.load(Ordering::Relaxed) {
                        let process = resolve_foreground_process(shell_pid);
                        let cwd = resolve_cwd(shell_pid);

                        if last_process.as_ref() != Some(&process) {
                            if let Ok(guard) = poll_channel.read() {
                                if let Some(ch) = guard.as_ref() {
                                    if let Err(e) = ch.send(PtyEvent::Process(process.clone())) {
                                        eprintln!("[pty-poller {poll_session_id}] send failed (Process): {e}");
                                    }
                                }
                            }
                            last_process = Some(process);
                        }

                        if last_cwd.as_ref() != Some(&cwd) {
                            if let Ok(guard) = poll_channel.read() {
                                if let Some(ch) = guard.as_ref() {
                                    if let Err(e) = ch.send(PtyEvent::Cwd(cwd.clone())) {
                                        eprintln!("[pty-poller {poll_session_id}] send failed (Cwd): {e}");
                                    }
                                }
                            }
                            last_cwd = Some(cwd);
                        }

                        thread::sleep(Duration::from_secs(1));
                    }
                });
            }
        }

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
            session_type,
            channel: arc_channel,
            exited,
            stop_flag,
            detector_signals,
        };

        self.sessions
            .write()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?
            .insert(session_id.clone(), Arc::new(Mutex::new(session)));

        Ok(session_id)
    }

    /// Write raw bytes to the PTY master (i.e. send input to the child).
    pub fn write(&self, session_id: &str, data: &[u8]) -> Result<(), AppError> {
        let session_arc = {
            let sessions = self.sessions.read()
                .map_err(|_| AppError::Pty("session lock poisoned".into()))?;
            Arc::clone(
                sessions.get(session_id)
                    .ok_or_else(|| AppError::Pty(format!("session not found: {session_id}")))?,
            )
        };
        // Map lock dropped here

        let mut session = session_arc.lock()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?;

        if session.exited.lock().map(|g| g.is_some()).unwrap_or(false) {
            return Err(AppError::Pty("session has exited".into()));
        }

        if let Ok(mut signals) = session.detector_signals.lock() {
            signals.last_input = Some(Instant::now());
        }

        session.writer.write_all(data)
            .map_err(|e| AppError::Pty(format!("write failed: {e}")))?;

        Ok(())
    }

    /// Resize the PTY.
    pub fn resize(&self, session_id: &str, rows: u16, cols: u16) -> Result<(), AppError> {
        let session_arc = {
            let sessions = self.sessions.read()
                .map_err(|_| AppError::Pty("session lock poisoned".into()))?;
            Arc::clone(
                sessions.get(session_id)
                    .ok_or_else(|| AppError::Pty(format!("session not found: {session_id}")))?,
            )
        };

        let session = session_arc.lock()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?;

        if let Ok(mut signals) = session.detector_signals.lock() {
            signals.last_resize = Some(Instant::now());
        }

        session.master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .map_err(|e| AppError::Pty(format!("resize failed: {e}")))?;

        Ok(())
    }

    /// Look up the worktree_id for a session.
    pub fn get_worktree_id(&self, session_id: &str) -> Result<String, AppError> {
        let session_arc = {
            let sessions = self.sessions.read()
                .map_err(|_| AppError::Pty("session lock poisoned".into()))?;
            Arc::clone(
                sessions.get(session_id)
                    .ok_or_else(|| AppError::Pty(format!("session not found: {session_id}")))?,
            )
        };
        let session = session_arc.lock()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?;
        Ok(session.worktree_id.clone())
    }

    /// Replace the IPC channel for an existing session. Used when the frontend
    /// reloads and needs to reconnect to a still-alive PTY process.
    /// Returns the worktree_id so the caller can update the state server.
    pub fn reattach(
        &self,
        session_id: &str,
        new_channel: Channel<PtyEvent>,
    ) -> Result<String, AppError> {
        let session_arc = {
            let sessions = self.sessions.read()
                .map_err(|_| AppError::Pty("session lock poisoned".into()))?;
            Arc::clone(
                sessions.get(session_id)
                    .ok_or_else(|| AppError::Pty(format!("session not found: {session_id}")))?,
            )
        };

        let session = session_arc.lock()
            .map_err(|_| AppError::Pty("session lock poisoned".into()))?;

        // Reject reattach to an exited session
        if session.exited.lock().map(|g| g.is_some()).unwrap_or(false) {
            return Err(AppError::Pty("session has exited".into()));
        }

        // Swap in the new channel
        match session.channel.write() {
            Ok(mut guard) => *guard = Some(new_channel),
            Err(_) => return Err(AppError::Pty("channel lock poisoned".into())),
        }

        Ok(session.worktree_id.clone())
    }

    pub fn close(&self, session_id: &str) -> Result<(), AppError> {
        let session_arc = {
            let mut sessions = self.sessions.write()
                .map_err(|_| AppError::Pty("session lock poisoned".into()))?;
            sessions.remove(session_id)
                .ok_or_else(|| AppError::Pty(format!("session not found: {session_id}")))?
        };
        // Map lock dropped — other sessions unblocked immediately.

        // Unwrap the Arc. If other threads hold references, fall back to locking.
        let mut session = match Arc::try_unwrap(session_arc) {
            Ok(mutex) => mutex.into_inner().unwrap_or_else(std::sync::PoisonError::into_inner),
            Err(arc) => {
                // Another thread holds a reference to this session. We can't
                // take ownership (needed for drop(master) and child.wait()),
                // so do partial cleanup: hooks + SIGTERM. The reader thread
                // will see the stop flag and exit, which closes the remaining
                // resources when the last Arc drops.
                eprintln!("[pty] close: Arc still shared, doing partial teardown for {session_id}");
                let (stop_flag, pid) = {
                    let s = arc.lock().map_err(|_| AppError::Pty("session lock poisoned".into()))?;
                    (Arc::clone(&s.stop_flag), s.child.process_id())
                };
                // Session lock dropped here.

                // Hooks are intentionally NOT stripped here. Multiple sessions
                // in the same worktree share settings.local.json; stripping on
                // close would wipe hooks still needed by surviving sessions.
                // Cleanup runs on app exit via cleanup_all_hooks and on boot
                // via cleanup_stale_hooks_in_paths.
                stop_flag.store(true, Ordering::Relaxed);
                if let Some(pid) = pid {
                    unsafe { libc::kill(-(pid as i32), libc::SIGTERM); }
                }
                return Ok(());
            }
        };

        // Hooks are intentionally NOT stripped on close — see the partial-
        // teardown branch above for rationale.

        // Signal the reader thread to stop before killing the child.
        session.stop_flag.store(true, Ordering::Relaxed);

        // Send SIGTERM to the entire process group so child processes (e.g. dev
        // servers launched inside the shell) are terminated too, not just the
        // shell. The shell called setsid() so its PID == PGID.
        let pid = session.child.process_id();
        if let Some(pid) = pid {
            unsafe { libc::kill(-(pid as i32), libc::SIGTERM); }
        } else {
            let _ = session.child.kill();
        }

        // Drop the PTY master fd — this unblocks any reader thread stuck in
        // read() and signals hangup to the child.
        drop(session.master);

        // Reap the process tree in a background thread so we never block the
        // Tauri command thread (child.wait() can stall).
        thread::spawn(move || {
            if let Some(pid) = pid {
                thread::sleep(Duration::from_millis(200));
                // Force-kill any survivors.
                unsafe { libc::kill(-(pid as i32), libc::SIGKILL); }
            }
            let _ = session.child.wait();
        });

        Ok(())
    }

    /// Remove Alfredo hooks from all active sessions' worktree directories.
    /// Called on app exit to ensure no stale hooks are left behind.
    pub fn cleanup_all_hooks(&self) {
        let sessions = match self.sessions.read() {
            Ok(s) => s,
            Err(_) => return,
        };

        let paths: std::collections::HashSet<String> = sessions
            .values()
            .filter_map(|arc| arc.lock().ok().map(|s| s.worktree_path.clone()))
            .collect();

        drop(sessions);

        // Other alfredo instances may also have live sessions against
        // settings files we share via symlink. Skip stripping those even
        // on exit — our shutdown shouldn't break their hook channel.
        let protected = paths_with_active_alfredo_sessions_excluding(&self.own_session_ids());

        for path in paths {
            cleanup_hooks_for_path(&path, &protected, "exit");
        }
    }

    /// Remove stale Alfredo hooks left behind by a previous run that didn't
    /// shut down cleanly. Walks the given worktree paths and strips any
    /// Alfredo-written hook entries. User-defined hooks are left intact.
    /// Settings files whose pidfile sidecar resolves to an alive session
    /// (this manager's or any sibling alfredo instance's) are skipped —
    /// otherwise multi-instance + symlinked-settings setups silently
    /// lobotomise live hook channels at boot.
    pub fn cleanup_stale_hooks_in_paths(&self, paths: &[String]) {
        let protected = paths_with_active_alfredo_sessions_excluding(&self.own_session_ids());
        eprintln!(
            "[hooks] startup cleanup: {} path(s), {} protected",
            paths.len(),
            protected.len(),
        );
        for path in paths {
            cleanup_hooks_for_path(path, &protected, "startup-cleanup");
        }
    }

    /// Returns the session ids currently tracked by this manager. Used to
    /// exclude our own pidfiles from the "alive sibling" protected set —
    /// at exit cleanup we want our own files stripped, only neighbour
    /// alfredo instances' live hooks should be preserved.
    fn own_session_ids(&self) -> std::collections::HashSet<String> {
        match self.sessions.read() {
            Ok(s) => s.keys().cloned().collect(),
            Err(_) => std::collections::HashSet::new(),
        }
    }

    /// List all sessions with current status.
    pub fn list(&self) -> Result<Vec<Session>, AppError> {
        // Clone all Arcs while holding the read lock, then drop it so
        // per-session locks don't block close() from acquiring a write lock.
        let snapshot: Vec<(String, Arc<Mutex<PtySession>>)> = {
            let sessions = self.sessions.read()
                .map_err(|_| AppError::Pty("session lock poisoned".into()))?;
            sessions
                .iter()
                .map(|(id, arc)| (id.clone(), Arc::clone(arc)))
                .collect()
        };

        let mut result = Vec::with_capacity(snapshot.len());

        for (id, session_arc) in &snapshot {
            let mut session = session_arc.lock()
                .map_err(|_| AppError::Pty("session lock poisoned".into()))?;

            let status = if session.exited.lock().map(|g| g.is_some()).unwrap_or(false) {
                match session.child.try_wait() {
                    Ok(Some(exit)) => SessionStatus::Exited(exit.exit_code() as i32),
                    _ => SessionStatus::Exited(-1),
                }
            } else {
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
                session_type: session.session_type.clone(),
            });
        }

        Ok(result)
    }
}

/// Marker substring embedded in Alfredo hook URLs so we can identify and
/// replace our own hooks without disturbing user-defined ones.
const ALFREDO_HOOK_MARKER: &str = "/agent-state/";

/// Strip alfredo hooks from a worktree's claude/gemini/codex settings,
/// honouring the `protected` set: any hook file whose canonical path is
/// in the set is skipped because another alfredo session (this manager's
/// or a sibling instance's) is still live against it. `phase` is logged
/// so boot vs exit cleanup are distinguishable in alfredo.log.
fn cleanup_hooks_for_path(
    path: &str,
    protected: &std::collections::HashSet<std::path::PathBuf>,
    phase: &str,
) {
    let claude_settings = std::path::Path::new(path).join(".claude/settings.local.json");
    let claude_canonical = std::fs::canonicalize(&claude_settings).ok();
    let claude_protected = claude_canonical
        .as_ref()
        .is_some_and(|c| protected.contains(c));

    if claude_protected {
        eprintln!(
            "[hooks] {phase} skip claude hooks ← {} (alive alfredo session against this settings file)",
            claude_settings.display(),
        );
    } else if let Err(e) = remove_hooks_config(path) {
        eprintln!("[alfredo] {phase} claude hooks failed for {path}: {e}");
    }
    // Gemini and codex pidfile sidecars aren't tracked separately yet — the
    // observed bug is claude-only. Strip these unconditionally for now.
    if let Err(e) = remove_gemini_hooks_config(path) {
        eprintln!("[alfredo] {phase} gemini hooks failed for {path}: {e}");
    }
    if let Err(e) = remove_codex_hooks_config(path) {
        eprintln!("[alfredo] {phase} codex hooks failed for {path}: {e}");
    }
}

/// Scan `/tmp/alfredo-claude-*.pid` files. For each pid that is still alive,
/// read the matching `.worktree` sidecar containing the canonical path of
/// `.claude/settings.local.json` for that session, and return the set of
/// settings paths that should NOT be stripped. Sessions in `exclude_ids` are
/// skipped — used by `cleanup_all_hooks` so this manager's own sessions
/// (which are about to die anyway) don't protect themselves at exit.
fn paths_with_active_alfredo_sessions_excluding(
    exclude_ids: &std::collections::HashSet<String>,
) -> std::collections::HashSet<std::path::PathBuf> {
    let mut protected = std::collections::HashSet::new();
    let entries = match std::fs::read_dir("/tmp") {
        Ok(e) => e,
        Err(_) => return protected,
    };
    for entry in entries.flatten() {
        let entry_path = entry.path();
        let Some(name) = entry_path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(session_id) = name
            .strip_prefix("alfredo-claude-")
            .and_then(|s| s.strip_suffix(".pid"))
        else {
            continue;
        };
        if exclude_ids.contains(session_id) {
            continue;
        }
        let Ok(pid_str) = std::fs::read_to_string(&entry_path) else {
            continue;
        };
        let Ok(pid) = pid_str.trim().parse::<i32>() else {
            continue;
        };
        // kill(pid, 0) returns 0 iff the process exists and we may signal it.
        // The cross-user EPERM case (alive process, signal denied) is rare in
        // the personal-tool deployment and not worth dragging in errno
        // handling for — false-dead just means we strip a still-live session's
        // hooks, which is the pre-fix behaviour we're improving on, not new
        // breakage.
        if unsafe { libc::kill(pid, 0) } != 0 {
            continue;
        }
        // PID-reuse defense: PTY sessions always exec a shell as the child
        // (zsh/bash/fish via portable-pty), so a live pid that no longer
        // names a shell is almost certainly a recycled OS pid now owned by
        // some unrelated long-lived process. Without this check, a crashed
        // session whose pid is later reused by e.g. vscode or a daemon would
        // permanently over-protect its old settings file.
        if !is_alfredo_session_pid(pid) {
            continue;
        }
        let sidecar = format!("/tmp/alfredo-claude-{session_id}.worktree");
        let Ok(sidecar_contents) = std::fs::read_to_string(&sidecar) else {
            continue;
        };
        let trimmed = sidecar_contents.trim();
        if trimmed.is_empty() {
            continue;
        }
        protected.insert(std::path::PathBuf::from(trimmed));
    }
    protected
}

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
    eprintln!("[hooks] write claude hooks → {}", path.display());

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
    // Helper: build a hook entry with optional ?notify= query param.
    // `cat > /dev/null` drains stdin (hook context JSON) to prevent pipe
    // buffer deadlock when Claude Code sends large payloads (e.g. tool input).
    // On curl failure, log to /tmp/alfredo-hooks.log for debugging missed hooks.
    //
    // `alfredo_nested` walks up the process tree looking for a `claude -p` /
    // `claude --print` ancestor. Plugin-spawned headless claude invocations
    // (e.g. memsearch's Stop summariser) inherit $ALFREDO_STATE_URL /
    // $ALFREDO_SESSION_ID from the parent session, so without this gate their
    // own Busy/Stop hooks would flip the parent session's state. Self-
    // suppressing at the shell layer lets us keep the server-side dispatch
    // dumb (no ppid tracking required).
    // Pattern is constructed via printf so the function source itself doesn't
    // contain the literal "claude -p" / "claude --print" substring — otherwise
    // any shell ancestor that has our hook source in its argv (e.g. a wrapping
    // `sh -c "<hook body>"`) would falsely match against itself.
    //
    // `_own` reads this session's known-main-claude pid (written at PTY spawn).
    // When set, reaching that pid in the ancestry walk is a positive signal
    // we're a legitimate main-session hook — no nested claude was crossed, so
    // we can short-circuit without walking all the way to init. This cuts the
    // common-case hook overhead from ~10 ps calls to ~4-6.
    let nested_fn = r#"alfredo_nested(){ _pp=$(printf 'c%s' 'laude -p'); _pn=$(printf 'c%s' 'laude --print'); _own=$(cat "/tmp/alfredo-claude-$ALFREDO_SESSION_ID.pid" 2>/dev/null); _p=$$; for _ in 1 2 3 4 5 6 7 8 9 10; do _p=$(ps -o ppid= -p "$_p" 2>/dev/null | tr -d ' '); case "$_p" in ''|0|1) return 1;; esac; if [ -n "$_own" ] && [ "$_p" = "$_own" ]; then return 1; fi; _c=$(ps -ww -o command= -p "$_p" 2>/dev/null); case "$_c" in *"$_pp"*|*"$_pn"*) return 0;; esac; done; return 1; }"#;
    let cmd = |state: &str| -> String {
        format!(
            r#"cat > /dev/null; echo "$(date +%H:%M:%S) FIRE {state} session=$ALFREDO_SESSION_ID url=${{ALFREDO_STATE_URL:-UNSET}}" >> /tmp/alfredo-hooks.log; {nested_fn}; if alfredo_nested; then echo "$(date +%H:%M:%S) SUPPRESS nested {state} session=$ALFREDO_SESSION_ID" >> /tmp/alfredo-hooks.log; echo '{{}}'; exit 0; fi; if [ -n "$ALFREDO_STATE_URL" ]; then curl -sf --max-time 2 -o /dev/null -X POST "$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/{state}" || echo "$(date +%H:%M:%S) FAIL {state} session=$ALFREDO_SESSION_ID url=$ALFREDO_STATE_URL" >> /tmp/alfredo-hooks.log; fi; echo '{{}}'"#
        )
    };
    let cmd_phase = |state: &str, phase: &str| -> String {
        format!(
            r#"cat > /dev/null; echo "$(date +%H:%M:%S) FIRE {state}({phase}) session=$ALFREDO_SESSION_ID url=${{ALFREDO_STATE_URL:-UNSET}}" >> /tmp/alfredo-hooks.log; {nested_fn}; if alfredo_nested; then echo "$(date +%H:%M:%S) SUPPRESS nested {state} session=$ALFREDO_SESSION_ID" >> /tmp/alfredo-hooks.log; echo '{{}}'; exit 0; fi; if [ -n "$ALFREDO_STATE_URL" ]; then curl -sf --max-time 2 -o /dev/null -X POST "$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/{state}?phase={phase}" || echo "$(date +%H:%M:%S) FAIL {state}({phase}) session=$ALFREDO_SESSION_ID url=$ALFREDO_STATE_URL" >> /tmp/alfredo-hooks.log; fi; echo '{{}}'"#
        )
    };
    let cmd_notify = |state: &str, reason: &str| -> String {
        format!(
            r#"cat > /dev/null; echo "$(date +%H:%M:%S) FIRE {state} notify={reason} session=$ALFREDO_SESSION_ID url=${{ALFREDO_STATE_URL:-UNSET}}" >> /tmp/alfredo-hooks.log; {nested_fn}; if alfredo_nested; then echo "$(date +%H:%M:%S) SUPPRESS nested {state} session=$ALFREDO_SESSION_ID" >> /tmp/alfredo-hooks.log; echo '{{}}'; exit 0; fi; if [ -n "$ALFREDO_STATE_URL" ]; then curl -sf --max-time 2 -o /dev/null -X POST "$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/{state}?notify={reason}" || echo "$(date +%H:%M:%S) FAIL {state} notify={reason} session=$ALFREDO_SESSION_ID url=$ALFREDO_STATE_URL" >> /tmp/alfredo-hooks.log; fi; echo '{{}}'"#
        )
    };
    let cmd_notify_phase = |state: &str, reason: &str, phase: &str| -> String {
        format!(
            r#"cat > /dev/null; echo "$(date +%H:%M:%S) FIRE {state}({phase}) notify={reason} session=$ALFREDO_SESSION_ID url=${{ALFREDO_STATE_URL:-UNSET}}" >> /tmp/alfredo-hooks.log; {nested_fn}; if alfredo_nested; then echo "$(date +%H:%M:%S) SUPPRESS nested {state} session=$ALFREDO_SESSION_ID" >> /tmp/alfredo-hooks.log; echo '{{}}'; exit 0; fi; if [ -n "$ALFREDO_STATE_URL" ]; then curl -sf --max-time 2 -o /dev/null -X POST "$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/{state}?notify={reason}&phase={phase}" || echo "$(date +%H:%M:%S) FAIL {state}({phase}) notify={reason} session=$ALFREDO_SESSION_ID url=$ALFREDO_STATE_URL" >> /tmp/alfredo-hooks.log; fi; echo '{{}}'"#
        )
    };
    // PreToolUse fires for every tool. Most are work → busy?phase=toolStart.
    // `AskUserQuestion` is the exception: it blocks the agent waiting on the
    // user, but (unlike a permission prompt or MCP elicitation) it fires no
    // PermissionRequest/Notification hook of its own, so plain `busy` would
    // leave the sidebar showing "Editing…" the entire time the agent is parked
    // on a question. Branch on `tool_name` (read from the hook's stdin JSON,
    // same INPUT=$(cat) pattern as PostToolUseFailure) and route it to
    // waitingForInput + notify input. Both branches keep phase=toolStart so
    // workDepth still increments and stays balanced against the matching
    // PostToolUse(toolEnd) when the user answers.
    let cmd_pretooluse = || -> String {
        format!(
            r#"INPUT=$(cat); if printf '%s' "$INPUT" | grep -qE '"tool_name"[[:space:]]*:[[:space:]]*"AskUserQuestion"'; then ST=waitingForInput; Q='?notify=input&phase=toolStart'; LBL='waitingForInput(toolStart) notify=input'; else ST=busy; Q='?phase=toolStart'; LBL='busy(toolStart)'; fi; echo "$(date +%H:%M:%S) FIRE $LBL session=$ALFREDO_SESSION_ID url=${{ALFREDO_STATE_URL:-UNSET}}" >> /tmp/alfredo-hooks.log; {nested_fn}; if alfredo_nested; then echo "$(date +%H:%M:%S) SUPPRESS nested $ST session=$ALFREDO_SESSION_ID" >> /tmp/alfredo-hooks.log; echo '{{}}'; exit 0; fi; if [ -n "$ALFREDO_STATE_URL" ]; then curl -sf --max-time 2 -o /dev/null -X POST "$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/$ST$Q" || echo "$(date +%H:%M:%S) FAIL $LBL session=$ALFREDO_SESSION_ID url=$ALFREDO_STATE_URL" >> /tmp/alfredo-hooks.log; fi; echo '{{}}'"#
        )
    };

    let hook_entry = |command: String| -> serde_json::Value {
        serde_json::json!({
            "hooks": [{
                "type": "command",
                "command": command
            }]
        })
    };
    let hook_entry_with_matcher = |matcher: &str, command: String| -> serde_json::Value {
        serde_json::json!({
            "matcher": matcher,
            "hooks": [{
                "type": "command",
                "command": command
            }]
        })
    };

    let alfredo_hooks: Vec<(&str, serde_json::Value)> = vec![
        // SessionStart → idle (no notify)
        ("SessionStart",      hook_entry(cmd("idle"))),
        // UserPromptSubmit → busy + phase=promptStart
        ("UserPromptSubmit",  hook_entry(cmd_phase("busy", "promptStart"))),
        // PreToolUse → busy + phase=toolStart, except AskUserQuestion →
        // waitingForInput + notify input (see cmd_pretooluse).
        ("PreToolUse",        hook_entry(cmd_pretooluse())),
        // PostToolUse → busy + phase=toolEnd
        ("PostToolUse",       hook_entry(cmd_phase("busy", "toolEnd"))),
        // Stop → idle + notify finished + phase=turnEnd
        ("Stop",              hook_entry(cmd_notify_phase("idle", "finished", "turnEnd"))),
        // StopFailure → idle + notify error + phase=turnEnd
        ("StopFailure",       hook_entry(cmd_notify_phase("idle", "error", "turnEnd"))),
        // SubagentStart → busy + phase=subagentStart. Fires when the main agent
        // spawns a background/Task subagent. Without this, the main session fires
        // Stop (idle) the moment it dispatches and yields, so a worktree running
        // background investigation agents shows "Idle" until they finish. The
        // frontend counts subagentStart/subagentEnd into a subagentDepth and
        // suppresses the idle transition while > 0 (see sessionChannel.ts).
        ("SubagentStart",     hook_entry(cmd_phase("busy", "subagentStart"))),
        // SubagentStop → busy + phase=subagentEnd (distinct phase avoids bare-busy suppression)
        ("SubagentStop",      hook_entry(cmd_phase("busy", "subagentEnd"))),
        // PermissionRequest → waitingForInput + notify input
        ("PermissionRequest", hook_entry(cmd_notify("waitingForInput", "input"))),
        // PermissionDenied → busy + phase=toolEnd. Auto-mode-only hook: only fires
        // when the auto-mode classifier rejects a tool call (never on user-driven
        // Deny). The agent continues autonomously, so this is a tool-end, not a
        // request for user input. toolEnd phase decrements workDepth incremented
        // by the matching PreToolUse(toolStart).
        ("PermissionDenied",  hook_entry(cmd_phase("busy", "toolEnd"))),
        // Elicitation → waitingForInput + notify input
        ("Elicitation",       hook_entry(cmd_notify("waitingForInput", "input"))),
        // Notification matchers: idle_prompt, permission_prompt, elicitation_dialog
        ("Notification",      hook_entry_with_matcher("idle_prompt", cmd("idle"))),
        ("Notification",      hook_entry_with_matcher("permission_prompt", cmd_notify("waitingForInput", "input"))),
        ("Notification",      hook_entry_with_matcher("elicitation_dialog", cmd_notify("waitingForInput", "input"))),
        // PostToolUseFailure: interrupts → waitingForInput; non-interrupts → busy
        // (keeps hook silence timer fresh so detector fallback doesn't false-positive
        // during long thinking phases after tool failures)
        ("PostToolUseFailure", serde_json::json!({
            "hooks": [{
                "type": "command",
                "command": format!(
                    r#"INPUT=$(cat); echo "$(date +%H:%M:%S) FIRE postToolUseFailure session=$ALFREDO_SESSION_ID url=${{ALFREDO_STATE_URL:-UNSET}}" >> /tmp/alfredo-hooks.log; {nested_fn}; if alfredo_nested; then echo "$(date +%H:%M:%S) SUPPRESS nested postToolUseFailure session=$ALFREDO_SESSION_ID" >> /tmp/alfredo-hooks.log; echo '{{}}'; exit 0; fi; if [ -n "$ALFREDO_STATE_URL" ]; then if printf '%s' "$INPUT" | grep -q '"is_interrupt".*true'; then curl -s --max-time 2 -o /dev/null -X POST "$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/waitingForInput?phase=toolEnd"; else curl -s --max-time 2 -o /dev/null -X POST "$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/busy?phase=toolEnd"; fi; fi; echo '{{}}'"#
                )
            }]
        })),
    ];

    // First pass: strip stale Alfredo entries from every hook array we will touch,
    // so multiple new entries targeting the same hook name (e.g. Notification
    // matchers) don't clobber each other.
    let mut hook_names: Vec<&str> = alfredo_hooks.iter().map(|(n, _)| *n).collect();
    hook_names.sort();
    hook_names.dedup();
    for hook_name in hook_names {
        let arr = hooks
            .entry(hook_name)
            .or_insert_with(|| serde_json::json!([]))
            .as_array_mut();
        if let Some(arr) = arr {
            arr.retain(|item| !is_alfredo_hook_entry(item));
        }
    }

    // Second pass: append fresh entries.
    for (hook_name, entry) in alfredo_hooks {
        if let Some(arr) = hooks.get_mut(hook_name).and_then(|v| v.as_array_mut()) {
            arr.push(entry);
        }
    }

    let json = serde_json::to_string_pretty(&config)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(&path, json)?;

    Ok(())
}

/// Remove Alfredo's hooks from an agent config file in the given worktree
/// directory. `config_subpath` is the relative path from the worktree root
/// (e.g. `.claude/settings.local.json`). Leaves user-defined hooks intact.
/// If the hooks object becomes empty after cleanup, removes it to keep the
/// file tidy.
fn remove_agent_hooks_config(worktree_path: &str, config_subpath: &str) -> Result<(), std::io::Error> {
    let path = std::path::Path::new(worktree_path).join(config_subpath);

    if !path.exists() {
        return Ok(());
    }
    eprintln!("[hooks] strip alfredo hooks ← {}", path.display());

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

fn remove_hooks_config(worktree_path: &str) -> Result<(), std::io::Error> {
    remove_agent_hooks_config(worktree_path, ".claude/settings.local.json")
}

fn remove_gemini_hooks_config(worktree_path: &str) -> Result<(), std::io::Error> {
    remove_agent_hooks_config(worktree_path, ".gemini/settings.json")
}

fn remove_codex_hooks_config(worktree_path: &str) -> Result<(), std::io::Error> {
    remove_agent_hooks_config(worktree_path, ".codex/hooks.json")
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
                    "cat > /dev/null; if [ -n \"$ALFREDO_STATE_URL\" ]; then curl -s --max-time 2 -o /dev/null -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/{state}\"; fi; echo '{{}}'"
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
                    "cat > /dev/null; if [ -n \"$ALFREDO_STATE_URL\" ]; then curl -s --max-time 2 -o /dev/null -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/{state}\"; fi; echo '{{}}'"
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

/// Abbreviate an absolute path with `~` when under $HOME.
fn tilde_abbrev(path: &str) -> String {
    let Ok(home) = std::env::var("HOME") else {
        return path.to_string();
    };
    if path == home {
        return "~".to_string();
    }
    if let Some(rest) = path.strip_prefix(&format!("{home}/")) {
        return format!("~/{rest}");
    }
    path.to_string()
}

/// True if `comm` (the basename or path returned by `ps -o comm=`) looks
/// like a process alfredo would spawn as a PTY child. portable-pty execs
/// the configured command directly (no shell wrapper), so the child's
/// comm is either a shell (terminal tabs) or the agent binary itself
/// (`claude`, `codex`, `gemini`). Anything else is treated as a recycled
/// pid for the purposes of sidecar-based hook protection.
fn is_alfredo_session_comm(comm: &str) -> bool {
    if comm.is_empty() {
        return false;
    }
    if is_shell_process(comm) {
        return true;
    }
    let basename = std::path::Path::new(comm.trim_start_matches('-'))
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(comm);
    matches!(basename, "claude" | "codex" | "gemini")
}

/// True if `pid` is alive and looks like an alfredo PTY session's child.
/// Defends against PID reuse — see `is_alfredo_session_comm`.
fn is_alfredo_session_pid(pid: i32) -> bool {
    let Ok(out) = std::process::Command::new("ps")
        .args(["-o", "comm=", "-p", &pid.to_string()])
        .output()
    else {
        return false;
    };
    if !out.status.success() {
        return false;
    }
    let comm = std::str::from_utf8(&out.stdout).unwrap_or("").trim();
    is_alfredo_session_comm(comm)
}

/// True if the given `ps -o comm=` result is a shell itself (so we should
/// treat it as "no foreground process"). Handles login-shell prefix `-`
/// and absolute paths like `/bin/zsh`.
fn is_shell_process(comm: &str) -> bool {
    let trimmed = comm.trim_start_matches('-');
    let basename = std::path::Path::new(trimmed)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(trimmed);
    matches!(basename, "zsh" | "bash" | "fish" | "sh" | "dash" | "tcsh" | "ksh")
}

/// Resolve the foreground process command string for a shell session.
/// Returns `Some("npm run dev")` style strings; `None` when the shell is
/// its own foreground (idle at prompt) or resolution fails.
#[cfg(target_os = "macos")]
fn resolve_foreground_process(shell_pid: u32) -> Option<String> {
    let tpgid_out = std::process::Command::new("ps")
        .args(["-o", "tpgid=", "-p", &shell_pid.to_string()])
        .output()
        .ok()?;
    let tpgid: u32 = std::str::from_utf8(&tpgid_out.stdout).ok()?.trim().parse().ok()?;

    // tpgid == shell's pgid when shell is foreground — that means no child
    // is running, so we report None.
    if tpgid == shell_pid || tpgid == 0 {
        return None;
    }

    let args_out = std::process::Command::new("ps")
        .args(["-o", "args=", "-g", &tpgid.to_string()])
        .output()
        .ok()?;
    let first_line = std::str::from_utf8(&args_out.stdout).ok()?.lines().next()?.trim();
    if first_line.is_empty() {
        return None;
    }
    if is_shell_process(first_line.split_whitespace().next().unwrap_or("")) {
        return None;
    }
    Some(first_line.to_string())
}

#[cfg(target_os = "linux")]
fn resolve_foreground_process(shell_pid: u32) -> Option<String> {
    let stat = std::fs::read_to_string(format!("/proc/{shell_pid}/stat")).ok()?;
    // Format: pid (comm) state ppid pgrp session tty tpgid ...
    // comm is in parens and may contain spaces, so split on last ')'.
    let close_paren = stat.rfind(')')?;
    let rest = stat[close_paren + 1..].trim();
    let fields: Vec<&str> = rest.split_whitespace().collect();
    let tpgid: u32 = fields.get(4)?.parse().ok()?;
    if tpgid == shell_pid || tpgid == 0 {
        return None;
    }
    let cmdline = std::fs::read_to_string(format!("/proc/{tpgid}/cmdline")).ok()?;
    let first = cmdline.replace('\0', " ").trim().to_string();
    if first.is_empty() || is_shell_process(first.split_whitespace().next().unwrap_or("")) {
        return None;
    }
    Some(first)
}

/// Resolve the CWD of the shell process.
#[cfg(target_os = "macos")]
fn resolve_cwd(shell_pid: u32) -> Option<String> {
    let out = std::process::Command::new("lsof")
        .args(["-a", "-p", &shell_pid.to_string(), "-d", "cwd", "-Fn"])
        .output()
        .ok()?;
    let s = std::str::from_utf8(&out.stdout).ok()?;
    // lsof -Fn output has lines starting with 'n' followed by the path.
    for line in s.lines() {
        if let Some(rest) = line.strip_prefix('n') {
            return Some(tilde_abbrev(rest));
        }
    }
    None
}

#[cfg(target_os = "linux")]
fn resolve_cwd(shell_pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{shell_pid}/cwd"))
        .ok()
        .and_then(|p| p.to_str().map(tilde_abbrev))
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
        let inhibitor = std::sync::Arc::new(crate::sleep_inhibitor::SleepInhibitor::new());
        let id = manager
            .spawn(
                session_id,
                SpawnConfig {
                    worktree_id: "test-worktree".to_string(),
                    worktree_path: "/tmp".to_string(),
                    repo_path: None,
                    command: "echo".to_string(),
                    args: vec!["hello".to_string()],
                    agent_type: AgentType::Unknown,
                    state_server_port: None,
                    session_type: SessionType::Agent,
                    assigned_port: None,
                    port_env_var: None,
                    state_server: None,
                },
                channel,
                inhibitor,
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

    /// Verify that concurrent writes to different sessions don't deadlock.
    #[test]
    fn concurrent_writes_to_different_sessions() {
        let manager = Arc::new(PtyManager::new());

        // Spawn two sessions with long-running commands
        let mut session_ids = Vec::new();
        let inhibitor = std::sync::Arc::new(crate::sleep_inhibitor::SleepInhibitor::new());
        for i in 0..2 {
            let channel = Channel::new(move |_body| Ok(()));
            let session_id = PtyManager::generate_session_id();
            let id = manager
                .spawn(
                    session_id,
                    SpawnConfig {
                        worktree_id: format!("worktree-{i}"),
                        worktree_path: "/tmp".to_string(),
                        repo_path: None,
                        command: "cat".to_string(),
                        args: vec![],
                        agent_type: AgentType::Unknown,
                        state_server_port: None,
                        session_type: SessionType::Agent,
                        assigned_port: None,
                        port_env_var: None,
                        state_server: None,
                    },
                    channel,
                    std::sync::Arc::clone(&inhibitor),
                )
                .expect("spawn should succeed");
            session_ids.push(id);
        }

        // Write to both sessions concurrently from multiple threads
        let mut handles = Vec::new();
        for id in &session_ids {
            let mgr = Arc::clone(&manager);
            let sid = id.clone();
            let handle = thread::spawn(move || {
                let mut successes = 0u32;
                for _ in 0..100 {
                    if mgr.write(&sid, b"x").is_ok() {
                        successes += 1;
                    }
                }
                assert!(successes > 0, "at least one write should succeed");
            });
            handles.push(handle);
        }

        for handle in handles {
            handle.join().expect("thread should not panic");
        }

        // Clean up
        for id in &session_ids {
            let _ = manager.close(id);
        }
    }

    // ── OSC scanner tests ──

    #[test]
    fn osc_title_simple_bel_terminator() {
        let mut s = OscScanner::new();
        let mut out = Vec::new();
        s.feed(b"\x1b]0;hello world\x07", &mut out);
        assert_eq!(out, vec![OscEvent::Title(Some("hello world".to_string()))]);
    }

    #[test]
    fn osc_title_st_terminator() {
        let mut s = OscScanner::new();
        let mut out = Vec::new();
        s.feed(b"\x1b]2;my title\x1b\\", &mut out);
        assert_eq!(out, vec![OscEvent::Title(Some("my title".to_string()))]);
    }

    #[test]
    fn osc_title_empty_payload_is_none() {
        let mut s = OscScanner::new();
        let mut out = Vec::new();
        s.feed(b"\x1b]0;\x07", &mut out);
        assert_eq!(out, vec![OscEvent::Title(None)]);
    }

    #[test]
    fn osc_title_split_across_chunks() {
        let mut s = OscScanner::new();
        let mut out = Vec::new();
        s.feed(b"\x1b]0;hel", &mut out);
        assert_eq!(out, vec![]);
        s.feed(b"lo\x07rest-of-stream", &mut out);
        assert_eq!(out, vec![OscEvent::Title(Some("hello".to_string()))]);
    }

    #[test]
    fn osc_cwd_routes_separately() {
        let mut s = OscScanner::new();
        let mut out = Vec::new();
        s.feed(b"\x1b]7;file://host/Users/chloe/alfredo\x07", &mut out);
        assert_eq!(
            out,
            vec![OscEvent::Cwd(Some("/Users/chloe/alfredo".to_string()))]
        );
    }

    #[test]
    fn osc_oversized_title_discarded() {
        let mut s = OscScanner::new();
        let mut out = Vec::new();
        let big = "x".repeat(512);
        let mut bytes = b"\x1b]0;".to_vec();
        bytes.extend_from_slice(big.as_bytes());
        bytes.push(0x07);
        s.feed(&bytes, &mut out);
        assert_eq!(out, vec![]); // discarded, not emitted
    }

    #[test]
    fn osc_ignored_sequence_numbers() {
        let mut s = OscScanner::new();
        let mut out = Vec::new();
        // OSC 8 is the hyperlink sequence — we don't care about it.
        s.feed(b"\x1b]8;;http://example.com\x07click\x1b]8;;\x07", &mut out);
        assert_eq!(out, vec![]);
    }

    #[test]
    fn osc_mixed_with_regular_output() {
        let mut s = OscScanner::new();
        let mut out = Vec::new();
        s.feed(b"prompt$ \x1b]0;vim\x07 some output", &mut out);
        assert_eq!(out, vec![OscEvent::Title(Some("vim".to_string()))]);
    }

    #[test]
    fn tilde_abbrev_under_home() {
        std::env::set_var("HOME", "/Users/chloe");
        assert_eq!(tilde_abbrev("/Users/chloe/alfredo"), "~/alfredo");
        assert_eq!(tilde_abbrev("/Users/chloe"), "~");
        assert_eq!(tilde_abbrev("/Users/chloe/dev/alfredo/src"), "~/dev/alfredo/src");
    }

    #[test]
    fn tilde_abbrev_outside_home() {
        std::env::set_var("HOME", "/Users/chloe");
        assert_eq!(tilde_abbrev("/tmp"), "/tmp");
        assert_eq!(tilde_abbrev("/Users/someone-else/proj"), "/Users/someone-else/proj");
    }

    #[test]
    fn shell_process_names_filtered() {
        assert!(is_shell_process("zsh"));
        assert!(is_shell_process("bash"));
        assert!(is_shell_process("fish"));
        assert!(is_shell_process("-zsh")); // login shell
        assert!(is_shell_process("/bin/zsh"));
        assert!(!is_shell_process("npm"));
        assert!(!is_shell_process("vim"));
        assert!(!is_shell_process("cargo"));
    }

    #[test]
    fn alfredo_session_comm_recognises_shells_and_agents() {
        // portable-pty execs the configured command directly, so child comm
        // is the shell for terminal tabs or the agent binary for agent tabs.
        assert!(is_alfredo_session_comm("zsh"));
        assert!(is_alfredo_session_comm("/bin/bash"));
        assert!(is_alfredo_session_comm("claude"));
        assert!(is_alfredo_session_comm("codex"));
        assert!(is_alfredo_session_comm("gemini"));
        assert!(is_alfredo_session_comm("/usr/local/bin/claude"));

        // Recycled-pid candidates: anything else.
        assert!(!is_alfredo_session_comm(""));
        assert!(!is_alfredo_session_comm("vim"));
        assert!(!is_alfredo_session_comm("Code Helper"));
        assert!(!is_alfredo_session_comm("node"));
    }

    /// AskUserQuestion blocks waiting on the user but fires no
    /// PermissionRequest/Notification hook of its own (no permission needed,
    /// not MCP elicitation), so without a dedicated branch the PreToolUse hook
    /// posts plain `busy` and the sidebar shows "Editing…" the whole time the
    /// agent is parked on a question. The PreToolUse hook must branch on
    /// `tool_name` and route AskUserQuestion to waitingForInput + notify input.
    #[test]
    fn pretooluse_hook_routes_askuserquestion_to_waiting_for_input() {
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let worktree = tmp.path().join("wt");
        std::fs::create_dir_all(&worktree).unwrap();

        write_hooks_config(worktree.to_str().unwrap(), "http://127.0.0.1:0", "owner/wt")
            .expect("write hooks");

        let contents =
            std::fs::read_to_string(worktree.join(".claude/settings.local.json")).expect("read");
        let config: serde_json::Value = serde_json::from_str(&contents).expect("parse");

        let cmd = config["hooks"]["PreToolUse"]
            .as_array()
            .expect("PreToolUse array")
            .iter()
            .find_map(|e| e["hooks"][0]["command"].as_str())
            .expect("PreToolUse command");

        // Branches on the tool name read from the hook's stdin JSON.
        assert!(
            cmd.contains("AskUserQuestion"),
            "PreToolUse must branch on AskUserQuestion; got: {cmd}"
        );
        // AskUserQuestion → waitingForInput + notify (banner + pulsing dot),
        // phase=toolStart so workDepth still increments.
        assert!(
            cmd.contains("ST=waitingForInput; Q='?notify=input&phase=toolStart'"),
            "AskUserQuestion branch must route to waitingForInput?notify=input&phase=toolStart; got: {cmd}"
        );
        // Every other tool still posts busy?phase=toolStart (depth +1, balanced
        // by the matching PostToolUse toolEnd).
        assert!(
            cmd.contains("ST=busy; Q='?phase=toolStart'"),
            "default branch must route to busy?phase=toolStart; got: {cmd}"
        );
    }

    /// When the main agent dispatches a background/Task subagent it fires
    /// SubagentStart (parent context) and then, the moment it yields, Stop —
    /// so without a SubagentStart hook the sidebar shows "Idle" while the
    /// subagent runs. SubagentStart must post busy?phase=subagentStart so the
    /// frontend can count it into subagentDepth and gate the idle transition.
    #[test]
    fn subagent_start_hook_posts_busy_subagent_start() {
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let worktree = tmp.path().join("wt");
        std::fs::create_dir_all(&worktree).unwrap();

        write_hooks_config(worktree.to_str().unwrap(), "http://127.0.0.1:0", "owner/wt")
            .expect("write hooks");

        let contents =
            std::fs::read_to_string(worktree.join(".claude/settings.local.json")).expect("read");
        let config: serde_json::Value = serde_json::from_str(&contents).expect("parse");

        let cmd = config["hooks"]["SubagentStart"]
            .as_array()
            .expect("SubagentStart array")
            .iter()
            .find_map(|e| e["hooks"][0]["command"].as_str())
            .expect("SubagentStart command");

        assert!(
            cmd.contains("/busy?phase=subagentStart"),
            "SubagentStart must post busy?phase=subagentStart; got: {cmd}"
        );
    }

    /// Boot cleanup must skip stripping alfredo hooks from a settings file
    /// whose PID-file sidecar shows another alfredo session (this instance
    /// or a sibling instance) is still alive. Otherwise multi-instance and
    /// symlinked-settings setups have their live sessions silently lobotomised.
    #[test]
    fn cleanup_stale_hooks_skips_paths_with_alive_alfredo_session() {
        use std::path::PathBuf;
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let worktree_a = tmp.path().join("worktree-a");
        let worktree_b = tmp.path().join("worktree-b");
        std::fs::create_dir_all(worktree_a.join(".claude")).unwrap();
        std::fs::create_dir_all(worktree_b.join(".claude")).unwrap();

        let hook_json = serde_json::json!({
            "hooks": {
                "Stop": [{
                    "matcher": "*",
                    "hooks": [{
                        "type": "command",
                        "command": "curl -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/idle\""
                    }]
                }]
            }
        });
        let serialized = serde_json::to_string_pretty(&hook_json).unwrap();
        let settings_a = worktree_a.join(".claude/settings.local.json");
        let settings_b = worktree_b.join(".claude/settings.local.json");
        std::fs::write(&settings_a, &serialized).unwrap();
        std::fs::write(&settings_b, &serialized).unwrap();

        // Spawn a real shell child so the PID-reuse defense (which checks
        // `ps -o comm=` for a shell name) treats this pid as an alfredo
        // session. The test runner's own pid wouldn't pass that check.
        // Suffix session ids with a unique fragment so concurrent test runs
        // don't collide on the shared /tmp namespace.
        // Two statements (`;`) defeat sh's single-command exec optimization,
        // which would otherwise replace the shell with `sleep` in-place and
        // make `ps -o comm=` report the pid as `sleep` rather than `sh`.
        let mut shell_child = std::process::Command::new("sh")
            .args(["-c", "sleep 30; :"])
            .spawn()
            .expect("spawn sleep shell");
        let shell_pid = shell_child.id();
        let test_uniq = format!("test-{}-{}", std::process::id(), std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let session_id = format!("alive-{test_uniq}");
        let pid_path = format!("/tmp/alfredo-claude-{session_id}.pid");
        let sidecar_path = format!("/tmp/alfredo-claude-{session_id}.worktree");
        let canonical_a: PathBuf = settings_a.canonicalize().unwrap();
        std::fs::write(&pid_path, shell_pid.to_string()).unwrap();
        std::fs::write(&sidecar_path, canonical_a.to_string_lossy().as_ref()).unwrap();

        let manager = PtyManager::new();
        manager.cleanup_stale_hooks_in_paths(&[
            worktree_a.to_string_lossy().to_string(),
            worktree_b.to_string_lossy().to_string(),
        ]);

        let after_a = std::fs::read_to_string(&settings_a).unwrap();
        let after_b = std::fs::read_to_string(&settings_b).unwrap();

        // Cleanup before assertions so a panic still drops the temp files
        // and the spawned shell.
        let _ = shell_child.kill();
        let _ = shell_child.wait();
        let _ = std::fs::remove_file(&pid_path);
        let _ = std::fs::remove_file(&sidecar_path);

        assert!(
            after_a.contains("$ALFREDO_STATE_URL"),
            "A's hooks must be preserved while an alfredo session is alive against the same settings file:\n{after_a}",
        );
        assert!(
            !after_b.contains("$ALFREDO_STATE_URL"),
            "B's hooks must still be stripped (no alive session protecting it):\n{after_b}",
        );
    }

    /// PID reuse: a stale sidecar referencing a pid that's been recycled by
    /// some non-shell process (e.g. the test runner itself, or an editor)
    /// must NOT protect the settings file. Otherwise a session that crashed
    /// long ago could permanently shield its old worktree's hooks.
    #[test]
    fn cleanup_stale_hooks_strips_when_pid_reused_by_non_shell() {
        use std::path::PathBuf;
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let worktree = tmp.path().join("worktree");
        std::fs::create_dir_all(worktree.join(".claude")).unwrap();

        let hook_json = serde_json::json!({
            "hooks": {
                "Stop": [{
                    "matcher": "*",
                    "hooks": [{
                        "type": "command",
                        "command": "curl -X POST \"$ALFREDO_STATE_URL/agent-state/$ALFREDO_SESSION_ID/$ALFREDO_WORKTREE_ID/idle\""
                    }]
                }]
            }
        });
        let serialized = serde_json::to_string_pretty(&hook_json).unwrap();
        let settings = worktree.join(".claude/settings.local.json");
        std::fs::write(&settings, &serialized).unwrap();

        // Use the test runner's own pid — alive but `ps -o comm=` won't
        // report it as a shell, so the defense should treat the sidecar as
        // stale and strip the hooks.
        let test_uniq = format!("test-{}-{}", std::process::id(), std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos());
        let session_id = format!("reused-{test_uniq}");
        let pid_path = format!("/tmp/alfredo-claude-{session_id}.pid");
        let sidecar_path = format!("/tmp/alfredo-claude-{session_id}.worktree");
        let canonical: PathBuf = settings.canonicalize().unwrap();
        std::fs::write(&pid_path, std::process::id().to_string()).unwrap();
        std::fs::write(&sidecar_path, canonical.to_string_lossy().as_ref()).unwrap();

        let manager = PtyManager::new();
        manager.cleanup_stale_hooks_in_paths(&[worktree.to_string_lossy().to_string()]);

        let after = std::fs::read_to_string(&settings).unwrap();

        let _ = std::fs::remove_file(&pid_path);
        let _ = std::fs::remove_file(&sidecar_path);

        assert!(
            !after.contains("$ALFREDO_STATE_URL"),
            "hooks must be stripped when sidecar pid is alive but isn't a shell (pid reuse):\n{after}",
        );
    }
}
