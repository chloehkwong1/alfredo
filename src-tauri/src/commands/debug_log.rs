#[tauri::command]
pub fn debug_log(message: String) {
    tracing::info!("[frontend] {message}");
}
