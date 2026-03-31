use crate::config_manager;
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

/// Sort Linear issues: assigned-to-me first, then by `updated_at` descending.
pub fn sort_linear_issues(tickets: &mut [LinearTicket], viewer_name: Option<&str>) {
    tickets.sort_by(|a, b| {
        let a_mine = is_my_ticket(a, viewer_name);
        let b_mine = is_my_ticket(b, viewer_name);
        b_mine.cmp(&a_mine).then_with(|| {
            b.updated_at.cmp(&a.updated_at)
        })
    });
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
    query: String,
    team_id: Option<String>,
) -> Result<Vec<LinearTicket>> {
    let api_key = get_api_key(".").await?;
    let mut tickets = linear_manager::search_issues(&api_key, &query, team_id.as_deref()).await?;
    let viewer_name = get_viewer_name_cached(&api_key).await;
    sort_linear_issues(&mut tickets, viewer_name.as_deref());
    Ok(tickets)
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
}
