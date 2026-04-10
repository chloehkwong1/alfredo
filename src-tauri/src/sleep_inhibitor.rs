//! Prevents the system from sleeping while any agent is actively working.
//!
//! On macOS, spawns `caffeinate -i` (inhibit idle sleep).
//! On Linux, spawns `systemd-inhibit --what=idle sleep infinity`.
//! The inhibitor process is killed when all agents go idle/stopped.

use std::process::{Child, Command};
use std::sync::Mutex;

use crate::types::AgentState;

/// Tracks active (busy) sessions and manages the system sleep inhibitor process.
pub struct SleepInhibitor {
    inner: Mutex<Inner>,
}

struct Inner {
    /// Set of session IDs currently in a "busy" state.
    busy_sessions: std::collections::HashSet<String>,
    /// The inhibitor child process, if running.
    process: Option<Child>,
}

impl SleepInhibitor {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(Inner {
                busy_sessions: std::collections::HashSet::new(),
                process: None,
            }),
        }
    }

    /// Called when a session's agent state changes.
    /// Starts or stops the inhibitor based on whether any session is busy.
    pub fn update(&self, session_id: &str, state: &AgentState) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };

        match state {
            AgentState::Busy => {
                inner.busy_sessions.insert(session_id.to_string());
            }
            AgentState::Idle | AgentState::WaitingForInput | AgentState::NotRunning => {
                inner.busy_sessions.remove(session_id);
            }
        }

        let should_inhibit = !inner.busy_sessions.is_empty();
        let is_inhibiting = inner.process.is_some();

        if should_inhibit && !is_inhibiting {
            inner.process = spawn_inhibitor();
        } else if !should_inhibit && is_inhibiting {
            kill_inhibitor(&mut inner.process);
        }
    }

    /// Remove a session entirely (e.g. when the PTY is closed).
    pub fn remove_session(&self, session_id: &str) {
        self.update(session_id, &AgentState::NotRunning);
    }
}

impl Drop for SleepInhibitor {
    fn drop(&mut self) {
        if let Ok(mut inner) = self.inner.lock() {
            kill_inhibitor(&mut inner.process);
        }
    }
}

fn spawn_inhibitor() -> Option<Child> {
    let result = if cfg!(target_os = "macos") {
        Command::new("caffeinate")
            .arg("-i") // prevent idle sleep
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
            eprintln!("[alfredo] sleep inhibitor started (pid {})", child.id());
            Some(child)
        }
        Err(e) => {
            eprintln!("[alfredo] failed to start sleep inhibitor: {e}");
            None
        }
    }
}

fn kill_inhibitor(process: &mut Option<Child>) {
    if let Some(mut child) = process.take() {
        eprintln!("[alfredo] sleep inhibitor stopped (pid {})", child.id());
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_session_busy_starts_inhibitor() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy);

        let inner = inhibitor.inner.lock().unwrap();
        assert!(inner.busy_sessions.contains("s1"));
        assert!(inner.process.is_some(), "inhibitor process should be running");
    }

    #[test]
    fn last_session_idle_stops_inhibitor() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy);
        inhibitor.update("s1", &AgentState::Idle);

        let inner = inhibitor.inner.lock().unwrap();
        assert!(inner.busy_sessions.is_empty());
        assert!(inner.process.is_none(), "inhibitor process should be stopped");
    }

    #[test]
    fn multiple_sessions_keeps_inhibitor_alive() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy);
        inhibitor.update("s2", &AgentState::Busy);

        // First session goes idle — inhibitor should still run
        inhibitor.update("s1", &AgentState::Idle);
        {
            let inner = inhibitor.inner.lock().unwrap();
            assert!(inner.process.is_some(), "inhibitor should still run while s2 is busy");
        }

        // Last session goes idle — inhibitor should stop
        inhibitor.update("s2", &AgentState::WaitingForInput);
        {
            let inner = inhibitor.inner.lock().unwrap();
            assert!(inner.process.is_none(), "inhibitor should stop when all sessions idle");
        }
    }

    #[test]
    fn remove_session_cleans_up() {
        let inhibitor = SleepInhibitor::new();
        inhibitor.update("s1", &AgentState::Busy);
        inhibitor.remove_session("s1");

        let inner = inhibitor.inner.lock().unwrap();
        assert!(inner.busy_sessions.is_empty());
        assert!(inner.process.is_none());
    }
}
