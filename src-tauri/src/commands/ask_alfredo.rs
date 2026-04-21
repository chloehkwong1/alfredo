use crate::app_config_manager;
use crate::ask_alfredo::{
    docs,
    llm::{Answer, LlmClient},
    prompt,
};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn ask_alfredo(app: AppHandle, question: String) -> Result<Answer, String> {
    let docs = docs::load_all(&app)?;
    let system = format!(
        "{}\n\n{}",
        prompt::SYSTEM_INSTRUCTIONS,
        prompt::format_corpus(&docs)
    );
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app data dir: {e}"))?;
    let cfg = app_config_manager::load(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let client = LlmClient {
        anthropic_api_key: cfg.anthropic_api_key.clone(),
    };
    client.ask(system, question).await
}
