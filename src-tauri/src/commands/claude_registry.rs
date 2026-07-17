//! Polls Claude Code's first-party session registry via `claude agents --json`.
//!
//! Each Claude Code session live-updates `~/.claude/sessions/<pid>.json` with
//! its own status (`busy`/`idle`/`waiting` + `waitingFor`); the CLI is the
//! stable, documented read interface over that registry (~250ms, measured).
//! The frontend reconciler uses these entries as ground truth to correct
//! hook-derived status — see sessionManager.applyRegistrySnapshot.

use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

use crate::types::AppError;

type Result<T> = std::result::Result<T, AppError>;

/// One session from `claude agents --json`. Unknown fields (name, startedAt,
/// jobId, …) are ignored; missing fields default, and parse_agents_json
/// deserializes per-entry so a single malformed entry (null field, wrong
/// type) is dropped without failing the whole poll. Entries without a
/// sessionId or status are dropped there too.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeRegistryEntry {
    #[serde(default)]
    pub pid: u32,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub waiting_for: Option<String>,
}

/// Parse the raw stdout of `claude agents --json`. Pure — unit-tested below.
/// Lenient per entry: the array must parse, but individual entries that fail
/// to deserialize (null fields, wrong types from a future CLI) are dropped
/// rather than failing the snapshot — a hard error here feeds the frontend's
/// consecutive-failure backoff and would mute the backstop over one odd entry.
pub fn parse_agents_json(raw: &str) -> Result<Vec<ClaudeRegistryEntry>> {
    let values: Vec<serde_json::Value> = serde_json::from_str(raw)
        .map_err(|e| AppError::Config(format!("claude agents --json parse error: {e}")))?;
    let total = values.len();
    let entries: Vec<ClaudeRegistryEntry> = values
        .into_iter()
        .filter_map(|v| serde_json::from_value(v).ok())
        .filter(|e: &ClaudeRegistryEntry| !e.session_id.is_empty() && !e.status.is_empty())
        .collect();
    if entries.len() < total {
        eprintln!(
            "[registry] dropped {}/{total} malformed or incomplete agent entries",
            total - entries.len(),
        );
    }
    Ok(entries)
}

/// Resolve the `claude` binary. GUI apps launched from the Dock do NOT
/// inherit the shell PATH, so a bare Command::new("claude") would fail —
/// search the same augmented PATH the PTY uses to spawn agents (standard
/// install dirs + the user's login-shell PATH, whatever their shell).
/// Only successful resolutions are cached: a miss retries on the next poll,
/// so installing claude while Alfredo runs recovers without a restart.
fn resolve_claude_binary() -> Option<String> {
    static CLAUDE_BIN: OnceLock<String> = OnceLock::new();
    if let Some(hit) = CLAUDE_BIN.get() {
        return Some(hit.clone());
    }
    let found = find_in_path_string(&crate::platform::augmented_path(), "claude")?;
    Some(CLAUDE_BIN.get_or_init(|| found).clone())
}

/// First `<dir>/<name>` regular file across a colon-separated PATH string.
fn find_in_path_string(path: &str, name: &str) -> Option<String> {
    path.split(':')
        .filter(|dir| !dir.is_empty())
        .map(|dir| std::path::Path::new(dir).join(name))
        .find(|cand| cand.is_file())
        .map(|cand| cand.to_string_lossy().into_owned())
}

/// Run `claude agents --json` and return the parsed session entries.
/// Fails fast (5s timeout) — the frontend backs off exponentially on
/// consecutive failures (missing binary, pre-registry CLI version, load
/// spikes) and recovers on the first success.
#[tauri::command]
pub async fn poll_claude_registry() -> Result<Vec<ClaudeRegistryEntry>> {
    let bin = tokio::task::spawn_blocking(resolve_claude_binary)
        .await
        .map_err(|e| AppError::Config(format!("claude binary resolution panicked: {e}")))?
        .ok_or_else(|| AppError::Config("claude binary not found".into()))?;
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::process::Command::new(&bin)
            .args(["agents", "--json"])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| AppError::Config("claude agents --json timed out".into()))?
    .map_err(|e| AppError::Config(format!("claude agents --json spawn failed: {e}")))?;
    if !output.status.success() {
        return Err(AppError::Config(format!(
            "claude agents --json exited {}",
            output.status
        )));
    }
    parse_agents_json(&String::from_utf8_lossy(&output.stdout))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_live_output_shape() {
        // Shape captured live from `claude agents --json` on 2.1.210.
        let raw = r#"[
          {"pid":43648,"cwd":"/Users/x/dev/wt/a","kind":"interactive","startedAt":1784018723567,
           "sessionId":"ba34d038-2bf7","name":"wt-a-56","status":"waiting","waitingFor":"permission prompt"},
          {"pid":43813,"cwd":"/Users/x/dev/wt/b","kind":"interactive","startedAt":1784018724509,
           "sessionId":"640121bb-6454","status":"idle"}
        ]"#;
        let entries = parse_agents_json(raw).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].status, "waiting");
        assert_eq!(entries[0].waiting_for.as_deref(), Some("permission prompt"));
        assert_eq!(entries[0].session_id, "ba34d038-2bf7");
        assert_eq!(entries[1].status, "idle");
        assert_eq!(entries[1].waiting_for, None);
    }

    #[test]
    fn drops_entries_missing_session_id_or_status() {
        let raw = r#"[
          {"pid":1,"cwd":"/a","status":"busy"},
          {"pid":2,"cwd":"/b","sessionId":"s-2"},
          {"pid":3,"cwd":"/c","sessionId":"s-3","status":"busy"}
        ]"#;
        let entries = parse_agents_json(raw).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].session_id, "s-3");
    }

    #[test]
    fn parses_empty_array() {
        assert_eq!(parse_agents_json("[]").unwrap().len(), 0);
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(parse_agents_json("not json").is_err());
        assert!(parse_agents_json(r#"{"pid":1}"#).is_err()); // object, not array
    }

    #[test]
    fn drops_malformed_entries_without_failing_the_snapshot() {
        // One entry with a null string field and one with a wrong-typed pid
        // must not take down the healthy entries around them.
        let raw = r#"[
          {"pid":1,"cwd":null,"sessionId":"s-1","status":"busy"},
          {"pid":"not-a-number","cwd":"/b","sessionId":"s-2","status":"idle"},
          {"pid":3,"cwd":"/c","sessionId":"s-3","status":"busy"}
        ]"#;
        let entries = parse_agents_json(raw).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].session_id, "s-3");
    }

    #[test]
    fn find_in_path_string_walks_dirs_in_order() {
        let dir = std::env::temp_dir().join(format!("alfredo-test-path-{}", std::process::id()));
        let sub = dir.join("bin");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(sub.join("claude"), "#!/bin/sh\n").unwrap();
        let path = format!("/nonexistent-dir:{}", sub.display());
        assert_eq!(
            find_in_path_string(&path, "claude"),
            Some(sub.join("claude").to_string_lossy().into_owned()),
        );
        assert_eq!(find_in_path_string(&path, "missing-binary"), None);
        assert_eq!(find_in_path_string("", "claude"), None);
        std::fs::remove_dir_all(&dir).ok();
    }
}
