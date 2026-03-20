use crate::config_manager;
use crate::linear_manager;
use crate::types::{AppError, LinearTeam, LinearTicket};

type Result<T> = std::result::Result<T, AppError>;

/// Read the Linear API key from config, returning an error if not configured.
async fn get_api_key(repo_path: &str) -> Result<String> {
    let config = config_manager::load_config(repo_path).await?;
    config
        .linear_api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| {
            AppError::Linear(
                "Linear API key not configured. Add it in Settings > Integrations.".into(),
            )
        })
}

/// Search Linear issues by query text, optionally filtered by team.
#[tauri::command]
pub async fn search_linear_issues(
    query: String,
    team_id: Option<String>,
) -> Result<Vec<LinearTicket>> {
    let api_key = get_api_key(".").await?;
    linear_manager::search_issues(&api_key, &query, team_id.as_deref()).await
}

/// Get full details for a single Linear issue.
#[tauri::command]
pub async fn get_linear_issue(issue_id: String) -> Result<LinearTicket> {
    let api_key = get_api_key(".").await?;
    linear_manager::get_issue(&api_key, &issue_id).await
}

/// List available Linear teams (for the team filter dropdown).
#[tauri::command]
pub async fn list_linear_teams() -> Result<Vec<LinearTeam>> {
    let api_key = get_api_key(".").await?;
    linear_manager::list_teams(&api_key).await
}
