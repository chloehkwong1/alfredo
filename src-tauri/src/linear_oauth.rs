use std::future::IntoFuture;
use std::sync::Arc;
use tokio::sync::Mutex;

use axum::extract::{Query, State as AxumState};
use axum::http::StatusCode;
use axum::response::Html;
use axum::routing::get;
use axum::Router;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::app_config_manager;
use crate::types::{AppError, LinearOAuthTokens};

const CLIENT_ID: &str = env!("LINEAR_CLIENT_ID");
const CLIENT_SECRET: &str = env!("LINEAR_CLIENT_SECRET");
const AUTH_URL: &str = "https://linear.app/oauth/authorize";
const TOKEN_URL: &str = "https://api.linear.app/oauth/token";

/// Save OAuth tokens to app.json.
pub async fn save_tokens(
    app_data_dir: &std::path::Path,
    tokens: LinearOAuthTokens,
) -> Result<(), AppError> {
    let mut config = app_config_manager::load(app_data_dir).await?;
    config.linear_oauth = Some(tokens);
    app_config_manager::save(app_data_dir, &config).await
}

/// Load OAuth tokens from app.json (if present).
pub async fn load_tokens(
    app_data_dir: &std::path::Path,
) -> Result<Option<LinearOAuthTokens>, AppError> {
    let config = app_config_manager::load(app_data_dir).await?;
    Ok(config.linear_oauth)
}

/// Clear OAuth tokens from app.json.
pub async fn clear_tokens(app_data_dir: &std::path::Path) -> Result<(), AppError> {
    let mut config = app_config_manager::load(app_data_dir).await?;
    config.linear_oauth = None;
    app_config_manager::save(app_data_dir, &config).await
}

/// Exchange an authorization code for access + refresh tokens.
pub async fn exchange_code(
    code: &str,
    redirect_uri: &str,
) -> Result<LinearOAuthTokens, AppError> {
    let client = reqwest::Client::new();

    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("code", code),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|e| AppError::Linear(format!("token exchange request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Linear(format!(
            "token exchange failed ({status}): {text}"
        )));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Linear(format!("failed to parse token response: {e}")))?;

    let access_token = body["access_token"]
        .as_str()
        .ok_or_else(|| AppError::Linear("missing access_token in response".into()))?
        .to_string();

    let refresh_token = body["refresh_token"]
        .as_str()
        .ok_or_else(|| AppError::Linear("missing refresh_token in response".into()))?
        .to_string();

    let expires_in = body["expires_in"]
        .as_i64()
        .unwrap_or(3600 * 24 * 30);

    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(expires_in);

    Ok(LinearOAuthTokens {
        access_token,
        refresh_token,
        expires_at,
    })
}

/// Refresh the access token using the refresh token.
pub async fn refresh_if_needed(
    app_data_dir: &std::path::Path,
) -> Result<Option<LinearOAuthTokens>, AppError> {
    let tokens = match load_tokens(app_data_dir).await? {
        Some(t) => t,
        None => return Ok(None),
    };

    let now = chrono::Utc::now();
    if tokens.expires_at > now + chrono::Duration::minutes(5) {
        return Ok(Some(tokens));
    }

    let client = reqwest::Client::new();

    let resp = client
        .post(TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("refresh_token", &tokens.refresh_token),
        ])
        .send()
        .await
        .map_err(|e| AppError::Linear(format!("token refresh request failed: {e}")))?;

    if !resp.status().is_success() {
        clear_tokens(app_data_dir).await?;
        return Ok(None);
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Linear(format!("failed to parse refresh response: {e}")))?;

    let access_token = body["access_token"]
        .as_str()
        .ok_or_else(|| AppError::Linear("missing access_token in refresh response".into()))?
        .to_string();

    let refresh_token = body["refresh_token"]
        .as_str()
        .map(String::from)
        .unwrap_or(tokens.refresh_token);

    let expires_in = body["expires_in"]
        .as_i64()
        .unwrap_or(3600 * 24 * 30);

    let expires_at = chrono::Utc::now() + chrono::Duration::seconds(expires_in);

    let new_tokens = LinearOAuthTokens {
        access_token,
        refresh_token,
        expires_at,
    };

    save_tokens(app_data_dir, new_tokens.clone()).await?;
    Ok(Some(new_tokens))
}

/// State shared between the OAuth flow starter and the callback handler.
struct OAuthCallbackState {
    expected_state: String,
    result_tx: Mutex<Option<oneshot::Sender<Result<String, String>>>>,
}

#[derive(serde::Deserialize)]
struct CallbackParams {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

/// Start the OAuth flow: spin up callback server, return the auth URL.
pub async fn start_oauth_flow() -> Result<(String, u16, oneshot::Receiver<Result<String, String>>), AppError> {
    let state_param = uuid::Uuid::new_v4().to_string();
    let (result_tx, result_rx) = oneshot::channel();

    let shared = Arc::new(OAuthCallbackState {
        expected_state: state_param.clone(),
        result_tx: Mutex::new(Some(result_tx)),
    });

    let app = Router::new()
        .route("/callback", get(handle_oauth_callback))
        .with_state(Arc::clone(&shared));

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| AppError::Linear(format!("failed to bind callback server: {e}")))?;

    let port = listener.local_addr()
        .map_err(|e| AppError::Linear(format!("failed to get callback port: {e}")))?
        .port();

    let server_shared = Arc::clone(&shared);
    tokio::spawn(async move {
        let server = axum::serve(listener, app);
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(120),
            server.into_future(),
        ).await;
        if let Some(tx) = server_shared.result_tx.lock().await.take() {
            let _ = tx.send(Err("OAuth flow timed out".into()));
        }
    });

    let redirect_uri = format!("http://localhost:{port}/callback");
    let auth_url = reqwest::Url::parse_with_params(
        AUTH_URL,
        &[
            ("client_id", CLIENT_ID),
            ("redirect_uri", redirect_uri.as_str()),
            ("response_type", "code"),
            ("scope", "read"),
            ("state", state_param.as_str()),
            ("prompt", "consent"),
        ],
    )
    .map_err(|e| AppError::Linear(format!("failed to build auth URL: {e}")))?
    .to_string();

    Ok((auth_url, port, result_rx))
}

/// Handle the OAuth callback from Linear.
async fn handle_oauth_callback(
    AxumState(state): AxumState<Arc<OAuthCallbackState>>,
    Query(params): Query<CallbackParams>,
) -> (StatusCode, Html<String>) {
    let result = if let Some(error) = params.error {
        Err(format!("Linear denied access: {error}"))
    } else if let Some(code) = params.code {
        match params.state {
            Some(s) if s == state.expected_state => Ok(code),
            Some(_) => Err("Invalid state parameter — possible CSRF attack".into()),
            None => Err("Missing state parameter".into()),
        }
    } else {
        Err("Missing authorization code".into())
    };

    let is_ok = result.is_ok();
    if let Some(tx) = state.result_tx.lock().await.take() {
        let _ = tx.send(result);
    }

    let html = if is_ok {
        "<html><body style=\"font-family:system-ui;text-align:center;padding:60px\"><h2>Connected to Linear!</h2><p>You can close this window and return to Alfredo.</p></body></html>"
    } else {
        "<html><body style=\"font-family:system-ui;text-align:center;padding:60px\"><h2>Something went wrong</h2><p>Please try again from Alfredo settings.</p></body></html>"
    };

    (StatusCode::OK, Html(html.to_string()))
}
