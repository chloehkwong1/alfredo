use tauri::{AppHandle, Manager};

use crate::linear_manager;
use crate::types::{AppError, LinearTeam, LinearTicket};
use tokio::sync::OnceCell;

type Result<T> = std::result::Result<T, AppError>;

/// Cached Linear viewer name, fetched once per app session.
static LINEAR_VIEWER_NAME: OnceCell<Option<String>> = OnceCell::const_new();

async fn get_viewer_name_cached(api_key: &str) -> Option<String> {
    LINEAR_VIEWER_NAME
        .get_or_init(|| async {
            linear_manager::get_viewer_name(api_key).await.unwrap_or(None)
        })
        .await
        .clone()
}

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf> {
    app.path()
        .app_data_dir()
        .map_err(|e| AppError::Config(format!("failed to resolve app data dir: {e}")))
}

/// Sort Linear issues: assigned-to-me first, then by state priority
/// (In Progress > Todo > rest), then by `updated_at` descending.
pub fn sort_linear_issues(tickets: &mut [LinearTicket], viewer_name: Option<&str>) {
    tickets.sort_by(|a, b| {
        let a_mine = is_my_ticket(a, viewer_name);
        let b_mine = is_my_ticket(b, viewer_name);
        b_mine
            .cmp(&a_mine)
            .then_with(|| state_priority(&a.state).cmp(&state_priority(&b.state)))
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
}

/// Lower number = higher priority.
fn state_priority(state: &str) -> u8 {
    let lower = state.to_lowercase();
    if lower == "in progress" || lower == "started" {
        0
    } else if lower == "todo" || lower == "to do" || lower == "unstarted" {
        1
    } else {
        2
    }
}

fn is_my_ticket(ticket: &LinearTicket, viewer_name: Option<&str>) -> bool {
    match (ticket.assignee.as_deref(), viewer_name) {
        (Some(assignee), Some(viewer)) => assignee.eq_ignore_ascii_case(viewer),
        _ => false,
    }
}

/// Search Linear issues by query text, optionally filtered by team.
#[tauri::command]
pub async fn search_linear_issues(
    app: AppHandle,
    query: String,
    team_id: Option<String>,
) -> Result<Vec<LinearTicket>> {
    let app_data = app_data_dir(&app)?;
    let api_key = linear_manager::resolve_token(&app_data, ".").await?;
    let mut tickets = linear_manager::search_issues(&api_key, &query, team_id.as_deref()).await?;
    let viewer_name = get_viewer_name_cached(&api_key).await;
    sort_linear_issues(&mut tickets, viewer_name.as_deref());
    Ok(tickets)
}

/// List assigned issues for the current viewer (prepopulates the Linear tab).
#[tauri::command]
pub async fn list_my_linear_issues(app: AppHandle) -> Result<Vec<LinearTicket>> {
    let app_data = app_data_dir(&app)?;
    let api_key = linear_manager::resolve_token(&app_data, ".").await?;
    let mut tickets = linear_manager::list_assigned_issues(&api_key).await?;
    sort_linear_issues(&mut tickets, None);
    Ok(tickets)
}

/// Get full details for a single Linear issue.
#[tauri::command]
pub async fn get_linear_issue(app: AppHandle, issue_id: String) -> Result<LinearTicket> {
    let app_data = app_data_dir(&app)?;
    let api_key = linear_manager::resolve_token(&app_data, ".").await?;
    linear_manager::get_issue(&api_key, &issue_id).await
}

/// List available Linear teams (for the team filter dropdown).
#[tauri::command]
pub async fn list_linear_teams(app: AppHandle) -> Result<Vec<LinearTeam>> {
    let app_data = app_data_dir(&app)?;
    let api_key = linear_manager::resolve_token(&app_data, ".").await?;
    linear_manager::list_teams(&api_key).await
}

#[cfg(test)]
mod tests {
    use crate::types::LinearTicket;

    fn make_ticket(id: &str, assignee: Option<&str>, updated_at: &str) -> LinearTicket {
        LinearTicket {
            id: id.into(),
            identifier: format!("ALF-{id}"),
            title: format!("Ticket {id}"),
            description: None,
            url: String::new(),
            state: "In Progress".into(),
            labels: vec![],
            assignee: assignee.map(String::from),
            branch_name: None,
            updated_at: Some(updated_at.into()),
        }
    }

    #[test]
    fn test_sort_linear_issues_assigned_first() {
        let mut tickets = vec![
            make_ticket("1", None, "2026-03-01T00:00:00Z"),
            make_ticket("2", Some("Chloe"), "2026-03-02T00:00:00Z"),
            make_ticket("3", Some("Other"), "2026-03-03T00:00:00Z"),
            make_ticket("4", Some("Chloe"), "2026-03-04T00:00:00Z"),
        ];

        super::sort_linear_issues(&mut tickets, Some("Chloe"));

        let ids: Vec<&str> = tickets.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["4", "2", "3", "1"]);
    }

    #[test]
    fn test_sort_linear_issues_no_viewer_falls_back_to_recency() {
        let mut tickets = vec![
            make_ticket("1", Some("A"), "2026-03-01T00:00:00Z"),
            make_ticket("2", Some("B"), "2026-03-03T00:00:00Z"),
            make_ticket("3", None,      "2026-03-02T00:00:00Z"),
        ];

        super::sort_linear_issues(&mut tickets, None);

        let ids: Vec<&str> = tickets.iter().map(|t| t.id.as_str()).collect();
        assert_eq!(ids, vec!["2", "3", "1"]);
    }

    #[test]
    fn test_sort_linear_issues_state_priority() {
        let mut tickets = vec![
            LinearTicket { state: "Backlog".into(), ..make_ticket("1", None, "2026-03-04T00:00:00Z") },
            LinearTicket { state: "Todo".into(), ..make_ticket("2", None, "2026-03-01T00:00:00Z") },
            LinearTicket { state: "In Progress".into(), ..make_ticket("3", None, "2026-03-02T00:00:00Z") },
            LinearTicket { state: "Todo".into(), ..make_ticket("4", None, "2026-03-03T00:00:00Z") },
        ];

        super::sort_linear_issues(&mut tickets, None);

        let ids: Vec<&str> = tickets.iter().map(|t| t.id.as_str()).collect();
        // In Progress first, then Todo (recent first), then Backlog
        assert_eq!(ids, vec!["3", "4", "2", "1"]);
    }
}
