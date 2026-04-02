use crate::config_manager;
use crate::platform::gh_command;
use crate::types::AppError;

type Result<T> = std::result::Result<T, AppError>;

/// Check if `gh` CLI is installed and authenticated.
/// Returns `{ installed: bool, authenticated: bool, username: Option<String> }`.
#[tauri::command]
pub async fn github_auth_status() -> Result<GhCliStatus> {
    // Check if gh is installed
    let installed = gh_command()
        .arg("--version")
        .output()
        .await
        .map(|o| o.status.success())
        .unwrap_or(false);

    if !installed {
        return Ok(GhCliStatus {
            installed: false,
            authenticated: false,
            username: None,
        });
    }

    // Check if gh is authenticated
    let auth_output = gh_command()
        .args(["auth", "status"])
        .output()
        .await
        .map_err(|e| AppError::Github(format!("failed to check gh auth status: {e}")))?;

    let authenticated = auth_output.status.success();

    let username = if authenticated {
        gh_command()
            .args(["api", "user", "--jq", ".login"])
            .output()
            .await
            .ok()
            .and_then(|o| {
                if o.status.success() {
                    String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
                } else {
                    None
                }
            })
    } else {
        None
    };

    Ok(GhCliStatus {
        installed,
        authenticated,
        username,
    })
}

/// Get the GitHub token from `gh auth token`.
#[tauri::command]
pub async fn github_auth_token() -> Result<String> {
    let output = gh_command()
        .args(["auth", "token"])
        .output()
        .await
        .map_err(|e| AppError::Github(format!("failed to get gh token: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Github(format!(
            "gh auth token failed: {stderr}"
        )));
    }

    let token = String::from_utf8(output.stdout)
        .map_err(|e| AppError::Github(format!("invalid token output: {e}")))?
        .trim()
        .to_string();

    if token.is_empty() {
        return Err(AppError::Github("gh returned empty token".into()));
    }

    Ok(token)
}

/// Disconnect GitHub: clear the token from config.
#[tauri::command]
pub async fn github_auth_disconnect(repo_path: String) -> Result<()> {
    let mut config = config_manager::load_config(&repo_path).await?;
    config.github_token = None;
    config_manager::save_config(&repo_path, &config).await?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhCliStatus {
    pub installed: bool,
    pub authenticated: bool,
    pub username: Option<String>,
}
