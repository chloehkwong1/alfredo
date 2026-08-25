use std::sync::OnceLock;

use crate::types::{AppError, LinearTeam, LinearTicket};

const GRAPHQL_ENDPOINT: &str = "https://api.linear.app/graphql";

/// Process-wide shared reqwest client for Linear API calls.
///
/// Why: `client(api_key)` used to build a fresh `reqwest::Client` per call,
/// and each fresh client owns its own connection pool with default 90 s idle
/// timeout and no idle cap. Ticket-picker autocompletes and viewer-validation
/// fire many short-lived requests, so FDs to `api.linear.app` accumulated and
/// reproduced the same FD-exhaustion class of bug fixed for GitHub in commit
/// `eee98e5` (which surfaced as "Too many open files" because libgit2 then
/// can't fork). One shared pool fixes it.
///
/// Bearer tokens vary per Linear account (Chloe may have multiple), so we
/// attach the `Authorization` header per-request rather than baking it into
/// the client's default headers — that way we don't need a per-key cache to
/// bound.
///
/// Panics if the bounded client fails to build — the only realistic failure
/// is TLS init, which is unrecoverable at startup. Falling back to a default
/// client would silently re-introduce the unbounded pool this exists to
/// eliminate, which is the worse failure mode (FD leak shows up weeks later).
#[allow(clippy::expect_used)]
fn shared_http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .pool_max_idle_per_host(4)
            .pool_idle_timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("failed to build shared Linear HTTP client")
    })
}

/// Build an authenticated POST request to the Linear GraphQL endpoint.
/// All call sites in this module go through here so the connection pool is
/// shared across every Linear API call regardless of which account's API key
/// is in play.
fn client(api_key: &str) -> Result<reqwest::RequestBuilder, AppError> {
    let auth = reqwest::header::HeaderValue::from_str(api_key)
        .map_err(|e| AppError::Linear(format!("invalid API key header: {e}")))?;
    Ok(shared_http_client()
        .post(GRAPHQL_ENDPOINT)
        .header(reqwest::header::AUTHORIZATION, auth)
        .header(reqwest::header::CONTENT_TYPE, "application/json"))
}

/// Resolve a Linear API token: OAuth first (with auto-refresh), then per-repo key.
pub async fn resolve_token(
    app_data_dir: &std::path::Path,
    repo_path: &str,
) -> Result<String, AppError> {
    if let Some(tokens) = crate::linear_oauth::refresh_if_needed(app_data_dir).await? {
        return Ok(tokens.access_token);
    }

    let config = crate::config_manager::load_personal_config(app_data_dir, repo_path).await?;
    config
        .linear_api_key
        .filter(|k| !k.is_empty())
        .ok_or_else(|| {
            AppError::Linear(
                "Linear not connected. Connect via Settings > Integrations, or add an API key.".into(),
            )
        })
}

/// Issue selection shared by every query in this module — single source of
/// truth so the near-identical queries can't drift when a field is added.
const ISSUE_FIELDS: &str = "id identifier title description url state { name } labels { nodes { name } } assignee { name } branchName updatedAt";

