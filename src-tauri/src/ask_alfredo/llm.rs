use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub answer: String,
    #[serde(default, alias = "ui_path")]
    pub ui_path: Option<String>,
    pub confidence: Confidence,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    High,
    Low,
}

pub struct LlmClient {
    pub anthropic_api_key: Option<String>,
}

impl LlmClient {
    pub async fn ask(&self, system: String, user: String) -> Result<Answer, String> {
        if claude_cli_available().await {
            return call_claude_cli(&system, &user).await;
        }
        let key = self.anthropic_api_key.as_ref().ok_or_else(|| {
            "No LLM configured. Install Claude Code or add an Anthropic API key in Settings."
                .to_string()
        })?;
        call_anthropic_api(key, &system, &user).await
    }
}

async fn claude_cli_available() -> bool {
    Command::new("claude")
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .await
        .map(|s| s.success())
        .unwrap_or(false)
}

async fn call_claude_cli(system: &str, user: &str) -> Result<Answer, String> {
    let full_prompt = format!("{system}\n\n---\n\nUser question: {user}");
    let mut child = Command::new("claude")
        .args([
            "-p",
            "--output-format",
            "json",
            "--model",
            "sonnet",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn claude: {e}"))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(full_prompt.as_bytes())
            .await
            .map_err(|e| format!("write stdin: {e}"))?;
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("wait claude: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "claude exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let wrapper: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("parse claude json envelope: {e}"))?;
    if wrapper.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false) {
        return Err(format!(
            "claude returned error: {}",
            wrapper
                .get("result")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
        ));
    }
    let result_str = wrapper
        .get("result")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "claude json missing `result` string".to_string())?;
    parse_answer_from_model(result_str)
}

async fn call_anthropic_api(api_key: &str, system: &str, user: &str) -> Result<Answer, String> {
    let body = serde_json::json!({
        "model": "claude-sonnet-4-6",
        "max_tokens": 512,
        "system": [
            { "type": "text", "text": system, "cache_control": { "type": "ephemeral" } }
        ],
        "messages": [
            { "role": "user", "content": user }
        ]
    });

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("anthropic request: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let txt = resp.text().await.unwrap_or_default();
        return Err(format!("anthropic {status}: {txt}"));
    }

    let parsed: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let text = parsed
        .get("content")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("text"))
        .and_then(|t| t.as_str())
        .ok_or_else(|| "anthropic response missing content[0].text".to_string())?;
    parse_answer_from_model(text)
}

fn parse_answer_from_model(raw: &str) -> Result<Answer, String> {
    let start = raw.find('{').ok_or("no JSON object in model output")?;
    let end = raw.rfind('}').ok_or("no JSON object in model output")?;
    let json = &raw[start..=end];
    serde_json::from_str(json).map_err(|e| format!("parse answer json: {e} -- raw: {raw}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_json() {
        let raw = r#"{"answer":"Hi","uiPath":null,"confidence":"high"}"#;
        let a = parse_answer_from_model(raw).unwrap();
        assert_eq!(a.answer, "Hi");
        assert_eq!(a.confidence, Confidence::High);
    }

    #[test]
    fn parses_json_with_leading_prose() {
        let raw = r#"Here's the answer:
{"answer":"Right-click.","uiPath":"Sidebar","confidence":"high"}"#;
        let a = parse_answer_from_model(raw).unwrap();
        assert_eq!(a.answer, "Right-click.");
        assert_eq!(a.ui_path.as_deref(), Some("Sidebar"));
    }

    #[test]
    fn errors_on_missing_json() {
        assert!(parse_answer_from_model("no json here").is_err());
    }
}
