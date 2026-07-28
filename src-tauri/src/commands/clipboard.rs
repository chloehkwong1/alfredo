use crate::types::AppError;

/// Write text to the system clipboard from native code.
///
/// The text arrives as raw UTF-8 bytes rather than a JSON string: on
/// Dock-launched (locale-less) builds, WKWebView re-decodes string IPC
/// payloads with the MacRoman default C-string encoding somewhere between the
/// frontend `fetch` body and the native request, so "—" lands here as "‚Äî".
/// Byte arrays serialize as JSON numbers — pure ASCII on the wire — and are
/// immune. Same pattern as `write_pty`. The frontend falls back to
/// `navigator.clipboard` on platforms where this returns an error.
#[tauri::command]
pub async fn set_clipboard_text(bytes: Vec<u8>) -> Result<(), AppError> {
    let text = String::from_utf8(bytes)
        .map_err(|e| AppError::Config(format!("clipboard payload is not valid UTF-8: {e}")))?;
    #[cfg(target_os = "macos")]
    {
        use objc2_app_kit::{NSPasteboard, NSPasteboardTypeString};
        use objc2_foundation::NSString;

        let pasteboard = NSPasteboard::generalPasteboard();
        pasteboard.clearContents();
        let type_string = unsafe { NSPasteboardTypeString };
        if pasteboard.setString_forType(&NSString::from_str(&text), type_string) {
            Ok(())
        } else {
            Err(AppError::Config("pasteboard rejected the write".into()))
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = text;
        Err(AppError::Config(
            "native clipboard write is macOS-only".into(),
        ))
    }
}
