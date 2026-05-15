//! Frontend-facing notification commands.
//!
//! On macOS we route through the `macos_notifications` UNUserNotificationCenter
//! bridge for the banner (so macOS Focus/DND suppresses banners correctly),
//! and play sound via rodio in-process. Sound is never set on UN content —
//! see `macos_notifications` module docs.
//!
//! On Linux we call `notify_rust` directly against freedesktop notifications
//! and play sound via the same rodio command. Symmetric with macOS.

use tauri::AppHandle;

#[tauri::command]
pub async fn send_app_notification(
    app: AppHandle,
    title: String,
    body: String,
    sound: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        crate::macos_notifications::send(&title, &body)?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        notify_rust::Notification::new()
            .summary(&title)
            .body(&body)
            .show()
            .map(|_| ())
            .map_err(|e| e.to_string())?;
    }
    if let Some(id) = sound {
        if !id.is_empty() && id != "none" {
            let _ = crate::commands::audio::play_sound(app, id).await;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn notification_permission_status() -> String {
    #[cfg(target_os = "macos")]
    {
        crate::macos_notifications::authorization_status()
            .as_str()
            .to_string()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "granted".to_string()
    }
}

#[tauri::command]
pub fn request_notification_permission() -> bool {
    #[cfg(target_os = "macos")]
    {
        crate::macos_notifications::request_authorization()
    }
    #[cfg(not(target_os = "macos"))]
    {
        true
    }
}