/// Comment selection appended only by `get_issue` (the open-issue and
/// worktree-creation paths). Search and identifier-typeahead queries stay
/// comment-free — the picker never reads them. 250 is Linear's max page
/// size; `hasNextPage` lets the formatter flag fetch-level truncation.
const COMMENT_FIELDS: &str = "comments(first: 250) { pageInfo { hasNextPage } nodes { body createdAt user { name } botActor { name } } }";

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
            format!(
                "query SearchIssues($term: String!, $teamId: String!) {{
  issues(filter: {{
    searchableContent: {{ contains: $term }},
    team: {{ id: {{ eq: $teamId }} }}
  }}, first: 25, orderBy: updatedAt) {{
    nodes {{ {ISSUE_FIELDS} }}
  }}
}}"
            ),
            serde_json::json!({ "term": query, "teamId": team_id }),
        )
    } else {
        (
            format!(
                "query SearchIssues($term: String!) {{
  issues(filter: {{
    searchableContent: {{ contains: $term }}
  }}, first: 25, orderBy: updatedAt) {{
    nodes {{ {ISSUE_FIELDS} }}
  }}
}}"
            ),
            serde_json::json!({ "term": query }),
        )
    };

    let body = serde_json::json!({ "query": graphql_query, "variables": variables });

    let resp = client(api_key)?
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
    // No COMMENT_FIELDS here: this serves the picker's identifier typeahead,
    // where partials like "PRO-5" resolve to real issues on every debounce —
    // fetching full comment threads there would be pure waste. The open-issue
    // flow uses `get_issue` for the comment-bearing fetch.
    let graphql_query = format!(
        "query LookupIssue($id: String!) {{ issue(id: $id) {{ {ISSUE_FIELDS} }} }}"
    );

    let body = serde_json::json!({
        "query": graphql_query,
        "variables": { "id": identifier }
    });

    let resp = client(api_key)?
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
    let graphql_query = format!(
        r#"query AssignedIssues {{
  viewer {{
    assignedIssues(first: 50, orderBy: updatedAt, filter: {{ state: {{ type: {{ nin: ["completed", "canceled"] }} }} }}) {{
      nodes {{ {ISSUE_FIELDS} }}
    }}
  }}
}}"#
    );

    let body = serde_json::json!({ "query": graphql_query });

    let resp = client(api_key)?
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
    let graphql_query = format!(
        "query GetIssue($id: String!) {{ issue(id: $id) {{ {ISSUE_FIELDS} {COMMENT_FIELDS} }} }}"
    );

    let body = serde_json::json!({
        "query": graphql_query,
        "variables": { "id": issue_id }
    });

    let resp = client(api_key)?
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

    let req = match client(api_key) {
        Ok(c) => c,
        Err(e) => return ViewerResult::Transient { reason: format!("client build failed: {e}") },
    };

    let resp = match req.json(&body).send().await {
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

    let mut comments = node
        .pointer("/comments/nodes")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|c| {
                    let body = c.get("body")?.as_str()?.to_string();
                    let author = c
                        .pointer("/user/name")
                        .and_then(|v| v.as_str())
                        // App-posted comments (auto-triage bots) have a null
                        // user; the bot identity lives on botActor instead.
                        .or_else(|| c.pointer("/botActor/name").and_then(|v| v.as_str()))
                        .map(String::from);
                    let created_at = c
                        .get("createdAt")
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    Some(LinearComment { author, created_at, body })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    // Oldest-first regardless of API order (ISO-8601 sorts lexicographically).
    comments.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    let fetch_truncated = node
        .pointer("/comments/pageInfo/hasNextPage")
        .and_then(serde_json::Value::as_bool)
        .unwrap_or(false);
    let comments_md = format_comments(&comments, COMMENT_BUDGET, fetch_truncated);

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
        comments_md,
    })
}

/// A parsed issue comment — internal to this module; only the rendered
/// markdown (`LinearTicket::comments_md`) crosses IPC.
#[derive(Debug, Clone)]
struct LinearComment {
    /// Workspace user name, or the bot/app name for integration-posted
    /// comments (e.g. auto-triage). None when Linear reports neither.
    author: Option<String>,
    created_at: Option<String>,
    body: String,
}

/// Total char budget for the comments section pasted/written into agent
/// context. Middle-trimmed, not truncated: early comments carry triage
/// context and late ones the latest decisions, so both ends survive. Also
/// keeps pathological threads from blowing past the paste-echo settle window
/// that gates auto-submit on the frontend.
const COMMENT_BUDGET: usize = 10_000;

