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
/// jobId, …) are ignored; missing fields default so a single odd entry can't
/// fail the whole poll. Entries without a sessionId or status are dropped in
/// parse_agents_json.
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
pub fn parse_agents_json(raw: &str) -> Result<Vec<ClaudeRegistryEntry>> {
    let entries: Vec<ClaudeRegistryEntry> = serde_json::from_str(raw)
        .map_err(|e| AppError::Config(format!("claude agents --json parse error: {e}")))?;
    Ok(entries
        .into_iter()
        .filter(|e| !e.session_id.is_empty() && !e.status.is_empty())
        .collect())
}

/// Resolve the `claude` binary once and cache it. GUI apps launched from the
/// Dock do NOT inherit the shell PATH, so a bare Command::new("claude") would
/// fail — try the standard install location first, then fall back to a login
/// shell `command -v` (mirrors how the PTY finds it via the user's shell).
fn resolve_claude_binary() -> Option<String> {
    static CLAUDE_BIN: OnceLock<Option<String>> = OnceLock::new();
    CLAUDE_BIN
        .get_or_init(|| {
            if let Some(home) = std::env::var_os("HOME") {
                let p = std::path::Path::new(&home).join(".local/bin/claude");
                if p.exists() {
                    return Some(p.to_string_lossy().into_owned());
                }
            }
            let out = std::process::Command::new("/bin/zsh")
                .args(["-lc", "command -v claude"])
                .output()
                .ok()?;
            if !out.status.success() {
                return None;
            }
            let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if path.is_empty() { None } else { Some(path) }
        })
        .clone()
}

/// Run `claude agents --json` and return the parsed session entries.
/// Fails fast (5s timeout) — the frontend disables polling after repeated
/// failures (missing binary, pre-registry CLI version).
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
}
