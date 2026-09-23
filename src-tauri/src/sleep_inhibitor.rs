//! Prevents the system from sleeping while any agent is actively working.
//!
//! On macOS, spawns `caffeinate -i` (inhibit idle sleep).
//! On Linux, spawns `systemd-inhibit --what=idle sleep infinity`.
//! The inhibitor process is killed when all agents go idle/stopped.
//!
//! Two safeguards keep a dropped hook from pinning the machine awake forever:
//!   * a `SubagentEnd` straggler can never re-arm an already-idle session, and
//!   * any busy entry that stops being refreshed expires after `STALE_BUSY_TTL`.

use std::collections::HashMap;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::types::{AgentState, HookPhase};

/// How long a session may sit in `busy_sessions` without a refreshing hook
/// before it is treated as stranded. Must comfortably exceed the longest
/// plausible gap between hooks for a genuinely working agent (a single
/// long-running tool call emits ToolStart, then nothing until ToolEnd).
const STALE_BUSY_TTL: Duration = Duration::from_secs(30 * 60);

/// How often the reaper re-checks for stranded entries while inhibiting.
const REAPER_INTERVAL: Duration = Duration::from_secs(60);

/// One session's hold on the inhibitor.
struct BusyEntry {
    /// When the session last reported activity.
    last_seen: Instant,
    /// Whether a hook phase has ever been seen for this session. The TTL only
    /// applies to hook-driven sessions: a detector-driven one (`HookPhase::None`)
    /// emits only on state change, so a long Busy run sends no refresh, and it
    /// has no hooks to drop anyway — the detector's Idle or the reader thread's
    /// `remove_session` releases it. Sticky: a later detector tick never
    /// downgrades a session that has already seen a hook.
    hook_driven: bool,
}

/// Tracks active (busy) sessions and manages the system sleep inhibitor process.
pub struct SleepInhibitor {
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    /// session_id → that session's busy record.
    busy_sessions: HashMap<String, BusyEntry>,
    /// The inhibitor child process, if running.
    process: Option<Child>,
    /// Whether a reaper thread is currently alive.
    reaper_running: bool,
}

impl SleepInhibitor {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                busy_sessions: HashMap::new(),
                process: None,
                reaper_running: false,
            })),
        }
    }

    /// Called when a session's agent state changes.
    /// Starts or stops the inhibitor based on whether any session is busy.
    pub fn update(&self, session_id: &str, state: &AgentState, phase: &HookPhase) {
        let needs_reaper = {
            let Ok(mut inner) = self.inner.lock() else {
                return;
            };

            purge_stale(&mut inner, Instant::now());

            match state {
                AgentState::Busy => {
                    // `HookPhase::SubagentEnd` is a SubagentStop straggler: it can
                    // land after the parent's TurnEnd. It may refresh a session
                    // that is still busy, but must never wake an idle one.
                    let is_straggler = *phase == HookPhase::SubagentEnd
                        && !inner.busy_sessions.contains_key(session_id);
                    if !is_straggler {
                        let from_hook = *phase != HookPhase::None;
                        let entry = inner
                            .busy_sessions
                            .entry(session_id.to_string())
                            .or_insert(BusyEntry {
                                last_seen: Instant::now(),
                                hook_driven: from_hook,
                            });
                        entry.last_seen = Instant::now();
                        entry.hook_driven |= from_hook;
                    }
                }
                AgentState::Idle | AgentState::WaitingForInput | AgentState::NotRunning => {
                    inner.busy_sessions.remove(session_id);
                }
            }

            reconcile(&mut inner)
        };

        if needs_reaper {
            self.spawn_reaper();
        }
    }

    /// Remove a session entirely (e.g. when the PTY is closed or hibernated).
    pub fn remove_session(&self, session_id: &str) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.busy_sessions.remove(session_id);
        reconcile(&mut inner);
    }

    /// Drop busy entries that stopped being refreshed, then reconcile.
    /// `now` is injected so the TTL can be exercised without sleeping; the
    /// production path drives the same logic from `update` and the reaper.
    #[cfg(test)]
    pub(crate) fn purge_stale(&self, now: Instant) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        purge_stale(&mut inner, now);
        reconcile(&mut inner);
    }

    #[cfg(test)]
    pub(crate) fn is_busy(&self, session_id: &str) -> bool {
        self.inner
            .lock()
            .map(|inner| inner.busy_sessions.contains_key(session_id))
            .unwrap_or(false)
    }

    /// Run a reaper for as long as the inhibitor is held, so a session whose
    /// terminating hook never arrives cannot keep the machine awake forever.
    fn spawn_reaper(&self) {
        let inner = Arc::clone(&self.inner);
        thread::spawn(move || loop {
            thread::sleep(REAPER_INTERVAL);
            let Ok(mut guard) = inner.lock() else {
                return;
            };
            purge_stale(&mut guard, Instant::now());
            reconcile(&mut guard);
            if guard.process.is_none() {
                guard.reaper_running = false;
                return;
            }
        });
    }
}

