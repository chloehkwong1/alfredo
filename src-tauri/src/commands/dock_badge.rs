use tauri::{AppHandle, Manager};

use crate::types::AppError;

/// Set the OS dock/taskbar badge count on the main window.
///
/// Tauri's `Window::set_badge_count` is supported on macOS and Linux.
/// Windows is unsupported (separate `set_overlay_icon` API) — the call is
/// a no-op there. iOS/Android are not target platforms for Alfredo.
///
/// `count == 0` clears the badge. Values above i64::MAX cannot be passed
/// from JS so the u32 input is effectively unbounded for our use case.
#[tauri::command]
pub async fn set_dock_badge(app: AppHandle, count: u32) -> Result<(), AppError> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| AppError::Config("main window not found".into()))?;

    let value: Option<i64> = if count == 0 { None } else { Some(count as i64) };

    window
        .set_badge_count(value)
        .map_err(|e| AppError::Config(format!("set_badge_count failed: {e}")))?;

    Ok(())
}