/// Render ticket comments as a `## Comments` markdown section, oldest-first
/// (callers sort). Empty string when there are none. Threads over `budget`
/// chars lose comments from the middle, replaced by an omission marker; if
/// the survivors are still over budget (one or two giant comments, e.g. a
/// pasted log), their bodies are truncated to fit. `fetch_truncated` flags
/// API-level truncation (the thread exceeded the fetch page size), which
/// gets its own marker since the omitted-count can't know about it.
fn format_comments(comments: &[LinearComment], budget: usize, fetch_truncated: bool) -> String {
    if comments.is_empty() {
        return String::new();
    }
    let render = |c: &LinearComment| {
        let who = c.author.as_deref().unwrap_or("Unknown");
        let when = c
            .created_at
            .as_deref()
            .map(|d| format!(" ({})", &d[..d.len().min(10)]))
            .unwrap_or_default();
        format!("**{who}{when}:**\n{}", c.body)
    };
    let mut kept: Vec<String> = comments.iter().map(render).collect();
    let mut omitted = 0usize;
    while kept.len() > 2 && kept.iter().map(|s| s.len() + 2).sum::<usize>() > budget {
        kept.remove(kept.len() / 2);
        omitted += 1;
    }
    // Middle-trim bottoms out at 2 comments; a single giant body can still
    // exceed the budget, so cap each survivor at an even share.
    if kept.iter().map(|s| s.len() + 2).sum::<usize>() > budget {
        let per = budget / kept.len();
        for s in &mut kept {
            if s.len() > per {
                let mut end = per;
                while !s.is_char_boundary(end) {
                    end -= 1;
                }
                s.truncate(end);
                s.push_str("\n[… comment truncated …]");
            }
        }
    }
    if omitted > 0 {
        let mid = kept.len() / 2;
        let plural = if omitted == 1 { "" } else { "s" };
        kept.insert(mid, format!("[… {omitted} comment{plural} omitted …]"));
    }
    if fetch_truncated {
        kept.push("[… thread has more comments than the 250 fetched …]".to_string());
    }
    format!("## Comments\n\n{}", kept.join("\n\n"))
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

    if !ticket.comments_md.is_empty() {
        content.push('\n');
        content.push_str(&ticket.comments_md);
        content.push('\n');
    }

    content.push_str("\n## Context hygiene\n\n");
    content.push_str("For bulk reads (CI logs, large diffs, long greps) use `/ci-failure`, `/investigate-log`, or `/diff-summary` — they dispatch a subagent so the raw output stays out of this transcript.\n");

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
            comments_md: "## Comments\n\n**Triage Bot (2026-03-30):**\nAuto-triage: likely regression from #1234.".into(),
        };

        let md = generate_context_md(&ticket);
        assert!(md.contains("# ROS-42 Fix auth flow"));
        assert!(md.contains("## Comments"));
        assert!(md.contains("**Triage Bot (2026-03-30):**\nAuto-triage: likely regression from #1234."));
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
    #[allow(clippy::panic)]
    fn test_parse_issue_comments_bot_author_and_sort() {
        let node = serde_json::json!({
            "id": "issue-1",
            "identifier": "ALF-1",
            "title": "Test issue",
            "url": "https://linear.app/test/issue/ALF-1",
            "state": { "name": "Todo" },
            "labels": { "nodes": [] },
            "comments": {
                "pageInfo": { "hasNextPage": false },
                "nodes": [
                    // Newest-first, as Linear returns them — parse must flip to oldest-first.
                    { "body": "later reply", "createdAt": "2026-08-02T10:00:00.000Z",
                      "user": { "name": "Chloe" }, "botActor": null },
                    { "body": "Auto-triage: needs repro", "createdAt": "2026-08-01T10:00:00.000Z",
                      "user": null, "botActor": { "name": "Tom's Triage" } },
                ]
            }
        });

        let ticket = match parse_issue_node(&node) {
            Ok(t) => t,
            Err(e) => panic!("parse_issue_node failed: {e}"),
        };
        let bot = match ticket.comments_md.find("**Tom's Triage (2026-08-01):**\nAuto-triage: needs repro") {
            Some(i) => i,
            None => panic!("bot comment missing from: {}", ticket.comments_md),
        };
        let reply = match ticket.comments_md.find("**Chloe (2026-08-02):**\nlater reply") {
            Some(i) => i,
            None => panic!("user comment missing from: {}", ticket.comments_md),
        };
        assert!(bot < reply, "comments must render oldest-first");
        assert!(!ticket.comments_md.contains("more comments than"));
    }

    #[test]
    #[allow(clippy::panic)]
    fn test_parse_issue_flags_fetch_truncation() {
        let node = serde_json::json!({
            "id": "issue-1",
            "identifier": "ALF-1",
            "title": "Test issue",
            "url": "https://linear.app/test/issue/ALF-1",
            "state": { "name": "Todo" },
            "labels": { "nodes": [] },
            "comments": {
                "pageInfo": { "hasNextPage": true },
                "nodes": [
                    { "body": "one of many", "createdAt": "2026-08-01T10:00:00.000Z",
                      "user": { "name": "Chloe" }, "botActor": null },
                ]
            }
        });

        let ticket = match parse_issue_node(&node) {
            Ok(t) => t,
            Err(e) => panic!("parse_issue_node failed: {e}"),
        };
        assert!(ticket.comments_md.contains("[… thread has more comments than the 250 fetched …]"));
    }

    #[test]
    fn test_format_comments_trims_middle_over_budget() {
        let make = |i: usize| LinearComment {
            author: Some(format!("User{i}")),
            created_at: Some(format!("2026-08-0{i}T00:00:00.000Z")),
            body: "x".repeat(100),
        };
        let comments: Vec<_> = (1..=5).map(make).collect();

        let full = format_comments(&comments, 10_000, false);
        assert!(full.starts_with("## Comments\n\n"));
        assert!(!full.contains("omitted"));
        assert!(full.contains("**User1 (2026-08-01):**"));
        assert!(full.contains("**User5 (2026-08-05):**"));

        let trimmed = format_comments(&comments, 300, false);
        assert!(trimmed.contains("**User1 (2026-08-01):**"));
        assert!(trimmed.contains("**User5 (2026-08-05):**"));
        assert!(trimmed.contains("[… 3 comments omitted …]"));
        assert!(!trimmed.contains("User3"));

        assert_eq!(format_comments(&[], 10_000, true), "");
    }

    #[test]
    fn test_format_comments_caps_giant_single_comment() {
        let giant = LinearComment {
            author: Some("Chloe".into()),
            created_at: Some("2026-08-01T00:00:00.000Z".into()),
            // Multi-byte chars so the cap must respect char boundaries.
            body: "é".repeat(20_000),
        };
        let out = format_comments(std::slice::from_ref(&giant), 1_000, false);
        assert!(out.len() < 1_200, "giant comment must be capped, got {} chars", out.len());
        assert!(out.contains("[… comment truncated …]"));
        assert!(!out.contains("omitted"), "no whole comment was removed");
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
