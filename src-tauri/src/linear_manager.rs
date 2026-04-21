use crate::types::{AppError, LinearTeam, LinearTicket};

const GRAPHQL_ENDPOINT: &str = "https://api.linear.app/graphql";

/// Build an authenticated reqwest client for the Linear API.
fn client(api_key: &str) -> Result<reqwest::Client, AppError> {
    let mut headers = reqwest::header::HeaderMap::new();
    headers.insert(
        reqwest::header::AUTHORIZATION,
        reqwest::header::HeaderValue::from_str(api_key)
            .map_err(|e| AppError::Linear(format!("invalid API key header: {e}")))?,
    );
    headers.insert(
        reqwest::header::CONTENT_TYPE,
        reqwest::header::HeaderValue::from_static("application/json"),
    );

    reqwest::Client::builder()
        .default_headers(headers)
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| AppError::Linear(format!("failed to build HTTP client: {e}")))
}

/// Resolve a Linear API token: OAuth first (with auto-refresh), then per-repo key.
pub async fn resolve_token(
    app_data_dir: &std::path::Path,
    repo_path: &str,
) -> Result<String, AppError> {
    if let Some(tokens) = crate::linear_oauth::refresh_if_needed(app_data_dir).await? {
        return Ok(tokens.access_token);
    }

    let config = crate::config_manager::load_config(app_data_dir, repo_path).await?;
    config
        .linear_api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| {
            AppError::Linear(
                "Linear not connected. Connect via Settings > Integrations, or add an API key.".into(),
            )
        })
}

/// Returns true if the string looks like a Linear issue identifier (e.g. "PRO-5196").
/// Linear's `searchableContent` filter is full-text over title/description/comments
/// and does not reliably match identifiers, so we route these to `issue(id: ...)`.
fn looks_like_identifier(s: &str) -> bool {
    let Some((prefix, number)) = s.split_once('-') else { return false };
    !prefix.is_empty()
        && prefix.chars().all(|c| c.is_ascii_alphabetic())
        && !number.is_empty()
        && number.chars().all(|c| c.is_ascii_digit())
}

/// Search Linear issues by query text, optionally filtered by team.
pub async fn search_issues(
    api_key: &str,
    query: &str,
    team_id: Option<&str>,
) -> Result<Vec<LinearTicket>, AppError> {
    let trimmed = query.trim();
    if looks_like_identifier(trimmed) {
        let hit = lookup_by_identifier(api_key, &trimmed.to_uppercase()).await?;
        // Fall through to searchableContent when the identifier doesn't resolve —
        // covers partial/typo input during debounce (e.g. "PRO-51" mid-typing).
        if !hit.is_empty() {
            return Ok(hit);
        }
    }

    let (graphql_query, variables) = if team_id.is_some() {
        (
            r#"query SearchIssues($term: String!, $teamId: String!) {
  issues(filter: {
    searchableContent: { contains: $term },
    team: { id: { eq: $teamId } }
  }, first: 25, orderBy: updatedAt) {
    nodes {
      id
      identifier
      title
      description
      url
      state { name }
      labels { nodes { name } }
      assignee { name }
      branchName
      updatedAt
    }
  }
}"#
            .to_string(),
            serde_json::json!({ "term": query, "teamId": team_id }),
        )
    } else {
        (
            r#"query SearchIssues($term: String!) {
  issues(filter: {
    searchableContent: { contains: $term }
  }, first: 25, orderBy: updatedAt) {
    nodes {
      id
      identifier
      title
      description
      url
      state { name }
      labels { nodes { name } }
      assignee { name }
      branchName
      updatedAt
    }
  }
}"#
            .to_string(),
            serde_json::json!({ "term": query }),
        )
    };

    let body = serde_json::json!({ "query": graphql_query, "variables": variables });

    let resp = client(api_key)?
        .post(GRAPHQL_ENDPOINT)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Linear(format!("request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Linear(format!(
            "Linear API returned {status}: {text}"
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Linear(format!("failed to parse response: {e}")))?;

    if let Some(errors) = json.get("errors") {
        return Err(AppError::Linear(format!("GraphQL errors: {errors}")));
    }

    let nodes = json
        .pointer("/data/issues/nodes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let tickets = nodes.iter().map(parse_issue_node).collect::<Result<Vec<_>, _>>()?;
    Ok(tickets)
}

/// Fetch a single issue by its human identifier (e.g. "PRO-5196"). Returns an empty
/// Vec when Linear has no such issue, so the caller can treat it as a zero-result search.
async fn lookup_by_identifier(
    api_key: &str,
    identifier: &str,
) -> Result<Vec<LinearTicket>, AppError> {
    let graphql_query = r#"query LookupIssue($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    description
    url
    state { name }
    labels { nodes { name } }
    assignee { name }
    branchName
    updatedAt
  }
}"#;

    let body = serde_json::json!({
        "query": graphql_query,
        "variables": { "id": identifier }
    });

    let resp = client(api_key)?
        .post(GRAPHQL_ENDPOINT)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Linear(format!("request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Linear(format!(
            "Linear API returned {status}: {text}"
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Linear(format!("failed to parse response: {e}")))?;

    // Treat "no issue returned" as zero results regardless of error shape — Linear
    // surfaces unknown identifiers as EntityNotFound / InvalidInput / etc. and the
    // exact code varies. Only surface errors when we don't have data either way.
    let Some(node) = json.pointer("/data/issue").filter(|v| !v.is_null()) else {
        if let Some(errors) = json.get("errors") {
            eprintln!("linear identifier lookup errors (treating as empty): {errors}");
        }
        return Ok(Vec::new());
    };

    Ok(vec![parse_issue_node(node)?])
}

