use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenIssueRequest {
    pub workdir: String,
    pub branch: String,
    pub prompt: String,
    pub issue_id: Option<String>,
    pub project: Option<String>,
    /// Filled in by the single-instance callback after matching (later task).
    pub matched_repo_path: Option<String>,
}

/// Parse `open-issue --workdir <d> --branch <b> --prompt <p> [--issue <id>] [--project <p>]`.
/// Returns None unless the `open-issue` token is present with both required flags.
/// Empty `--issue`/`--project` values (Linear sends empty when absent) become None.
pub fn parse_open_issue(argv: &[String]) -> Option<OpenIssueRequest> {
    let start = argv.iter().position(|a| a == "open-issue")?;
    let rest = &argv[start + 1..];
    let mut req = OpenIssueRequest::default();
    let mut i = 0;
    while i + 1 < rest.len() {
        let val = rest[i + 1].clone();
        match rest[i].as_str() {
            "--workdir" => req.workdir = val,
            "--branch" => req.branch = val,
            "--prompt" => req.prompt = val,
            "--issue" => req.issue_id = (!val.is_empty()).then_some(val),
            "--project" => req.project = (!val.is_empty()).then_some(val),
            _ => {}
        }
        i += 2;
    }
    if req.workdir.is_empty() || req.branch.is_empty() {
        return None;
    }
    Some(req)
}

/// True for a Linear template var that wasn't substituted (a raw `{{workDir}}`).
/// Custom-link mode only fills `{{prompt}}`, so the structured params can arrive
/// as literal placeholders — treat those as absent rather than real values.
fn is_unsubstituted(v: &str) -> bool {
    let t = v.trim();
    t.starts_with("{{") && t.ends_with("}}")
}

/// Parse an `alfredo://Alfredo/open-issue?prompt=…[&branch=…&issue=…&…]` deep
/// link into the same request shape as the argv parser. The `url` crate
/// percent-decodes every value, so a multi-line `prompt` survives intact.
///
/// `prompt` is the only required field, and in Linear's "Custom link" mode it's
/// the only one that substitutes — the others come through as literal `{{…}}`
/// and are dropped (the frontend recovers the identifier + branch from the
/// prompt text). Returns None for any other scheme or action.
pub fn parse_open_issue_url(raw: &str) -> Option<OpenIssueRequest> {
    let url = url::Url::parse(raw).ok()?;
    if url.scheme() != "alfredo" {
        return None;
    }
    // Action is "open-issue", carried either as the first path segment
    // (`alfredo://Alfredo/open-issue?…`, so Linear labels the tool "Alfredo")
    // or — for the original form — as the host (`alfredo://open-issue?…`).
    let action = url
        .path_segments()
        .and_then(|mut segs| segs.find(|s| !s.is_empty()).map(ToString::to_string))
        .or_else(|| url.host_str().map(ToString::to_string));
    if action.as_deref() != Some("open-issue") {
        return None;
    }
    let take = |v: std::borrow::Cow<'_, str>| -> Option<String> {
        if is_unsubstituted(v.as_ref()) {
            None
        } else {
            Some(v.into_owned())
        }
    };
    let mut req = OpenIssueRequest::default();
    for (key, val) in url.query_pairs() {
        match key.as_ref() {
            "workdir" => req.workdir = take(val).unwrap_or_default(),
            "branch" => req.branch = take(val).unwrap_or_default(),
            "prompt" => req.prompt = take(val).unwrap_or_default(),
            "issue" => req.issue_id = take(val).filter(|s| !s.is_empty()),
            "project" => req.project = take(val).filter(|s| !s.is_empty()),
            _ => {}
        }
    }
    // The prompt is the one field Custom-link mode always fills.
    (!req.prompt.is_empty()).then_some(req)
}

