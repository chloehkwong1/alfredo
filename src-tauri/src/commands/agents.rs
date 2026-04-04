use crate::platform::augmented_path;
use crate::types::AppError;
use std::process::Command;

/// Detect which AI agent CLIs are available on the system.
/// Returns a list of agent type identifiers matching the frontend AgentType union.
#[tauri::command]
pub async fn detect_available_agents() -> Result<Vec<String>, AppError> {
    let agents = vec![
        ("claude", "claudeCode"),
        ("codex", "codex"),
        ("gemini", "geminiCli"),
    ];

    let path_env = augmented_path();

    let mut available = Vec::new();
    for (binary, agent_type) in agents {
        let result = Command::new("which")
            .arg(binary)
            .env("PATH", &path_env)
            .output();

        if let Ok(output) = result {
            if output.status.success() {
                available.push(agent_type.to_string());
            }
        }
    }

    Ok(available)
}