/// List issues assigned to the authenticated viewer.
pub async fn list_assigned_issues(
    api_key: &str,
) -> Result<Vec<LinearTicket>, AppError> {
    let graphql_query = r#"query AssignedIssues {
  viewer {
    assignedIssues(first: 50, orderBy: updatedAt, filter: { state: { type: { nin: ["completed", "canceled"] } } }) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name }
        labels { nodes { name } }
        assignee { name }
        branchName
        updatedAt
      }
    }
  }
}"#;

    let body = serde_json::json!({ "query": graphql_query });

    let resp = client(api_key)?
        .post(GRAPHQL_ENDPOINT)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Linear(format!("request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Linear(format!(
            "Linear API returned {status}: {text}"
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Linear(format!("failed to parse response: {e}")))?;

    if let Some(errors) = json.get("errors") {
        return Err(AppError::Linear(format!("GraphQL errors: {errors}")));
    }

    let nodes = json
        .pointer("/data/viewer/assignedIssues/nodes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let tickets = nodes.iter().map(parse_issue_node).collect::<Result<Vec<_>, _>>()?;
    Ok(tickets)
}

/// Fetch full details for a single Linear issue by ID.
pub async fn get_issue(
    api_key: &str,
    issue_id: &str,
) -> Result<LinearTicket, AppError> {
    let graphql_query = r#"query GetIssue($id: String!) {
  issue(id: $id) {
    id
    identifier
    title
    description
    url
    state { name }
    labels { nodes { name } }
    assignee { name }
    branchName
    updatedAt
  }
}"#;

    let body = serde_json::json!({
        "query": graphql_query,
        "variables": { "id": issue_id }
    });

    let resp = client(api_key)?
        .post(GRAPHQL_ENDPOINT)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Linear(format!("request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Linear(format!(
            "Linear API returned {status}: {text}"
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Linear(format!("failed to parse response: {e}")))?;

    if let Some(errors) = json.get("errors") {
        return Err(AppError::Linear(format!("GraphQL errors: {errors}")));
    }

    let node = json
        .pointer("/data/issue")
        .ok_or_else(|| AppError::Linear("issue not found in response".into()))?;

    parse_issue_node(node)
}

/// List available Linear teams.
pub async fn list_teams(api_key: &str) -> Result<Vec<LinearTeam>, AppError> {
    let graphql_query = r#"{
  teams(first: 50) {
    nodes {
      id
      name
      key
    }
  }
}"#;

    let body = serde_json::json!({ "query": graphql_query });

    let resp = client(api_key)?
        .post(GRAPHQL_ENDPOINT)
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Linear(format!("request failed: {e}")))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Linear(format!(
            "Linear API returned {status}: {text}"
        )));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Linear(format!("failed to parse response: {e}")))?;

    if let Some(errors) = json.get("errors") {
        return Err(AppError::Linear(format!("GraphQL errors: {errors}")));
    }

    let nodes = json
        .pointer("/data/teams/nodes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let teams = nodes
        .iter()
        .filter_map(|node| {
            Some(LinearTeam {
                id: node.get("id")?.as_str()?.to_string(),
                name: node.get("name")?.as_str()?.to_string(),
                key: node.get("key")?.as_str()?.to_string(),
            })
        })
        .collect();

    Ok(teams)
}

/// Outcome of a viewer validation call against the Linear API.
/// Distinguishes definite-auth-failure (401/403) from transient issues
/// (network, 5xx, parse) so callers can decide whether to wipe tokens.
#[derive(Debug)]
pub enum ViewerResult {
    /// Token is valid. `display_name` may be None if the viewer has no name set.
    Authed { display_name: Option<String> },
    /// Linear returned 401/403. Token is definitively bad; safe to wipe.
    Unauthed { status: u16 },
    /// Network failure, 5xx, rate limit, parse error. Token state unknown — keep.
    Transient { reason: String },
}

