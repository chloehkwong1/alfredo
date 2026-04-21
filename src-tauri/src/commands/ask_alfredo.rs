use crate::ask_alfredo::search::{self, HelpHit};
use tauri::AppHandle;

#[tauri::command]
pub async fn search_alfredo_docs(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<HelpHit>, String> {
    let limit = limit.unwrap_or(5).clamp(1, 20);
    search::search_all(&app, &query, limit)
}
