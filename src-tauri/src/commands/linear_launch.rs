// These items are not yet wired into the app (future task); suppress dead-code
// until they are connected via lib.rs invoke_handler.
#![allow(dead_code)]

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