/// Validate a Linear token by calling the `viewer` GraphQL query.
/// Does NOT mutate stored tokens — the caller decides.
pub async fn get_viewer_name(api_key: &str) -> ViewerResult {
    let graphql_query = r#"{ viewer { id name } }"#;
    let body = serde_json::json!({ "query": graphql_query });

    let client = match client(api_key) {
        Ok(c) => c,
        Err(e) => return ViewerResult::Transient { reason: format!("client build failed: {e}") },
    };

    let resp = match client.post(GRAPHQL_ENDPOINT).json(&body).send().await {
        Ok(r) => r,
        Err(e) => return ViewerResult::Transient { reason: format!("viewer request failed: {e}") },
    };

    let status = resp.status();
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return ViewerResult::Unauthed { status: status.as_u16() };
    }
    if !status.is_success() {
        return ViewerResult::Transient {
            reason: format!("viewer returned {status}"),
        };
    }

    let json: serde_json::Value = match resp.json().await {
        Ok(j) => j,
        Err(e) => return ViewerResult::Transient { reason: format!("parse viewer response: {e}") },
    };

    let display_name = json
        .pointer("/data/viewer/name")
        .and_then(|v| v.as_str())
        .map(String::from);

    ViewerResult::Authed { display_name }
}

/// Parse a GraphQL issue node into a LinearTicket.
fn parse_issue_node(node: &serde_json::Value) -> Result<LinearTicket, AppError> {
    let id = node
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Linear("missing issue id".into()))?
        .to_string();

    let identifier = node
        .get("identifier")
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Linear("missing issue identifier".into()))?
        .to_string();

    let title = node
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let description = node
        .get("description")
        .and_then(|v| v.as_str())
        .map(std::string::ToString::to_string);

    let url = node
        .get("url")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let state = node
        .pointer("/state/name")
        .and_then(|v| v.as_str())
        .unwrap_or("Unknown")
        .to_string();

    let labels = node
        .pointer("/labels/nodes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|l| l.get("name")?.as_str().map(std::string::ToString::to_string))
                .collect()
        })
        .unwrap_or_default();

    let assignee = node
        .pointer("/assignee/name")
        .and_then(|v| v.as_str())
        .map(std::string::ToString::to_string);

    let branch_name = node
        .get("branchName")
        .and_then(|v| v.as_str())
        .map(std::string::ToString::to_string);

    let updated_at = node
        .get("updatedAt")
        .and_then(|v| v.as_str())
        .map(std::string::ToString::to_string);

    Ok(LinearTicket {
        id,
        identifier,
        title,
        description,
        url,
        state,
        labels,
        assignee,
        branch_name,
        updated_at,
    })
}

/// Generate the content for `.claude/CLAUDE.local.md` from a Linear ticket.
pub fn generate_context_md(ticket: &LinearTicket) -> String {
    let mut content = String::new();

    content.push_str(&format!("# {} {}\n\n", ticket.identifier, ticket.title));
    content.push_str("This worktree was created from a Linear ticket. All relevant ticket context is included below — do NOT fetch from Linear or any external source.\n\n");
    content.push_str("On your FIRST message in this conversation, briefly summarize the ticket (2-3 sentences) and ask the user what they'd like to do — e.g. start implementing, research the codebase first, plan an approach, etc.\n\n");

    if !ticket.url.is_empty() {
        content.push_str(&format!("**Link:** {}\n", ticket.url));
    }
    content.push_str(&format!("**Status:** {}\n", ticket.state));

    if !ticket.labels.is_empty() {
        content.push_str(&format!("**Labels:** {}\n", ticket.labels.join(", ")));
    }

    if let Some(assignee) = &ticket.assignee {
        content.push_str(&format!("**Assignee:** {assignee}\n"));
    }

    content.push('\n');

    if let Some(desc) = &ticket.description {
        if !desc.is_empty() {
            content.push_str("## Description\n\n");
            content.push_str(desc);
            content.push('\n');
        }
    }

    content
}

