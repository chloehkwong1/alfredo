use crate::config_manager;
use crate::types::AppError;

type Result<T> = std::result::Result<T, AppError>;

const CLIENT_ID: &str = "Iv23liW7PqCMQFlyKwXR";
const CLIENT_SECRET: &str = "03ce5ab9c818172a1f7d1a166f3fe7afd0f90f1d";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";

/// Exchange an authorization code (from GitHub App installation callback)
/// for a user access token.
#[tauri::command]
pub async fn github_auth_exchange(code: String) -> Result<String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(ACCESS_TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", CLIENT_ID),
            ("client_secret", CLIENT_SECRET),
            ("code", code.as_str()),
        ])
        .send()
        .await
        .map_err(|e| AppError::Github(format!("failed to exchange code: {e}")))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Github(format!(
            "GitHub token exchange failed: {body}"
        )));
    }

    #[derive(serde::Deserialize)]
    struct TokenResponse {
        #[serde(default)]
        access_token: Option<String>,
        #[serde(default)]
        error: Option<String>,
        #[serde(default)]
        error_description: Option<String>,
    }

    let body: TokenResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Github(format!("failed to parse token response: {e}")))?;

    if let Some(error) = body.error {
        let desc = body.error_description.unwrap_or_default();
        return Err(AppError::Github(format!("GitHub auth error: {error} — {desc}")));
    }

    body.access_token
        .ok_or_else(|| AppError::Github("no access_token in response".into()))
}

/// Fetch the authenticated user's login name from the token.
#[tauri::command]
pub async fn github_auth_user(token: String) -> Result<String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("User-Agent", "alfredo-desktop")
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| AppError::Github(format!("failed to fetch user: {e}")))?;

    if !resp.status().is_success() {
        return Err(AppError::Github("invalid token — could not fetch user".into()));
    }

    let user: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Github(format!("failed to parse user response: {e}")))?;

    user.get("login")
        .and_then(|v| v.as_str())
        .map(String::from)
        .ok_or_else(|| AppError::Github("no login field in user response".into()))
}

/// Disconnect GitHub: clear the token and installation ID from config.
#[tauri::command]
pub async fn github_auth_disconnect(repo_path: String) -> Result<()> {
    let mut config = config_manager::load_config(&repo_path).await?;
    config.github_token = None;
    config.github_installation_id = None;
    config_manager::save_config(&repo_path, &config).await?;
    Ok(())
}
