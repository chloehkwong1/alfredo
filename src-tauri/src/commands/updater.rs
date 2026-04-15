use crate::app_config_manager;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
pub struct PendingUpdate(pub tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub current_version: String,
    pub body: Option<String>,
}

#[tauri::command]
pub async fn check_for_update_filtered(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<Option<UpdateInfo>, String> {
    let receive_beta = app_config_manager::load_sync_best_effort()
        .map(|c| c.receive_beta_updates)
        .unwrap_or(false);

    let endpoints = crate::updater_endpoint_urls(receive_beta);

    let updater = app
        .updater_builder()
        .endpoints(endpoints)
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;

    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            let info = UpdateInfo {
                version: update.version.clone(),
                current_version: update.current_version.clone(),
                body: update.body.clone(),
            };
            *pending.0.lock().await = Some(update);
            Ok(Some(info))
        }
        None => {
            *pending.0.lock().await = None;
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn install_pending_update(
    app: AppHandle,
    pending: State<'_, PendingUpdate>,
) -> Result<(), String> {
    let update = pending
        .0
        .lock()
        .await
        .take()
        .ok_or_else(|| "no pending update".to_string())?;

    let app_for_progress = app.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = app_for_progress.emit(
                    "updater://progress",
                    serde_json::json!({
                        "chunkLength": chunk_length,
                        "contentLength": content_length,
                    }),
                );
            },
            move || {
                let _ = app.emit("updater://finished", ());
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}
