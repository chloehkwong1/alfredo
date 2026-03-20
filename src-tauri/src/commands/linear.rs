use crate::types::{AppError, LinearTeam, LinearTicket};

type Result<T> = std::result::Result<T, AppError>;

/// Search Linear issues by query text, optionally filtered by team.
#[tauri::command]
pub async fn search_linear_issues(
    query: String,
    team_id: Option<String>,
) -> Result<Vec<LinearTicket>> {
    let _ = (query, team_id);
    Err(AppError::Linear("not yet implemented".into()))
}

/// Get full details for a single Linear issue.
#[tauri::command]
pub async fn get_linear_issue(issue_id: String) -> Result<LinearTicket> {
    let _ = issue_id;
    Err(AppError::Linear("not yet implemented".into()))
}

/// List available Linear teams (for the team filter dropdown).
#[tauri::command]
pub async fn list_linear_teams() -> Result<Vec<LinearTeam>> {
    Err(AppError::Linear("not yet implemented".into()))
}