/// Pure longest-prefix match over already-canonicalized paths.
/// Returns the managed repo path that equals `workdir` or is its closest ancestor.
pub fn longest_prefix_match(workdir: &str, repo_paths: &[String]) -> Option<String> {
    let w = workdir.trim_end_matches('/');
    repo_paths
        .iter()
        .map(|p| p.trim_end_matches('/').to_string())
        .filter(|p| w == p || w.starts_with(&format!("{p}/")))
        .max_by_key(String::len)
}

/// Canonicalize `workdir` and each repo path (resolving symlinks, e.g. macOS
/// `/var`->`/private/var`), then prefix-match. Falls back to the raw string if a
/// path can't be canonicalized (e.g. repo on an unmounted volume).
pub fn match_workdir_to_repo(workdir: &str, repo_paths: &[String]) -> Option<String> {
    let canon = |p: &str| {
        std::fs::canonicalize(p)
            .ok()
            .and_then(|pb| pb.to_str().map(ToString::to_string))
            .unwrap_or_else(|| p.to_string())
    };
    let cw = canon(workdir);
    // Match on canonical paths, but return the ORIGINAL repo path the caller knows.
    let canon_to_orig: Vec<(String, String)> =
        repo_paths.iter().map(|p| (canon(p), p.clone())).collect();
    let canon_paths: Vec<String> = canon_to_orig.iter().map(|(c, _)| c.clone()).collect();
    let matched = longest_prefix_match(&cw, &canon_paths)?;
    canon_to_orig
        .into_iter()
        .find(|(c, _)| *c == matched)
        .map(|(_, orig)| orig)
}

use std::sync::Mutex;
use tauri::State;

