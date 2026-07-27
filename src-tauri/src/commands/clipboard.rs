use crate::types::AppError;

/// Write text to the system clipboard from native code.
///
/// The WebView's `navigator.clipboard.writeText` corrupts non-ASCII text when
/// the app is launched without a locale in its environment (i.e. from the
/// Dock): the UTF-8 payload gets re-decoded with the MacRoman default
/// C-string encoding somewhere in the WKWebView write path, so "é" lands on
/// the pasteboard as "√©". Writing an explicit NSString via NSPasteboard is
/// locale-independent. The frontend falls back to `navigator.clipboard` on
/// platforms where this returns an error.
#[tauri::command]
pub async fn set_clipboard_text(text: String) -> Result<(), AppError> {
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
