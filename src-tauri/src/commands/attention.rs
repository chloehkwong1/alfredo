use tauri::State;

use crate::attention::AttentionState;

/// Mirror the webview's window-focus state into Rust.
///
/// Called by the frontend's attention store on every *landed* flip — focus
/// instantly, unfocus after its 5 s debounce — so this is not a hot path.
/// Read by `github_sync` and the shell poller to choose their cadence.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn set_attention(attention: State<'_, AttentionState>, focused: bool) {
    attention.set_focused(focused);
    tracing::info!(focused, "[attention] set_attention");
}
