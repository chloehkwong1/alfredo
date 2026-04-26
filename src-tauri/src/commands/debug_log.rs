#[tauri::command]
#[allow(clippy::needless_pass_by_value)] // Tauri commands require owned arg types for serde deserialization
pub fn debug_log(message: String) {
    tracing::info!("[frontend] {message}");
}
