use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

use crate::linear_manager;
use crate::linear_oauth;
use crate::types::AppError;

type Result<T> = std::result::Result<T, AppError>;

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))
}

#[tauri::command]
pub async fn linear_oauth_start(app: AppHandle) -> Result<()> {
    let app_data = app_data_dir(&app)?;

    let (auth_url, result_rx) = linear_oauth::start_oauth_flow().await?;

    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| AppError::Linear(format!("failed to open browser: {e}")))?;

    let app_clone = app.clone();
    tokio::spawn(async move {
        match result_rx.await {
            Ok(Ok(code)) => {
                match linear_oauth::exchange_code(&code).await {
                    Ok(tokens) => {
                        if let Err(e) = linear_oauth::save_tokens(&app_data, tokens).await {
                            let _ = app_clone.emit("linear-oauth-error", format!("Failed to save tokens: {e}"));
                            return;
                        }
                        // No re-validation here. The access token is valid by construction
                        // from Linear's token endpoint; re-validating risks hitting Linear's
                        // token-propagation window and wiping a good token. The displayName
                        // resolves later when Settings' on-mount status call fires.
                        let _ = app_clone.emit(
                            "linear-oauth-complete",
                            serde_json::json!({ "displayName": null }),
                        );
                    }
                    Err(e) => {
                        let _ = app_clone.emit("linear-oauth-error", e.to_string());
                    }
                }
            }
            Ok(Err(e)) => {
                let _ = app_clone.emit("linear-oauth-error", e);
            }
            Err(_) => {
                let _ = app_clone.emit("linear-oauth-error", "OAuth flow was cancelled".to_string());
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn linear_oauth_disconnect(app: AppHandle) -> Result<()> {
    let app_data = app_data_dir(&app)?;
    linear_oauth::clear_tokens(&app_data).await
}

#[derive(serde::Serialize)]
pub struct LinearOAuthStatus {
    pub connected: bool,
    pub display_name: Option<String>,
}

#[tauri::command]
pub async fn linear_oauth_status(app: AppHandle) -> Result<LinearOAuthStatus> {
    let app_data = app_data_dir(&app)?;

    let tokens = match linear_oauth::refresh_if_needed(&app_data).await? {
        Some(t) => t,
        None => return Ok(LinearOAuthStatus { connected: false, display_name: None }),
    };

    match linear_manager::get_viewer_name(&tokens.access_token).await {
        linear_manager::ViewerResult::Authed { display_name } => {
            Ok(LinearOAuthStatus { connected: true, display_name })
        }
        linear_manager::ViewerResult::Unauthed { status } => {
            tracing::warn!(status, "linear viewer returned auth-failure; clearing tokens");
            linear_oauth::clear_tokens(&app_data).await?;
            Ok(LinearOAuthStatus { connected: false, display_name: None })
        }
        linear_manager::ViewerResult::Transient { reason } => {
            tracing::warn!(reason, "linear viewer transient failure; keeping tokens");
            // Optimistic: keep tokens, report connected. Next mount revalidates.
            Ok(LinearOAuthStatus { connected: true, display_name: None })
        }
    }
}
