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
    ("cursor", "Cursor", "editor"),
    ("windsurf", "Windsurf", "editor"),
    ("zed", "Zed", "editor"),
    ("sublime-text", "Sublime Text", "editor"),
    ("nova", "Nova", "editor"),
    ("xcode", "Xcode", "editor"),
    ("iterm", "iTerm", "terminal"),
    ("terminal", "Terminal", "terminal"),
    ("warp", "Warp", "terminal"),
    ("ghostty", "Ghostty", "terminal"),
    ("wezterm", "WezTerm", "terminal"),
    ("kitty", "kitty", "terminal"),
    ("alacritty", "Alacritty", "terminal"),
    ("hyper", "Hyper", "terminal"),
    ("tabby", "Tabby", "terminal"),
    ("github-desktop", "GitHub Desktop", "git"),
    ("sourcetree", "Sourcetree", "git"),
    ("fork", "Fork", "git"),
    ("tower", "Tower", "git"),
    ("gitkraken", "GitKraken", "git"),
    ("sublime-merge", "Sublime Merge", "git"),
];

/// Display names shown in the UI (may differ from macOS app names).
fn display_name(id: &str) -> &str {
    match id {
        "vscode" => "VS Code",
        "cursor" => "Cursor",
        "windsurf" => "Windsurf",
        "zed" => "Zed",
        "sublime-text" => "Sublime Text",
        "nova" => "Nova",
        "iterm" => "iTerm",
        "warp" => "Warp",
        "ghostty" => "Ghostty",
        "wezterm" => "WezTerm",
        "kitty" => "kitty",
        "alacritty" => "Alacritty",
        "hyper" => "Hyper",
        "tabby" => "Tabby",
        "github-desktop" => "GitHub Desktop",
        "sourcetree" => "Sourcetree",
        "fork" => "Fork",
        "tower" => "Tower",
        "gitkraken" => "GitKraken",
        "sublime-merge" => "Sublime Merge",
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
                .arg(&path)
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
        "cursor" => {
            Command::new("open")
                .args(["-a", "Cursor", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Cursor: {e}")))?;
        }
        "zed" => {
            Command::new("open")
                .args(["-a", "Zed", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Zed: {e}")))?;
        }
        "warp" => {
            Command::new("open")
                .args(["-a", "Warp", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Warp: {e}")))?;
        }
        "ghostty" => {
            Command::new("open")
                .args(["-a", "Ghostty", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Ghostty: {e}")))?;
        }
        "sourcetree" => {
            Command::new("open")
                .args(["-a", "Sourcetree", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Sourcetree: {e}")))?;
        }
        "fork" => {
            Command::new("open")
                .args(["-a", "Fork", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Fork: {e}")))?;
        }
        "windsurf" => {
            Command::new("open")
                .args(["-a", "Windsurf", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Windsurf: {e}")))?;
        }
        "sublime-text" => {
            Command::new("open")
                .args(["-a", "Sublime Text", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Sublime Text: {e}")))?;
        }
        "nova" => {
            Command::new("open")
                .args(["-a", "Nova", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Nova: {e}")))?;
        }
        "wezterm" => {
            Command::new("open")
                .args(["-a", "WezTerm", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open WezTerm: {e}")))?;
        }
        "kitty" => {
            Command::new("open")
                .args(["-a", "kitty", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open kitty: {e}")))?;
        }
        "alacritty" => {
            Command::new("open")
                .args(["-a", "Alacritty", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Alacritty: {e}")))?;
        }
        "hyper" => {
            Command::new("open")
                .args(["-a", "Hyper", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Hyper: {e}")))?;
        }
        "tabby" => {
            Command::new("open")
                .args(["-a", "Tabby", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Tabby: {e}")))?;
        }
        "tower" => {
            Command::new("open")
                .args(["-a", "Tower", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Tower: {e}")))?;
        }
        "gitkraken" => {
            Command::new("open")
                .args(["-a", "GitKraken", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open GitKraken: {e}")))?;
        }
        "sublime-merge" => {
            Command::new("open")
                .args(["-a", "Sublime Merge", &path])
                .spawn()
                .map_err(|e| AppError::Config(format!("Failed to open Sublime Merge: {e}")))?;
        }
        _ => {
            return Err(AppError::Config(format!("Unknown app: {app_id}")));
        }
    }

    Ok(())
}
