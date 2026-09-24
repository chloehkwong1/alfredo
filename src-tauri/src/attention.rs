//! Window-attention flag mirrored from the frontend (`stores/attentionStore.ts`).
//!
//! `true` means Alfredo's window is focused. The Rust polling loops
//! (`github_sync`, the shell poller in `pty_manager`) read it to pick a slower
//! cadence while nobody is looking. Frontend-owned on purpose: the webview
//! already receives focus natively, and the failure mode of a webview reload
//! is merely slower polling until its effect re-registers — never a missed
//! agent cue, which is push-driven and does not pass through here.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Shared, cheaply clonable handle to the focus flag. Managed on the Tauri
/// app and threaded into the loops that read it.
#[derive(Clone)]
pub struct AttentionState(Arc<AtomicBool>);

impl AttentionState {
    /// Starts focused: until the frontend says otherwise, poll at full rate.
    pub fn new() -> Self {
        Self(Arc::new(AtomicBool::new(true)))
    }

    /// `#[allow(dead_code)]` because no reader is wired up yet — `github_sync`
    /// and the shell poller start calling this in later tasks of the
    /// attention-gated-polling series.
    #[allow(dead_code)]
    pub fn is_focused(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    pub fn set_focused(&self, focused: bool) {
        self.0.store(focused, Ordering::Relaxed);
    }
}

impl Default for AttentionState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_focused_and_clones_share_the_flag() {
        let a = AttentionState::new();
        assert!(a.is_focused());
        let b = a.clone();
        b.set_focused(false);
        assert!(!a.is_focused(), "clones must share one flag");
        a.set_focused(true);
        assert!(b.is_focused());
    }
}
