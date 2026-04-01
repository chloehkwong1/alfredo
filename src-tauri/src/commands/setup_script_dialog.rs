use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

use crate::types::SetupScript;

/// Show a confirmation dialog listing the setup scripts that are about to run.
/// Returns `true` if the user approved, `false` if they cancelled.
///
/// This runs on a Tokio worker thread (Tauri async command context), so
/// `blocking_show` is safe: the main thread remains free to pump events and
/// fire the dialog callback.
pub async fn confirm_setup_scripts(app: &tauri::AppHandle, scripts: &[SetupScript]) -> bool {
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