impl Drop for SleepInhibitor {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.inner.lock() {
            kill_inhibitor(&mut inner.process);
        }
    }
}

/// Drop any hook-driven busy entry not refreshed within `STALE_BUSY_TTL`.
fn purge_stale(inner: &mut Inner, now: Instant) {
    inner.busy_sessions.retain(|session_id, entry| {
        let fresh =
            !entry.hook_driven || now.duration_since(entry.last_seen) < STALE_BUSY_TTL;
        if !fresh {
            tracing::info!(
                "[sleep-inhibitor] dropping stranded busy session {session_id} (no hook for >{}s)",
                STALE_BUSY_TTL.as_secs()
            );
        }
        fresh
    });
}

/// Start or stop the inhibitor so it matches `busy_sessions`.
/// Returns true if a reaper thread needs to be spawned by the caller.
fn reconcile(inner: &mut Inner) -> bool {
    let should_inhibit = !inner.busy_sessions.is_empty();
    let is_inhibiting = inner.process.is_some();

    if should_inhibit && !is_inhibiting {
        inner.process = spawn_inhibitor();
        if inner.process.is_some() && !inner.reaper_running {
            inner.reaper_running = true;
            return true;
        }
    } else if !should_inhibit && is_inhibiting {
        kill_inhibitor(&mut inner.process);
    }
    false
}

fn spawn_inhibitor() -> Option<Child> {
    let result = if cfg!(target_os = "macos") {
        let pid = std::process::id().to_string();
        Command::new("caffeinate")
            .args(["-i", "-w", &pid]) // prevent idle sleep, die if Alfredo exits
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
    } else {
        // Linux: systemd-inhibit
        Command::new("systemd-inhibit")
            .args([
                "--what=idle",
                "--who=Alfredo",
                "--why=Agent is working",
                "sleep",
                "infinity",
            ])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
    };

    match result {
        Ok(child) => {
            tracing::info!("[sleep-inhibitor] started (pid {})", child.id());
            Some(child)
        }
        Err(e) => {
            tracing::info!("[sleep-inhibitor] failed to start: {e}");
            None
        }
    }
}

