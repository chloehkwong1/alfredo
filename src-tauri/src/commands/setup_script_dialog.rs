use std::collections::HashSet;
use std::path::PathBuf;

use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use crate::types::SetupScript;

/// File where we persist the set of user-approved script commands so we only
/// prompt once per unique command.
fn approvals_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("approved_setup_scripts.json"))
}

fn load_approvals(path: &std::path::Path) -> HashSet<String> {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_approvals(path: &std::path::Path, approvals: &HashSet<String>) {
    if let Some(parent) = path.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            eprintln!("[alfredo] failed to create approvals directory: {e}");
            return;
        }
    }
    let json = match serde_json::to_string(approvals) {
        Ok(j) => j,
        Err(e) => {
            eprintln!("[alfredo] failed to serialize setup script approvals: {e}");
            return;
        }
    };
    if let Err(e) = std::fs::write(path, json) {
        eprintln!("[alfredo] failed to save setup script approvals: {e}");
    }
}

/// Show a confirmation dialog listing the setup scripts that are about to run,
/// unless every script has been previously approved by the user.
/// Returns `true` if the scripts should run, `false` if cancelled.
pub async fn confirm_setup_scripts(app: &tauri::AppHandle, scripts: &[SetupScript]) -> bool {
    let approvals_file = match approvals_path(app) {
        Some(p) => p,
        None => return prompt_user(app, scripts),
    };

    let approvals = load_approvals(&approvals_file);
    let all_approved = scripts.iter().all(|s| approvals.contains(&s.command));

    if all_approved {
        return true;
    }

    if !prompt_user(app, scripts) {
        return false;
    }

    // User approved — remember these scripts for next time.
    let mut approvals = approvals;
    for s in scripts {
        approvals.insert(s.command.clone());
    }
    save_approvals(&approvals_file, &approvals);

    true
}

fn prompt_user(app: &tauri::AppHandle, scripts: &[SetupScript]) -> bool {
    let script_list = scripts
        .iter()
        .map(|s| format!("• {} — {}", s.name, s.command))
        .collect::<Vec<_>>()
        .join("\n");

    app.dialog()
        .message(format!(
            "This repo wants to run the following setup scripts:\n\n{script_list}\n\nOnly proceed if you trust this repository."
        ))
        .title("Run Setup Scripts?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Run Scripts".into(),
            "Cancel".into(),
        ))
        .blocking_show()
}