/// Cold-start replay buffer: holds the most recent open-issue request until the
/// frontend drains it on mount (covers the app being booted by the Linear
/// invocation before the webview is listening).
#[derive(Default)]
pub struct PendingOpenIssue(pub Mutex<Option<OpenIssueRequest>>);

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn take_pending_open_issue(state: State<'_, PendingOpenIssue>) -> Option<OpenIssueRequest> {
    state.0.lock().ok().and_then(|mut g| g.take())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_full_invocation() {
        let a = argv(&[
            "/Applications/Alfredo.app/Contents/MacOS/alfredo",
            "open-issue",
            "--workdir", "/Users/chloe/dev/alfredo",
            "--branch", "chloe/eng-412-fix",
            "--prompt", "Title\nbody",
            "--issue", "ENG-412",
            "--project", "Q3",
        ]);
        let r = parse_open_issue(&a).unwrap();
        assert_eq!(r.workdir, "/Users/chloe/dev/alfredo");
        assert_eq!(r.branch, "chloe/eng-412-fix");
        assert_eq!(r.prompt, "Title\nbody");
        assert_eq!(r.issue_id.as_deref(), Some("ENG-412"));
        assert_eq!(r.project.as_deref(), Some("Q3"));
    }

    #[test]
    fn empty_optional_flags_become_none() {
        let a = argv(&["x", "open-issue", "--workdir", "/r", "--branch", "b", "--prompt", "p", "--project", ""]);
        let r = parse_open_issue(&a).unwrap();
        assert_eq!(r.project, None);
        assert_eq!(r.issue_id, None);
    }

    #[test]
    fn missing_open_issue_token_is_none() {
        let a = argv(&["x", "--workdir", "/r", "--branch", "b", "--prompt", "p"]);
        assert!(parse_open_issue(&a).is_none());
    }

    #[test]
    fn missing_required_flag_is_none() {
        let a = argv(&["x", "open-issue", "--workdir", "/r", "--prompt", "p"]);
        assert!(parse_open_issue(&a).is_none());
    }

    #[test]
    fn parses_deep_link_full() {
        let r = parse_open_issue_url(
            "alfredo://open-issue?workdir=/Users/chloe/dev/alfredo&branch=chloe%2Feng-412&prompt=Title%0Abody&issue=ENG-412&project=Q3",
        )
        .unwrap();
        assert_eq!(r.workdir, "/Users/chloe/dev/alfredo");
        assert_eq!(r.branch, "chloe/eng-412");
        assert_eq!(r.prompt, "Title\nbody");
        assert_eq!(r.issue_id.as_deref(), Some("ENG-412"));
        assert_eq!(r.project.as_deref(), Some("Q3"));
    }

    #[test]
    fn parses_deep_link_prompt_only() {
        // Linear's "Custom link" mode sends only the rendered prompt template.
        let r = parse_open_issue_url("alfredo://open-issue?prompt=Work%20on%20ENG-412").unwrap();
        assert_eq!(r.prompt, "Work on ENG-412");
        assert!(r.workdir.is_empty());
        assert!(r.branch.is_empty());
        assert_eq!(r.issue_id, None);
    }

    #[test]
    fn deep_link_rejects_wrong_scheme() {
        assert!(parse_open_issue_url("conductor://open-issue?prompt=x").is_none());
    }

    #[test]
    fn deep_link_rejects_wrong_action() {
        assert!(parse_open_issue_url("alfredo://other?prompt=x").is_none());
    }

    #[test]
    fn deep_link_requires_prompt() {
        assert!(parse_open_issue_url("alfredo://open-issue?branch=b").is_none());
    }

    #[test]
    fn deep_link_action_from_path_with_app_host() {
        // `alfredo://Alfredo/open-issue?…` — host "Alfredo" is the label, the
        // action comes from the path segment.
        let r = parse_open_issue_url("alfredo://Alfredo/open-issue?prompt=hello").unwrap();
        assert_eq!(r.prompt, "hello");
    }

    #[test]
    fn deep_link_drops_unsubstituted_placeholders() {
        // Custom-link mode fills only {{prompt}}; the rest arrive literal.
        let r = parse_open_issue_url(
            "alfredo://Alfredo/open-issue?workdir={{workDir}}&branch={{issue.branchName}}&issue={{issue.identifier}}&prompt=Real%20text",
        )
        .unwrap();
        assert_eq!(r.prompt, "Real text");
        assert!(r.workdir.is_empty());
        assert!(r.branch.is_empty());
        assert_eq!(r.issue_id, None);
    }

    #[test]
    fn exact_match() {
        let repos = vec!["/Users/chloe/dev/alfredo".to_string()];
        assert_eq!(longest_prefix_match("/Users/chloe/dev/alfredo", &repos).as_deref(), Some("/Users/chloe/dev/alfredo"));
    }

    #[test]
    fn subdir_matches_repo_root() {
        let repos = vec!["/Users/chloe/dev/alfredo".to_string()];
        assert_eq!(longest_prefix_match("/Users/chloe/dev/alfredo/src/x", &repos).as_deref(), Some("/Users/chloe/dev/alfredo"));
    }

    #[test]
    fn trailing_slash_normalized() {
        let repos = vec!["/Users/chloe/dev/alfredo/".to_string()];
        assert_eq!(longest_prefix_match("/Users/chloe/dev/alfredo", &repos).as_deref(), Some("/Users/chloe/dev/alfredo"));
    }

    #[test]
    fn longest_prefix_wins_for_nested_repos() {
        let repos = vec!["/Users/chloe/dev".to_string(), "/Users/chloe/dev/alfredo".to_string()];
        assert_eq!(longest_prefix_match("/Users/chloe/dev/alfredo/src", &repos).as_deref(), Some("/Users/chloe/dev/alfredo"));
    }

    #[test]
    fn sibling_is_not_a_match() {
        let repos = vec!["/Users/chloe/dev/alfredo".to_string()];
        assert_eq!(longest_prefix_match("/Users/chloe/dev/alfredo-other", &repos), None);
    }

    #[test]
    fn no_match_returns_none() {
        let repos = vec!["/Users/chloe/dev/alfredo".to_string()];
        assert_eq!(longest_prefix_match("/tmp/elsewhere", &repos), None);
    }
}