fn kill_inhibitor(process: &mut Option<Child>) {
    if let Some(mut child) = process.take() {
        tracing::info!("[sleep-inhibitor] stopped (pid {})", child.id());
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::HookPhase;

    #[test]
    fn single_session_busy_starts_inhibitor() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::ToolStart);

        let inner = inhibitor.inner.lock().unwrap();
        assert!(inner.busy_sessions.contains_key("s1"));
        assert!(inner.process.is_some(), "inhibitor process should be running");
    }

    #[test]
    fn last_session_idle_stops_inhibitor() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::ToolStart);
        inhibitor.update("s1", &AgentState::Idle, &HookPhase::TurnEnd);

        let inner = inhibitor.inner.lock().unwrap();
        assert!(inner.busy_sessions.is_empty());
        assert!(inner.process.is_none(), "inhibitor process should be stopped");
    }

    #[test]
    fn multiple_sessions_keeps_inhibitor_alive() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::ToolStart);
        inhibitor.update("s2", &AgentState::Busy, &HookPhase::ToolStart);

        // First session goes idle — inhibitor should still run
        inhibitor.update("s1", &AgentState::Idle, &HookPhase::TurnEnd);
        {
            let inner = inhibitor.inner.lock().unwrap();
            assert!(inner.process.is_some(), "inhibitor should still run while s2 is busy");
        }

        // Last session goes idle — inhibitor should stop
        inhibitor.update("s2", &AgentState::WaitingForInput, &HookPhase::TurnEnd);
        {
            let inner = inhibitor.inner.lock().unwrap();
            assert!(inner.process.is_none(), "inhibitor should stop when all sessions idle");
        }
    }

    #[test]
    fn remove_session_cleans_up() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::ToolStart);
        inhibitor.remove_session("s1");

        let inner = inhibitor.inner.lock().unwrap();
        assert!(inner.busy_sessions.is_empty());
        assert!(inner.process.is_none());
    }

    /// Pins the invariant documented on `HookPhase::SubagentEnd`: a SubagentStop
    /// hook that lands *after* the parent's TurnEnd must not wake an idle
    /// session. Observed in the wild holding `caffeinate` for 25h: the turn
    /// ended (Idle/TurnEnd) and 1.1s later a SubagentEnd/Busy straggler
    /// re-armed the inhibitor, which then never released.
    #[test]
    fn subagent_end_straggler_does_not_rearm_idle_session() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::ToolStart);
        inhibitor.update("s1", &AgentState::Idle, &HookPhase::TurnEnd);

        // Late SubagentStop arrives after the turn already finished.
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::SubagentEnd);

        let inner = inhibitor.inner.lock().unwrap();
        assert!(
            inner.busy_sessions.is_empty(),
            "a SubagentEnd straggler must not re-arm an idle session"
        );
        assert!(
            inner.process.is_none(),
            "inhibitor must stay stopped after a straggler"
        );
    }

    /// The straggler guard must not break the legitimate case: a subagent
    /// finishing while the parent is still working keeps the parent busy.
    #[test]
    fn subagent_end_while_still_busy_keeps_inhibitor() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::ToolStart);
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::SubagentEnd);

        let inner = inhibitor.inner.lock().unwrap();
        assert!(inner.busy_sessions.contains_key("s1"));
        assert!(
            inner.process.is_some(),
            "parent still busy — inhibitor should stay armed"
        );
    }

    /// Backstop for the whole dropped-hook class: if a session goes busy and
    /// its terminating hook never arrives (SIGKILL, EMFILE, crash), the entry
    /// must expire rather than pin the machine awake indefinitely.
    #[test]
    fn stale_busy_session_expires() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::ToolStart);

        let past_ttl = Instant::now() + STALE_BUSY_TTL + Duration::from_secs(1);
        inhibitor.purge_stale(past_ttl);

        let inner = inhibitor.inner.lock().unwrap();
        assert!(
            inner.busy_sessions.is_empty(),
            "a busy entry older than the TTL should be dropped"
        );
        assert!(
            inner.process.is_none(),
            "inhibitor should be released once the last stale entry expires"
        );
    }

    /// A session that keeps reporting activity must never be purged.
    #[test]
    fn refreshed_busy_session_is_not_purged() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::ToolStart);
        inhibitor.purge_stale(Instant::now());

        let inner = inhibitor.inner.lock().unwrap();
        assert!(inner.busy_sessions.contains_key("s1"));
        assert!(inner.process.is_some());
    }

    /// A detector-driven session (no hooks — `HookPhase::None`) emits only on
    /// state *change*, so a long single run of Busy sends nothing further to
    /// refresh the timestamp. The TTL defends against dropped hooks; this path
    /// has none to drop and cleans itself up via the detector's Idle / the
    /// reader thread's `remove_session`, so it must not be expired.
    #[test]
    fn detector_driven_busy_session_is_exempt_from_ttl() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::None);

        let past_ttl = Instant::now() + STALE_BUSY_TTL + Duration::from_secs(1);
        inhibitor.purge_stale(past_ttl);

        let inner = inhibitor.inner.lock().unwrap();
        assert!(
            inner.busy_sessions.contains_key("s1"),
            "a hookless session must not be expired by the TTL"
        );
        assert!(inner.process.is_some());
    }

    /// A real Claude session's detector fires *before* its hooks do. Once any
    /// hook phase has been seen the session is hook-driven and the TTL must
    /// apply — the detector's earlier `None` must not grant a permanent exemption.
    #[test]
    fn detector_session_that_gains_hooks_becomes_subject_to_ttl() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::None);
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::ToolStart);
        // A later detector tick must not downgrade it back to exempt.
        inhibitor.update("s1", &AgentState::Busy, &HookPhase::None);

        let past_ttl = Instant::now() + STALE_BUSY_TTL + Duration::from_secs(1);
        inhibitor.purge_stale(past_ttl);

        let inner = inhibitor.inner.lock().unwrap();
        assert!(
            inner.busy_sessions.is_empty(),
            "once hook-driven, a stale session must expire"
        );
        assert!(inner.process.is_none());
    }
}
