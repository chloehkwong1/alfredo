use crate::app_config_manager;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::UpdaterExt;

#[derive(Default)]
pub struct PendingUpdate(pub(crate) tokio::sync::Mutex<Option<tauri_plugin_updater::Update>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
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
    // If an install is already in flight, skip the check rather than overwriting the pending update.
    if pending.0.lock().await.is_some() {
        return Ok(None);
    }

    let receive_beta = app_config_manager::load_sync_best_effort()
        .map(|c| c.receive_beta_updates)
        .unwrap_or(false);

    // Query each endpoint on its own updater instead of handing the plugin the
    // whole list. The plugin's loop stops at the first feed that returns a
    // parseable release, so a `beta-latest` pointer left behind by a run of
    // stable-only releases answers first and hides a newer stable — beta users
    // sit below current stable and are told they are up to date.
    let mut updates = Vec::new();
    let mut last_error: Option<String> = None;
    for endpoint in crate::updater_endpoint_urls(receive_beta) {
        let built = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .and_then(tauri_plugin_updater::UpdaterBuilder::build);
        match built {
            Ok(updater) => match updater.check().await {
                Ok(Some(update)) => updates.push(update),
                Ok(None) => {}
                Err(e) => last_error = Some(e.to_string()),
            },
            Err(e) => last_error = Some(e.to_string()),
        }
    }

    // Surface an error only when nothing was offered at all: one unreachable
    // feed must not fail a check the other feed already satisfied.
    if updates.is_empty() {
        *pending.0.lock().await = None;
        return match last_error {
            Some(e) => Err(e),
            None => Ok(None),
        };
    }

    let versions: Vec<String> = updates.iter().map(|u| u.version.clone()).collect();
    match crate::best_offer_index(&versions, receive_beta) {
        Some(i) => {
            let update = updates.swap_remove(i);
            let info = UpdateInfo {
                version: update.version.clone(),
                current_version: update.current_version.clone(),
                body: update.body.clone(),
            };
            *pending.0.lock().await = Some(update);
            Ok(Some(info))
        }
        // Every candidate was a prerelease on the stable channel — the issue
        // #47 anomaly. Refuse and log so a release-process slip stays visible.
        None => {
            eprintln!(
                "[updater] refused prerelease(s) {} on stable channel (issue #47)",
                versions.join(", ")
            );
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
        .clone()
        .ok_or_else(|| "no pending update".to_string())?;

    let app_for_progress = app.clone();
    let app_for_finished = app.clone();
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
                if let Err(e) = app_for_finished.emit("updater://finished", ()) {
                    eprintln!("[updater] failed to emit finished event: {e}");
                }
            },
        )
        .await
        .map_err(|e| {
            tracing::error!("failed to download/install update: {e}");
            e.to_string()
        })?;

    // Only clear the stored update on success so a retry is possible on failure.
    *pending.0.lock().await = None;

    Ok(())
}
