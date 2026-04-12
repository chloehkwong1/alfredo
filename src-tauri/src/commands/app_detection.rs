use std::process::Command;
use serde::Serialize;

use crate::platform::augmented_path;
use crate::types::AppError;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledApp {
    pub id: String,
    pub name: String,
    pub category: String,
}

/// Candidate apps in display order.
const CANDIDATES: &[(&str, &str, &str)] = &[
    ("finder", "Finder", "file-manager"),
    ("vscode", "Visual Studio Code", "editor"),
    ("xcode", "Xcode", "editor"),
    ("iterm", "iTerm", "terminal"),
    ("terminal", "Terminal", "terminal"),
    ("github-desktop", "GitHub Desktop", "git"),
];

/// Display names shown in the UI (may differ from macOS app names).
fn display_name(id: &str) -> &str {
    match id {
        "vscode" => "VS Code",
        "iterm" => "iTerm",
        "github-desktop" => "GitHub Desktop",
        "finder" => "Finder",
        "xcode" => "Xcode",
        "terminal" => "Terminal",
        _ => id,
    }
}

/// Apps that are always present on macOS — skip detection.
fn always_present(id: &str) -> bool {
    matches!(id, "finder" | "terminal")
}

#[tauri::command]
pub async fn detect_installed_apps() -> Result<Vec<InstalledApp>, AppError> {
    let mut apps = Vec::new();

    for &(id, app_name, category) in CANDIDATES {
        if always_present(id) || is_app_installed(app_name) {
            apps.push(InstalledApp {
                id: id.to_string(),
                name: display_name(id).to_string(),
                category: category.to_string(),
            });
        }
    }

    Ok(apps)
}

fn is_app_installed(app_name: &str) -> bool {
    Command::new("open")
        .args(["-Ra", app_name])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub fn open_in_app(app_id: String, path: String) -> Result<(), AppError> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(AppError::Config(format!("Path does not exist: {path}")));
    }

    let path_env = augmented_path();

    match app_id.as_str() {
        "finder" => {
            // Use `open -R` to reveal in Finder
            Command::new("open")
                .args(["-R", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Finder: {e}")))?;
        }
        "vscode" => {
            Command::new("code")
                .args(["--goto", &path])
                .env("PATH", &path_env)
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open VS Code: {e}")))?;
        }
        "xcode" => {
            Command::new("open")
                .args(["-a", "Xcode", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Xcode: {e}")))?;
        }
        "iterm" => {
            Command::new("open")
                .args(["-a", "iTerm", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open iTerm: {e}")))?;
        }
        "terminal" => {
            Command::new("open")
                .args(["-a", "Terminal", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Terminal: {e}")))?;
        }
        "github-desktop" => {
            Command::new("open")
                .args(["-a", "GitHub Desktop", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open GitHub Desktop: {e}")))?;
        }
        _ => {
            return Err(AppError::Config(format!("Unknown app: {app_id}")));
        }
    }

    Ok(())
}