/// Slugify a title for use in branch names.
/// Lowercases, replaces non-alphanumeric chars with hyphens, collapses runs, trims.
pub fn slugify(title: &str) -> String {
    let slug: String = title
        .to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect();

    // Collapse consecutive hyphens and trim
    let mut result = String::new();
    let mut prev_hyphen = false;
    for c in slug.chars() {
        if c == '-' {
            if !prev_hyphen && !result.is_empty() {
                result.push('-');
            }
            prev_hyphen = true;
        } else {
            result.push(c);
            prev_hyphen = false;
        }
    }

    // Trim trailing hyphen and limit length
    let trimmed = result.trim_end_matches('-');
    if trimmed.len() > 60 {
        // Find last hyphen before 60 chars to avoid cutting words
        let truncated = &trimmed[..60];
        match truncated.rfind('-') {
            Some(pos) if pos > 20 => truncated[..pos].to_string(),
            _ => truncated.to_string(),
        }
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_slugify_basic() {
        assert_eq!(slugify("Fix payment flow"), "fix-payment-flow");
    }

    #[test]
    fn test_slugify_special_chars() {
        assert_eq!(
            slugify("Add user auth (OAuth 2.0)"),
            "add-user-auth-oauth-2-0"
        );
    }

    #[test]
    fn test_slugify_collapses_hyphens() {
        assert_eq!(slugify("fix -- broken -- thing"), "fix-broken-thing");
    }

    #[test]
    fn test_generate_context_md() {
        let ticket = LinearTicket {
            id: "abc-123".into(),
            identifier: "ROS-42".into(),
            title: "Fix auth flow".into(),
            description: Some("The auth flow is broken when users log out.".into()),
            url: "https://linear.app/ros/issue/ROS-42".into(),
            state: "In Progress".into(),
            labels: vec!["bug".into(), "auth".into()],
            assignee: Some("Chloe".into()),
            branch_name: Some("chloe/ros-42-fix-auth-flow".into()),
            updated_at: Some("2026-03-31T12:00:00.000Z".into()),
        };

        let md = generate_context_md(&ticket);
        assert!(md.contains("# ROS-42 Fix auth flow"));
        assert!(md.contains("**Link:** https://linear.app/ros/issue/ROS-42"));
        assert!(md.contains("**Status:** In Progress"));
        assert!(md.contains("**Labels:** bug, auth"));
        assert!(md.contains("**Assignee:** Chloe"));
        assert!(md.contains("The auth flow is broken"));
    }

    #[test]
    fn test_looks_like_identifier() {
        assert!(looks_like_identifier("PRO-5196"));
        assert!(looks_like_identifier("ALF-1"));
        assert!(looks_like_identifier("pro-5196"));
        assert!(!looks_like_identifier("pro 5196"));
        assert!(!looks_like_identifier("fix auth"));
        assert!(!looks_like_identifier("PRO-"));
        assert!(!looks_like_identifier("-5196"));
        assert!(!looks_like_identifier("PRO-abc"));
        assert!(!looks_like_identifier("PRO1-5196"));
    }

    #[test]
    fn test_parse_viewer_response() {
        let json: serde_json::Value = serde_json::json!({
            "data": {
                "viewer": {
                    "id": "abc-123",
                    "name": "Chloe",
                    "email": "chloe@example.com"
                }
            }
        });

        let name = json
            .pointer("/data/viewer/name")
            .and_then(|v| v.as_str())
            .map(String::from);

        assert_eq!(name, Some("Chloe".into()));
    }

    #[test]
    #[allow(clippy::panic)]
    fn test_parse_issue_with_updated_at() {
        let node = serde_json::json!({
            "id": "issue-1",
            "identifier": "ALF-1",
            "title": "Test issue",
            "description": null,
            "url": "https://linear.app/test/issue/ALF-1",
            "state": { "name": "In Progress" },
            "labels": { "nodes": [] },
            "assignee": { "name": "Chloe" },
            "branchName": "chloe/alf-1-test-issue",
            "updatedAt": "2026-03-31T12:00:00.000Z"
        });

        let ticket = match parse_issue_node(&node) {
            Ok(t) => t,
            Err(e) => panic!("parse_issue_node failed: {e}"),
        };
        assert_eq!(ticket.updated_at, Some("2026-03-31T12:00:00.000Z".into()));
        assert_eq!(ticket.assignee, Some("Chloe".into()));
    }

    #[test]
    fn viewer_result_variants_are_distinguishable() {
        use ViewerResult::*;
        fn wipe_decision(r: &ViewerResult) -> bool {
            matches!(r, Unauthed { .. })
        }

        assert!(!wipe_decision(&Authed { display_name: Some("Chloe".into()) }));
        assert!(!wipe_decision(&Authed { display_name: None }));
        assert!(wipe_decision(&Unauthed { status: 401 }));
        assert!(wipe_decision(&Unauthed { status: 403 }));
        assert!(!wipe_decision(&Transient { reason: "timeout".into() }));
        assert!(!wipe_decision(&Transient { reason: "500 internal".into() }));
    }
}
